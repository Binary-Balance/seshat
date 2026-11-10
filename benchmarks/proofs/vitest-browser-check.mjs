// Feasibility proof for Vitest 5 browser mode (#159). It drives the unchanged
// native CLI and Vitest reporter; the fixture's evidence-setup.ts stands in for
// the runner adapter that browser mode cannot load. Linux only: orphan checks
// read /proc.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync,
  rmSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {nodeCommand, runProcess} from './process.mjs';

assert.equal(process.platform, 'linux', 'the orphan and profile checks read /proc');
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const fixture = join(here, 'fixtures/vitest-browser');
const {values} = parseArgs({options: {cli: {type: 'string'}, deps: {type: 'string'}, cases: {type: 'string'}}});
assert.ok(values.cli, 'usage: node benchmarks/proofs/vitest-browser-check.mjs --cli PATH [--deps DIR] [--cases LIST]');
const cli = realpathSync(resolve(values.cli));
const dependencies = join(resolve(values.deps ?? fixture), 'node_modules');
assert.ok(existsSync(join(dependencies, '@vitest/browser-playwright')), `install the fixture first: npm ci --prefix ${relative(repo, fixture)}`);

const controls = {
  assertion: ["test('assertion',()=>expect(ready).toBe(true));", 'killed'],
  survived: ["test('unchanged',()=>expect(typeof ready).toBe('boolean'));", 'survived'],
  'clean-hooks': ["beforeEach(()=>{});afterEach(()=>{});test('assertion',()=>expect(ready).toBe(true));", 'killed'],
  'assertion-count': ["test('count',()=>{expect.assertions(1);if(ready)expect(ready).toBe(true);});", 'killed'],
  'before-all': ["beforeAll(()=>{if(!ready)throw Error('setup');});test('blocked',()=>{});", 'execution-error'],
  'before-each': ["beforeEach(()=>{if(!ready)throw Error('setup');});test('blocked',()=>{});", 'execution-error'],
  'after-each': ["afterEach(()=>{if(!ready)throw Error('cleanup');});test('passed',()=>{});", 'execution-error'],
  cleanup: ["beforeEach(()=>()=>{if(!ready)throw Error('cleanup');});test('passed',()=>{});", 'execution-error'],
  mixed: ["afterEach(()=>{if(!ready)throw Error('cleanup');});test('assertion',()=>expect(ready).toBe(true));", 'execution-error'],
  timeout: ["test('timeout',()=>ready?Promise.resolve():new Promise(()=>{}),50);", 'timed-out'],
  'hook-timeout': ["beforeEach(()=>ready?Promise.resolve():new Promise(()=>{}),50);test('blocked',()=>{});", 'timed-out'],
  'import-error': ["if(!ready)throw Error('load');test('blocked',()=>{});", 'execution-error'],
  'around-each': ["aroundEach(async(run)=>{await run();if(!ready)throw Error('around cleanup');});test('passed',()=>{});", 'execution-error'],
  unhandled: ["test('background',async()=>{if(!ready)void Promise.reject(Error('background'));await new Promise(r=>setTimeout(r,10));});", 'execution-error'],
  'application-error': ["test('application',()=>{if(!ready)throw new TypeError('application');});", 'killed'],
  // A renderer crash closes Vitest's connection to the page mid-test.
  'page-crash': ["import {commands} from 'vitest/browser';test('crash',async()=>{if(!ready){await (commands as any).crashPage();await new Promise(r=>setTimeout(r,5000));}});",
    'execution-error', {crash: true}],
};
// The mutant runs past the job deadline: asynchronously, or by blocking the page
// so that no in-page timeout can fire.
const deadlines = {
  deadline: "test('slow',async()=>{if(!ready)await new Promise(r=>setTimeout(r,120000));},180000);",
  'blocked-page': "test('blocked',()=>{while(!ready){}},180000);",
};
const baselineRejections = {
  // A user's Node-mode runner setting, which browser mode silently ignores.
  'missing-evidence': {setup: false, runner: true},
  'replayed-identity': {identity: "'replayed-execution'"},
  retry: {body: "test('retry',{retry:1},()=>{});"},
  repeat: {body: "test('repeat',{repeats:1},()=>{});"},
  'expected-failure': {body: "test.fails('expected',()=>{throw Error('expected');});"},
  concurrent: {body: "test.concurrent('concurrent',()=>{});"},
};
const allCases = ['stack', 'workers', 'switching-closed', 'switching', 'coverage-maps', 'node-reference',
  ...Object.keys(controls), ...Object.keys(baselineRejections), 'timeout-continues', ...Object.keys(deadlines), 'cancellation'];
const cases = values.cases?.split(',').map(name => name.trim()) ?? allCases;
assert.ok(cases.every(name => allCases.includes(name)), `--cases must name: ${allCases.join(', ')}`);

mkdirSync(join(repo, 'work/assurance-proofs'), {recursive: true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/vitest-browser-check-'));
const project = join(work, 'input');
const scratch = join(work, 'scratch');
// Playwright creates Chromium profiles under TMPDIR; a private one makes leaks visible.
const tmp = join(work, 'tmp');
for (const path of [project, scratch, tmp]) mkdirSync(path);
const fixtureFiles = ['package.json', 'tsconfig.json', 'evidence-setup.ts', 'meter.tsx', 'gain.ts', 'meter.test.tsx', 'gain.test.ts'];
for (const name of fixtureFiles) cpSync(join(fixture, name), join(project, name));
cpSync(dependencies, join(project, 'node_modules'), {recursive: true, verbatimSymlinks: true});
const version = name => JSON.parse(readFileSync(join(project, 'node_modules', name, 'package.json'), 'utf8')).version;
const environment = {node: process.version, cli: (await runProcess(cli, ['--version'], repo)).stdout.trim(),
  tools: Object.fromEntries(['vitest', '@vitest/browser', '@vitest/browser-playwright', '@vitest/coverage-istanbul',
    'playwright', 'react', 'react-dom', 'typescript'].map(name => [name, version(name)])),
  browser: JSON.parse(readFileSync(join(project, 'node_modules/playwright-core/browsers.json'), 'utf8')).browsers
    .filter(({name}) => name.startsWith('chromium')).map(({name, revision, browserVersion}) => ({name, revision, browserVersion}))};
const results = {version: 1, environment, work: relative(repo, work), cases, runs: {}};
const sanitize = value => JSON.parse(JSON.stringify(value).replaceAll(work, '<work>'));
const save = () => writeFileSync(join(work, 'result.json'), JSON.stringify(sanitize(results), null, 2) + '\n');

function vitestConfig({include = ['meter.test.tsx', 'gain.test.ts'], sources = ['meter.tsx', 'gain.ts'],
  setup = true, identity = 'process.env.SESHAT_EXECUTION_ID', switching = false, browser = true, crash = false, runner = false} = {}) {
  const provide = `{seshatExecutionId:${identity}${switching ? ",seshatMutantId:process.env.SESHAT_MUTANT_ID ?? '-1'" : ''}}`;
  writeFileSync(join(project, 'vitest.config.mjs'), `import {playwright} from '@vitest/browser-playwright';
${crash ? "const crashPage=async({page})=>{const cdp=await page.context().newCDPSession(page);await cdp.send('Page.crash').catch(()=>{});};" : ''}
export default {cacheDir:'.vite',test:{${runner ? 'runner:process.env.SESHAT_VITEST_RUNNER,' : ''}include:${JSON.stringify(include)},provide:${provide},
  ${setup ? "setupFiles:['./evidence-setup.ts']," : ''}
  ${browser ? `browser:{enabled:true,headless:true,provider:playwright(),${crash ? 'commands:{crashPage},' : ''}instances:[{browser:'chromium'}]},` : ''}
  coverage:{provider:'istanbul',include:${JSON.stringify(sources)},reporter:['json'],reportsDirectory:'coverage'}}};
`);
}
const vitest = [nodeCommand, 'node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.mjs',
  '--maxWorkers=1', '--no-file-parallelism', '--reporter=default', '--reporter={seshatReporter}'];
const baseConfig = {source: {include: ['meter.tsx', 'gain.ts']},
  capture: [...fixtureFiles, 'vitest.config.mjs', 'node_modules'],
  setups: [{name: 'browser', runner: 'vitest', cwd: '.', timeoutMs: 60000,
    typecheck: [nodeCommand, 'node_modules/typescript/bin/tsc', '--project', 'tsconfig.json'],
    test: vitest, coverage: {command: [...vitest, '--coverage'], report: 'coverage/coverage-final.json'}}]};
function controlConfig(name, body) {
  writeFileSync(join(project, 'control.ts'), 'export const ready = 1 === 1;\n');
  writeFileSync(join(project, 'control.test.ts'), `import {test,expect,beforeAll,beforeEach,afterEach,aroundEach} from 'vitest';import {ready} from './control.ts';\n${body}\n`);
  const config = structuredClone(baseConfig);
  config.source.include = ['control.ts'];
  config.mutationOperators = ['comparison'];
  config.capture.push('control.ts', 'control.test.ts');
  return config;
}

// Any process still carrying this proof's TMPDIR outlived its job.
function owned() {
  const pids = [];
  for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    try {
      if (readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').includes(`TMPDIR=${tmp}`)) pids.push(Number(pid));
    } catch {}
  }
  return pids;
}
function processCommand(pid) {
  try { return readlinkSync(`/proc/${pid}/exe`); } catch { return null; }
}
// Execution IDs of jobs that currently have Chromium running.
function browserJobs() {
  const ids = new Set();
  for (const pid of owned()) {
    try {
      if (!/chrom/i.test(processCommand(pid) ?? '')) continue;
      const id = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').find(entry => entry.startsWith('SESHAT_EXECUTION_ID='));
      if (id) ids.add(id);
    } catch {}
  }
  return ids;
}
// A killed job cannot run Playwright's Node-side cleanup, so each one leaves
// a Chromium profile and an artifacts directory. Record and then remove them.
async function assertCleanedUp(name, killedJobs = 0) {
  // Chromium exits on its own when its pipe to Playwright closes; allow it a moment.
  for (let attempt = 0; attempt < 50 && owned().length; attempt++) await delay(100);
  const leftovers = owned().map(pid => ({pid, command: processCommand(pid)}));
  // Vitest's Node mode can leave its own temporary directory; only browser
  // profiles are in scope here, but every leftover is recorded.
  const temporary = readdirSync(tmp);
  const profiles = temporary.filter(entry => entry.startsWith('playwright'));
  results.runs[name].cleanup = {processes: leftovers, temporary};
  save();
  assert.deepEqual(leftovers, [], `${name}: processes outlived the run`);
  const leaked = prefix => profiles.filter(entry => entry.startsWith(prefix)).length;
  assert.equal(leaked('playwright_chromiumdev_profile-'), killedJobs, `${name}: unexpected browser profiles ${profiles}`);
  assert.equal(leaked('playwright-artifacts-'), killedJobs, `${name}: unexpected browser artifacts ${profiles}`);
  assert.equal(profiles.length, 2 * killedJobs, `${name}: unexpected Playwright files ${profiles}`);
  for (const entry of profiles) rmSync(join(tmp, entry), {recursive: true});
  assert.deepEqual(readdirSync(scratch), [], `${name}: scratch retained`);
}

async function check(name, config, flags = [], killedJobs = 0) {
  writeFileSync(join(project, 'seshat.json'), JSON.stringify(config));
  const run = await runProcess(cli, ['check', '--config', join(project, 'seshat.json'), '--scratch', scratch,
    '--json', '--no-progress', ...flags], project, {TMPDIR: tmp}, 900000);
  assert.equal(run.timedOut, false); assert.equal(run.overflow, false);
  const {result} = JSON.parse(run.stdout);
  results.runs[name] = {config, flags, status: run.status, stderr: run.stderr, wallMs: run.ms, result: sanitize(result)};
  save();
  assert.equal(run.status, result.complete ? 0 : 2, run.stderr);
  await assertCleanedUp(name, killedJobs);
  for (const file of fixtureFiles) assert.equal(readFileSync(join(project, file), 'utf8'), readFileSync(join(fixture, file), 'utf8'));
  console.log(`${name}: complete=${result.complete}, score=${result.mutation?.score}, ${Math.round(run.ms)}ms`);
  return result;
}
// Records the most jobs that had Chromium running at the same moment.
async function sampled(name, run) {
  let peak = 0;
  const sampler = setInterval(() => { peak = Math.max(peak, browserJobs().size); }, 200);
  try { return await run(); } finally {
    clearInterval(sampler);
    if (results.runs[name]) { results.runs[name].concurrentBrowserJobs = peak; save(); }
  }
}
const definitions = result => result.mutation.outcomes.map(({setups, executionMs, ...row}) => row);
const jobMs = phase => phase.outcomes.flatMap(row => row.setups.map(setup => setup.ms));
const mean = numbers => numbers.reduce((a, b) => a + b, 0) / numbers.length;

if (cases.includes('stack')) {
  vitestConfig();
  const result = await sampled('stack', () => check('stack', baseConfig));
  // One worker: no job's browser may still run when the next job starts.
  assert.equal(results.runs.stack.concurrentBrowserJobs, 1);
  assert.equal(result.complete, true);
  assert.deepEqual(result.diagnostics.runnerVersions[0].importFailureObserver, {state: 'inactive', reason: 'runner'});
  assert.equal(result.setups[0].baseline.report.passed, 3);
  assert.deepEqual(result.sources.map(source => [source.path, source.result.complete,
    source.result.functions.map(f => [f.name, f.complexity, f.coverageBasis, f.covered, f.crap])]), [
    ['gain.ts', true, [['renderPeak', 4, 'branch', 11, 4], ['describeLevel', 3, 'branch', 1, 3.140625]]],
    ['meter.tsx', true, [['Meter', 1, 'statement', 2, 1], ['arrow@174', 3, 'branch', 1, 3.140625],
      ['mountMeter', 4, 'branch', 4, 6], ['arrow@481', 1, 'statement', 1, 1], ['arrow@741', 1, 'statement', 1, 1]]],
  ]);
  assert.deepEqual([result.mutation.planned, result.mutation.killed, result.mutation.survived, result.mutation.unresolved], [19, 13, 6, 0]);
  // Browser runs lack verified file attribution, so every mutant runs the full command.
  assert.ok(result.mutation.outcomes.every(row => row.setups[0].selection.reason === 'attribution-unavailable'));
  results.runs.stack.cost = {baselineMs: result.phaseTimings.baselineMs, coverageMs: result.phaseTimings.coverageMs,
    meanMutantJobMs: mean(jobMs(result.mutation)), mutants: result.mutation.planned};
  save();
}
if (cases.includes('workers')) {
  vitestConfig();
  const result = await sampled('workers', () => check('workers', {...baseConfig, workers: 2}));
  assert.equal(result.complete, true);
  assert.equal(result.mutation.workersUsed, 2);
  if (results.runs.stack) assert.deepEqual(definitions(result), definitions(results.runs.stack.result));
  // Each job starts its own Vitest server and browser; both workers must have run at once.
  assert.equal(results.runs.workers.concurrentBrowserJobs, 2, 'the two workers never ran browsers at the same time');
  results.runs.workers.cost = {mutationWallMs: result.mutation.mutationWallMs,
    singleWorkerMutationWallMs: results.runs.stack?.result.mutation.mutationWallMs ?? null};
  save();
}
if (cases.includes('switching-closed')) {
  // Without the forwarded mutant ID, the switching guard throws on load, so the
  // prepared baseline fails and no mutant runs.
  vitestConfig();
  const result = await check('switching-closed', baseConfig, ['--experimental-switching']);
  assert.equal(result.complete, false);
  assert.equal(result.setups[0].baseline.state, 'passed');
  assert.equal(result.mutation.preparedBaselines.length, 1);
  // The 'switching' case differs only by forwarding the ID, and passes.
  const prepared = result.mutation.preparedBaselines[0];
  assert.equal(prepared.state, 'execution-error');
  assert.equal(prepared.report.passed, 0);
  assert.ok(prepared.report.errors > 0);
  assert.equal(result.mutation.jobsAttempted, 0);
  assert.ok(result.mutation.outcomes.every(row => row.verdict === 'not-run'));
}
if (cases.includes('switching')) {
  vitestConfig({switching: true});
  const result = await check('switching', baseConfig, ['--experimental-switching']);
  assert.equal(result.complete, true);
  assert.equal(result.mutation.strategy, 'switch');
  if (results.runs.stack) {
    const verdicts = r => r.mutation.outcomes.map(({path, offset, kind, replacement, verdict}) => ({path, offset, kind, replacement, verdict}));
    assert.deepEqual(verdicts(result), verdicts(results.runs.stack.result));
  }
}
if (cases.includes('coverage-maps')) {
  // Instrumentation maps must match the Node route for the same sources.
  writeFileSync(join(project, 'maps.test.ts'), "import {test} from 'vitest';import './meter.tsx';import {describeLevel} from './gain.ts';test('load',()=>{describeLevel(0);});\n");
  const maps = {};
  for (const browser of [false, true]) {
    vitestConfig({include: ['maps.test.ts'], setup: false, browser});
    rmSync(join(project, 'coverage'), {recursive: true, force: true});
    const run = await runProcess(nodeCommand, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.mjs', '--coverage'],
      project, {TMPDIR: tmp}, 120000);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const report = JSON.parse(readFileSync(join(project, 'coverage/coverage-final.json'), 'utf8'));
    maps[browser ? 'browser' : 'node'] = Object.fromEntries(Object.entries(report).map(([path, entry]) =>
      [relative(project, path), {statementMap: entry.statementMap, branchMap: entry.branchMap, fnMap: entry.fnMap}]));
  }
  assert.deepEqual(Object.keys(maps.browser).sort(), ['gain.ts', 'meter.tsx']);
  assert.deepEqual(maps.browser, maps.node);
  results.runs['coverage-maps'] = {files: Object.fromEntries(Object.entries(maps.browser).map(([path, map]) =>
    [path, {statements: Object.keys(map.statementMap).length, branches: Object.keys(map.branchMap).length,
      functions: Object.keys(map.fnMap).length}])), identical: true};
  await assertCleanedUp('coverage-maps');
  rmSync(join(project, 'maps.test.ts'));
  console.log('coverage-maps: browser and Node Istanbul maps are identical');
}
for (const [name, [body, expected, options]] of Object.entries(controls)) {
  if (!cases.includes(name)) continue;
  const config = controlConfig(name, body);
  vitestConfig({include: ['control.test.ts'], sources: ['control.ts'], ...options});
  const result = await check(name, config);
  assert.equal(result.setups[0].baseline.state, 'passed', JSON.stringify(result.setups));
  assert.equal(result.setups[0].coverage.state, 'passed', JSON.stringify(result.setups));
  assert.equal(result.mutation.planned, 1);
  assert.equal(result.mutation.outcomes[0].verdict, expected, JSON.stringify(result.mutation.outcomes));
  const complete = ['killed', 'survived'].includes(expected);
  assert.equal(result.complete, complete);
  assert.equal(result.mutation.score, complete ? (expected === 'killed' ? 100 : 0) : null);
  if (expected === 'timed-out') assert.equal(result.mutation.outcomes[0].setups[0].testTimedOut, true);
}
if (cases.includes('node-reference')) {
  // The same control in Vitest's Node mode isolates the browser launch cost.
  const config = controlConfig('node-reference', controls.assertion[0]);
  vitestConfig({include: ['control.test.ts'], sources: ['control.ts'], setup: false, browser: false, runner: true});
  const result = await check('node-reference', config);
  assert.equal(result.mutation.outcomes[0].verdict, 'killed');
  const browser = results.runs.assertion?.result;
  results.runs['node-reference'].cost = {nodeMutantJobMs: mean(jobMs(result.mutation)),
    browserMutantJobMs: browser ? mean(jobMs(browser.mutation)) : null};
  save();
}
for (const [name, options] of Object.entries(baselineRejections)) {
  if (!cases.includes(name)) continue;
  const config = controlConfig(name, options.body ?? controls.assertion[0]);
  vitestConfig({include: ['control.test.ts'], sources: ['control.ts'], ...options});
  const result = await check(name, config);
  assert.equal(result.complete, false);
  assert.equal(result.setups[0].baseline.state, 'execution-error', JSON.stringify(result.setups[0].baseline));
  assert.equal(result.mutation.jobsAttempted, 0);
}
if (cases.includes('timeout-continues')) {
  // A runner-reported timeout must not stop later mutants (#156).
  const config = controlConfig('timeout-continues', "test('completion',()=>ready?Promise.resolve():new Promise(()=>{}),50);test('comparisons',()=>{expect(later).toBe(true);expect(last).toBe(true);});");
  writeFileSync(join(project, 'control.ts'), 'export const ready = 1 === 1;\nexport const later = 2 === 2;\nexport const last = 3 === 3;\n');
  writeFileSync(join(project, 'control.test.ts'), readFileSync(join(project, 'control.test.ts'), 'utf8')
    .replace('import {ready}', 'import {ready,later,last}'));
  vitestConfig({include: ['control.test.ts'], sources: ['control.ts']});
  const result = await check('timeout-continues', config);
  assert.deepEqual(result.mutation.outcomes.map(row => row.verdict), ['timed-out', 'killed', 'killed']);
  assert.equal(result.mutation.outcomes[0].setups[0].testTimedOut, true);
  assert.equal(result.mutation.notRun, 0);
  assert.equal(result.complete, false);
  assert.equal(result.mutation.score, null);
}
for (const [name, body] of Object.entries(deadlines)) {
  if (!cases.includes(name)) continue;
  // Chromium runs in its own process group, so Seshat's group kill cannot reach
  // it; it must exit when its pipe to the killed Vitest process closes.
  const config = controlConfig(name, body);
  config.setups[0].timeoutMs = 20000;
  vitestConfig({include: ['control.test.ts'], sources: ['control.ts']});
  const result = await check(name, config, [], 1);
  const row = result.mutation.outcomes[0];
  assert.equal(row.verdict, 'timed-out', JSON.stringify(row));
  assert.equal(row.setups[0].timedOut, true);
  assert.equal(result.complete, false);
  assert.equal(result.mutation.score, null);
}
if (cases.includes('cancellation')) {
  const config = controlConfig('cancellation', "test('slow',async()=>{if(!ready)await new Promise(r=>setTimeout(r,120000));},180000);");
  config.setups[0].timeoutMs = 180000;
  vitestConfig({include: ['control.test.ts'], sources: ['control.ts']});
  writeFileSync(join(project, 'seshat.json'), JSON.stringify(config));
  const started = performance.now();
  const child = spawn(cli, ['check', '--config', join(project, 'seshat.json'), '--scratch', scratch, '--json', '--no-progress'],
    {cwd: project, env: {...process.env, TMPDIR: tmp}, stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '', stderr = '', exit;
  child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
  const closed = new Promise(done => child.once('close', (status, signal) => { exit = {status, signal}; done(); }));
  try {
    // Wait for Chromium inside the mutant job, then let the test enter its wait.
    const mutantBrowser = () => [...browserJobs()].some(id => id.includes('-mutant-'));
    const deadline = performance.now() + 120000;
    while (!mutantBrowser()) {
      assert.equal(exit, undefined, `cancellation ended early: ${stderr}`);
      assert.ok(performance.now() < deadline, 'mutant browser did not start');
      await delay(50);
    }
    await delay(2000);
    child.kill('SIGINT');
    await closed;
  } finally {
    if (!exit) { child.kill('SIGKILL'); await closed; }
  }
  const {result} = JSON.parse(stdout);
  results.runs.cancellation = {config, status: exit.status, stderr, wallMs: performance.now() - started, result: sanitize(result)};
  assert.equal(exit.status, 130, stderr);
  assert.equal(result.mutation.outcomes[0].verdict, 'cancelled');
  assert.equal(result.mutation.score, null);
  await assertCleanedUp('cancellation', 1);
  console.log('cancellation: cancelled cleanly');
}
save();
// The full report keeps raw receipts and output; the summary is portable.
const summary = {version: 1, environment, platform: `${process.platform}-${process.arch}`, cases: Object.fromEntries(
  Object.entries(results.runs).map(([name, run]) => {
    const result = run.result, job = result?.mutation?.outcomes?.[0]?.setups?.[0];
    return [name, result ? {complete: result.complete, score: result.mutation?.score ?? null,
      baseline: result.setups[0].baseline.state, planned: result.mutation.planned, killed: result.mutation.killed,
      survived: result.mutation.survived, unresolved: result.mutation.unresolved,
      firstVerdict: result.mutation.outcomes[0]?.verdict ?? null,
      testTimedOut: job?.testTimedOut ?? null, deadlineReached: job?.timedOut ?? null,
      leftoverProcesses: run.cleanup?.processes.length ?? null,
      leftoverBrowserFiles: run.cleanup?.temporary.filter(entry => entry.startsWith('playwright')) ?? null,
      wallMs: Math.round(run.wallMs ?? 0), ...(run.cost ? {cost: run.cost} : {}),
      ...(run.concurrentBrowserJobs ? {concurrentBrowserJobs: run.concurrentBrowserJobs} : {})}
      : {files: run.files, identical: run.identical}];
  }))};
writeFileSync(join(work, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
if (process.env.SESHAT_PROOF_OUTPUT) cpSync(join(work, 'summary.json'), process.env.SESHAT_PROOF_OUTPUT);
console.log(`vitest-browser-check: ${cases.length} cases passed; ${relative(repo, work)}`);
