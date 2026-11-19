// Proof for Vitest 5 browser mode (#159, #293). It drives the native CLI with
// the embedded browser plugin, which browser mode needs instead of the runner.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync,
  rmSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {killTree, nodeCommand, runProcess} from './process.mjs';

const windows = process.platform === 'win32';
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const fixture = join(here, 'fixtures/vitest-browser');
const {values} = parseArgs({options: {cli: {type: 'string'}, deps: {type: 'string'}, cases: {type: 'string'},
  skip: {type: 'string'}, browser: {type: 'string', default: 'chromium'}, cost: {type: 'string'}}});
assert.ok(values.cost === undefined || ['default', 'cold', 'no-screenshots'].includes(values.cost));
// Playwright's install name for each browser.
const builds = {chromium: 'chromium-headless-shell', firefox: 'firefox'};
const browserName = values.browser, build = builds[browserName];
assert.ok(build, `--browser must be one of: ${Object.keys(builds).join(', ')}`);
assert.ok(values.cli, 'usage: node benchmarks/proofs/vitest-browser-check.mjs --cli PATH [--browser chromium|firefox] [--deps DIR] [--cases LIST] [--skip LIST]');
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
  // A soft failure in afterEach records an error without throwing. The adapter's
  // snapshot is taken before cleanup, so it is a cleanup failure, not a kill.
  'soft-after-each': ["afterEach(()=>{expect.soft(ready).toBe(true);});test('passed',()=>{});", 'execution-error'],
  'nested-hooks': ["describe('outer',()=>{beforeEach(()=>{});describe('inner',()=>{afterEach(()=>{});test('assertion',()=>expect(ready).toBe(true));});});", 'killed'],
  'nested-before-each': ["describe('outer',()=>{describe('inner',()=>{beforeEach(()=>{if(!ready)throw Error('setup');});test('blocked',()=>{});});});", 'execution-error'],
  'nested-after-each': ["describe('outer',()=>{describe('inner',()=>{afterEach(()=>{if(!ready)throw Error('cleanup');});test('passed',()=>{});});});", 'execution-error'],
  // The setup file runs twice on one runner; the second run must not wrap again.
  'setup-twice': ["test('assertion',()=>expect(ready).toBe(true));", 'killed', {twice: true}],
  // A renderer crash closes Vitest's connection to the page mid-test. Firefox has
  // no DevTools Protocol, and its crash page is reported as a close, so for
  // Firefox this shows only that a page lost mid-test is handled.
  'page-crash': ["import {commands} from 'vitest/browser';test('crash',async()=>{if(!ready){await (commands as any).crashPage();await new Promise(r=>setTimeout(r,5000));}});",
    'execution-error', {crash: true}],
};
// An unresolved first mutant must not stop the next two (#156). Same rule as
// the Node proof's operator-timeout-continues and operator-crash-continues.
const continuations = {
  'continue-after-timeout': ["test('first',()=>ready?Promise.resolve():new Promise(()=>{}),50);", 'timed-out', {}],
  'continue-after-crash': ["import {commands} from 'vitest/browser';test('first',async()=>{if(!ready){await (commands as any).crashPage();await new Promise(r=>setTimeout(r,5000));}});",
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
  // A later plugin replaces the identity the page receives.
  'replayed-identity': {replayed: true},
  retry: {body: "test('retry',{retry:1},()=>{});"},
  repeat: {body: "test('repeat',{repeats:1},()=>{});"},
  'expected-failure': {body: "test.fails('expected',()=>{throw Error('expected');});"},
  concurrent: {body: "test.concurrent('concurrent',()=>{});"},
  // The page's evidence must have exactly the types the adapter writes.
  'mistyped-evidence': {body: "test('mistyped',({task})=>{(task.meta as any).seshat.entered='yes';});"},
  'partial-evidence': {body: "test('partial',({task})=>{delete (task.meta as any).seshat.unsupported;});"},
  'missing-snapshot': {body: "afterEach(({task})=>{delete (task.meta as any).seshat.beforeCleanup;});test('passed',()=>{});"},
  // A user setup file runs before Seshat's and changes the runner the way a
  // Vitest release could. The baseline must name the missing piece.
  'missing-runner-global': {runnerChange: "Object.defineProperty(browser,'runner',{value:undefined});",
    problem: 'window.__vitest_browser_runner__.runner is missing'},
  'missing-before-run-task': {runnerChange: 'browser.runner.onBeforeRunTask=undefined;', problem: 'runner.onBeforeRunTask is not a function'},
  'missing-task-finished': {runnerChange: 'browser.runner.onTaskFinished=undefined;', problem: 'runner.onTaskFinished is not a function'},
  'existing-run-task': {runnerChange: 'browser.runner.runTask=async()=>{};', problem: 'runner.runTask already exists'},
  'missing-get-test-fn': {runnerChange: '(TestRunner as any).getTestFn=undefined;', problem: 'TestRunner.getTestFn is not a function'},
  // Setups the proof has not covered. Two Chromium instances need no second browser install.
  'two-instances': {instances: 2, unsupported: 'unsupported Vitest browser setup: 2 browser instances; supported: 1'},
  'no-isolation': {isolate: false, unsupported: 'unsupported Vitest browser setup: isolate false; supported: true'},
};
const allCases = ['stack', 'workers', 'switching-closed', 'coverage-maps', 'node-reference', 'custom-launch',
  ...Object.keys(controls), ...Object.keys(baselineRejections), ...Object.keys(continuations), ...Object.keys(deadlines),
  'connect-retry', 'never-connects', 'later-file-stall', 'counted-load-hang', 'cancellation'];
const list = option => option?.split(',').map(name => name.trim());
const skipped = list(values.skip) ?? [];
const cases = (list(values.cases) ?? allCases).filter(name => !skipped.includes(name));
assert.ok([...cases, ...skipped].every(name => allCases.includes(name)), `--cases and --skip must name: ${allCases.join(', ')}`);

mkdirSync(join(repo, 'work/assurance-proofs'), {recursive: true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/vitest-browser-check-'));
const project = join(work, 'input');
const scratch = join(work, 'scratch');
// Playwright creates browser profiles under TMPDIR; a private one makes leaks visible.
// Windows reads TEMP and TMP instead of TMPDIR.
const tmp = join(work, 'tmp');
const temporaryEnv = {TMPDIR: tmp, TEMP: tmp, TMP: tmp,
  ...(values.cost ? {SESHAT_COST_MODE: values.cost, SESHAT_COST_TRACE: join(work, 'cache.jsonl')} : {})};
for (const path of [project, scratch, tmp]) mkdirSync(path);
const fixtureFiles = ['package.json', 'tsconfig.json', 'meter.tsx', 'gain.ts', 'meter.test.tsx', 'gain.test.ts'];
for (const name of fixtureFiles) cpSync(join(fixture, name), join(project, name));
if (values.cost) cpSync(join(here, 'vitest-browser-cost-reporter.mjs'), join(project, 'cost-reporter.mjs'));
cpSync(dependencies, join(project, 'node_modules'), {recursive: true, verbatimSymlinks: true});
const version = name => JSON.parse(readFileSync(join(project, 'node_modules', name, 'package.json'), 'utf8')).version;
const environment = {node: process.version, cli: (await runProcess(cli, ['--version'], repo)).stdout.trim(),
  tools: Object.fromEntries(['vitest', '@vitest/browser', '@vitest/browser-playwright', '@vitest/coverage-istanbul',
    'playwright', 'react', 'react-dom', 'typescript'].map(name => [name, version(name)])),
  browser: JSON.parse(readFileSync(join(project, 'node_modules/playwright-core/browsers.json'), 'utf8')).browsers
    .filter(({name}) => name === build).map(({name, revision, browserVersion}) => ({name, revision, browserVersion}))};
// The install directory is in every browser process's path, and not in this
// proof's own arguments.
const browserDirectory = `${build.replaceAll('-', '_')}-${environment.browser[0].revision}`;
const results = {version: 1, environment, work: relative(repo, work), cases, runs: {}};
// JSON escapes Windows path separators, and Vite prints them as forward
// slashes, so replace those forms too.
const sanitize = value => JSON.parse([JSON.stringify(work).slice(1, -1), work.replaceAll('\\', '/'), work]
  .reduce((text, path) => text.replaceAll(path, '<work>'), JSON.stringify(value)));
const save = () => writeFileSync(join(work, 'result.json'), JSON.stringify(sanitize(results), null, 2) + '\n');

function vitestConfig({include = ['meter.test.tsx', 'gain.test.ts'], sources = ['meter.tsx', 'gain.ts'],
  setup = true, replayed = false, twice = false, runnerChange, browser = true, crash = false, entered = false, runner = false,
  instances = 1, isolate = true, providerOptions = '', connectTimeout = 20000, refuse} = {}) {
  const plugins = [setup && 'process.env.SESHAT_VITEST_BROWSER&&import(process.env.SESHAT_VITEST_BROWSER).then(m=>m.default)',
    replayed && "{name:'replay',config:()=>({test:{provide:{seshatExecutionId:'replayed-execution'}}})}",
    // A query makes Vite evaluate the same setup file a second time.
    twice && "{name:'twice',config:()=>({test:{setupFiles:[fileURLToPath(new URL('vitest-browser-setup.mjs',process.env.SESHAT_VITEST_BROWSER))+'?twice']}})}",
    // Refusing Vitest's browser websocket stands in for vitest-dev/vitest#10166:
    // the page never runs a test file. 'first' refuses only a mutant's first
    // attempt; 'later-file' refuses only the frames of its second and later files.
    refuse && `{name:'refuse',configureServer(server){const id=process.env.SESHAT_EXECUTION_ID??'';let testers=0;
  if(id.includes('-mutant-')&&(${refuse === 'always'}||!id.endsWith('-retry')))server.httpServer.prependListener('upgrade',(request,socket)=>{
    if(request.url.includes('__vitest_browser_api__')&&(${refuse !== 'later-file'}||request.url.includes('type=tester')&&++testers>1))
      socket.destroy();});}}`,
  ].filter(Boolean);
  if (runnerChange) writeFileSync(join(project, 'user-setup.ts'),
    `import {TestRunner} from 'vitest';\nconst browser = (window as any).__vitest_browser_runner__;\n${runnerChange}\n`);
  const commands = [crash && 'crashPage', entered && 'entered'].filter(Boolean);
  // A short connectTimeout makes a stalled connection (vitest-dev/vitest#10166)
  // fail with Vitest's own message before Seshat's job deadline.
  writeFileSync(join(project, 'vitest.config.mjs'), `import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '@vitest/browser-playwright';
${values.cost ? "import {begin} from './cost-reporter.mjs';begin();" : ''}
${crash ? (browserName === 'chromium'
    ? "const crashPage=async({page})=>{const cdp=await page.context().newCDPSession(page);await cdp.send('Page.crash').catch(()=>{});};"
    : "const crashPage=async({page})=>{await page.goto('about:crashcontent').catch(()=>{});};") : ''}
${entered ? "const entered=async()=>{writeFileSync(process.env.SESHAT_CONSOLE_READY,'entered');};" : ''}
export default {cacheDir:'.vite',plugins:[${plugins}],test:{${runner ? 'runner:process.env.SESHAT_VITEST_RUNNER,' : ''}include:${JSON.stringify(include)},
  ${runnerChange ? "setupFiles:['./user-setup.ts']," : ''}${isolate ? '' : 'isolate:false,'}
  ${browser ? `browser:{enabled:true,headless:true,${values.cost === 'no-screenshots' ? 'screenshotFailures:false,' : ''}connectTimeout:${connectTimeout},provider:playwright(${providerOptions}),${commands.length ? `commands:{${commands}},` : ''}instances:${
    JSON.stringify(Array.from({length: instances}, (_, index) => ({browser: browserName, name: `${browserName}-${index + 1}`})))}},` : ''}
  coverage:{provider:'istanbul',include:${JSON.stringify(sources)},reporter:['json'],reportsDirectory:'coverage'}}};
`);
}
const vitest = [nodeCommand, 'node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.mjs',
  '--maxWorkers=1', '--no-file-parallelism', '--reporter=default', '--reporter={seshatReporter}',
  ...(values.cost ? ['--reporter=./cost-reporter.mjs'] : [])];
const baseConfig = {source: {include: ['meter.tsx', 'gain.ts']},
  capture: [...fixtureFiles, 'vitest.config.mjs', 'node_modules', ...(values.cost ? ['cost-reporter.mjs'] : [])],
  setups: [{name: 'browser', runner: 'vitest', cwd: '.', timeoutMs: 60000,
    typecheck: [nodeCommand, 'node_modules/typescript/bin/tsc', '--project', 'tsconfig.json'],
    test: vitest, coverage: {command: [...vitest, '--coverage'], report: 'coverage/coverage-final.json'}}]};
function controlConfig(name, body) {
  writeFileSync(join(project, 'control.ts'), 'export const ready = 1 === 1;\n');
  writeFileSync(join(project, 'control.test.ts'), `import {test,expect,describe,beforeAll,beforeEach,afterEach,aroundEach} from 'vitest';import {ready} from './control.ts';\n${body}\n`);
  const config = structuredClone(baseConfig);
  config.source.include = ['control.ts'];
  config.mutationOperators = ['comparison'];
  config.capture.push('control.ts', 'control.test.ts');
  return config;
}

// Processes a job started that are still running. Linux matches this proof's
// temp directory or a job's private one inside scratch. macOS and Windows cannot
// read another process's environment,
// so they match the job's commands, which assumes no other Vitest or Playwright
// browser runs on the host, as on a CI runner. `job` identifies a running job.
function owned() {
  if (process.platform === 'linux') {
    const found = [];
    for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
      try {
        const environment = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
        if (!environment.some(entry => entry === `TMPDIR=${tmp}` || entry.startsWith(`TMPDIR=${scratch}/`))) continue;
        let command = null;
        try { command = readlinkSync(`/proc/${pid}/exe`); } catch {}
        found.push({pid: Number(pid), command, job: environment.find(entry => entry.startsWith('SESHAT_EXECUTION_ID='))});
      } catch {}
    }
    return found;
  }
  const listing = windows
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }'], {encoding: 'utf8'})
    : spawnSync('ps', ['-axww', '-o', 'pid=,args='], {encoding: 'utf8'});
  assert.equal(listing.status, 0, listing.stderr);
  return listing.stdout.split(/\r?\n/).map(line => line.match(/^\s*(\d+)\s+(.*)$/)).filter(Boolean)
    .filter(([, , command]) => command.includes(browserDirectory) || /vitest\.mjs|esbuild/i.test(command))
    .map(([, pid, command]) => ({pid: Number(pid), command, job: /vitest\.mjs/.test(command) ? pid : undefined}));
}
// Seshat must remove the job's temporary files even when Playwright cannot.
async function assertCleanedUp(name) {
  // The browser exits on its own when its pipe to Playwright closes; allow it a moment.
  for (let attempt = 0; attempt < 50 && owned().length; attempt++) await delay(100);
  const leftovers = owned().map(({pid, command}) => ({pid, command}));
  // Vitest's Node mode, and Firefox on Windows (mozilla-temp-files), can leave
  // other temporary files; only browser profiles are in scope here, but every
  // leftover is recorded.
  const temporary = readdirSync(tmp);
  const profiles = temporary.filter(entry => entry.startsWith('playwright'));
  results.runs[name].cleanup = {processes: leftovers, temporary};
  save();
  const result = results.runs[name].result;
  if (result) {
    assert.equal(result.cleanupError ?? null, null, `${name}: execution copy cleanup failed`);
    for (const row of [...(result.mutation?.outcomes ?? []), ...(result.pseudoTesting?.outcomes ?? [])]) {
      for (const job of row.setups ?? []) {
        assert.equal(job.cleanupError ?? null, null, `${name}: job cleanup failed`);
        assert.equal(job.browserRetry?.cleanupError ?? null, null, `${name}: retry cleanup failed`);
      }
    }
  }
  assert.deepEqual(leftovers, [], `${name}: processes outlived the run`);
  assert.deepEqual(profiles, [], `${name}: browser files escaped the job's temp directory`);
  assert.deepEqual(readdirSync(scratch), [], `${name}: scratch retained`);
}

async function check(name, config, flags = []) {
  temporaryEnv.SESHAT_COST_CASE = name;
  writeFileSync(join(project, 'seshat.json'), JSON.stringify(config));
  const run = await runProcess(cli, ['check', '--config', join(project, 'seshat.json'), '--scratch', scratch,
    '--json', '--no-progress', ...flags], project, temporaryEnv, 900000);
  assert.equal(run.timedOut, false); assert.equal(run.overflow, false);
  const {result} = JSON.parse(run.stdout);
  results.runs[name] = {config, flags, status: run.status, stderr: run.stderr, wallMs: run.ms, result: sanitize(result)};
  save();
  assert.equal(run.status, result.complete ? 0 : 2, run.stderr);
  await assertCleanedUp(name);
  for (const file of fixtureFiles) assert.equal(readFileSync(join(project, file), 'utf8'), readFileSync(join(fixture, file), 'utf8'));
  console.log(`${name}: complete=${result.complete}, score=${result.mutation?.score}, ${Math.round(run.ms)}ms`);
  return result;
}
// Records the most jobs running at the same moment. Chromium is up for only part
// of each job, so counting browsers alone can miss real overlap. Browsers are
// counted too, to show the leftover check can see one. On Windows each sample
// runs PowerShell; every 200 ms loaded the runner enough to make the stalled
// connection in the workers case far more common.
async function sampled(name, run) {
  let jobs = 0, browsers = 0;
  const sampler = setInterval(() => {
    const processes = owned();
    jobs = Math.max(jobs, new Set(processes.map(({job}) => job).filter(Boolean)).size);
    browsers = Math.max(browsers, processes.filter(({command}) => command?.includes(browserDirectory)).length);
  }, windows ? 1000 : 200);
  try { return await run(); } finally {
    clearInterval(sampler);
    if (results.runs[name]) { Object.assign(results.runs[name], {concurrentJobs: jobs, browserProcesses: browsers}); save(); }
  }
}
const definitions = result => result.mutation.outcomes.map(({setups, executionMs, ...row}) => row);
const jobMs = phase => phase.outcomes.flatMap(row => row.setups.map(setup => setup.ms));
const mean = numbers => numbers.reduce((a, b) => a + b, 0) / numbers.length;

if (cases.includes('stack')) {
  vitestConfig();
  const result = await sampled('stack', () => check('stack', baseConfig));
  // One worker: no job may still run when the next one starts.
  assert.equal(results.runs.stack.concurrentJobs, 1);
  assert.ok(results.runs.stack.browserProcesses > 0, 'the process check never saw a browser');
  assert.equal(result.complete, true);
  assert.deepEqual(result.diagnostics.runnerVersions[0].importFailureObserver, {state: 'inactive', reason: 'runner'});
  assert.equal(result.setups[0].baseline.report.passed, 3);
  assert.deepEqual(result.setups[0].baseline.report.browser,
    [{provider: 'playwright', name: browserName, version: environment.browser[0].browserVersion, isolate: true, headless: true,
      defaultLaunch: true}]);
  assert.equal(result.diagnostics.runnerVersions[0].browser.supported, true);
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
  // Vitest's browser client can miss its ready signal when its first websocket
  // attempt fails, and the page then runs no test (vitest-dev/vitest#10166).
  // Seshat runs such a job once more. Seen here only with two Firefox instances
  // on Windows, so only Windows allows a job whose retry failed too, at most
  // twice. Remove this allowance once Vitest fixes the bug (#299).
  const rows = [...result.mutation.outcomes, ...result.pseudoTesting.outcomes];
  const jobs = [result.setups[0].baseline, result.setups[0].coverage, ...result.mutation.workerBaselines,
    ...rows.flatMap(row => row.setups)];
  const connectFailures = rows.filter(row => row.setups.some(setup => setup.browserConnected === false));
  Object.assign(results.runs.workers, {connectRetries: jobs.filter(job => job.browserRetry).length,
    connectFailures: connectFailures.length});
  save();
  assert.ok(connectFailures.length <= (windows ? 2 : 0), `workers: ${connectFailures.length} jobs failed to connect twice`);
  assert.equal(result.mutation.unresolved + result.pseudoTesting.unresolved, connectFailures.length);
  assert.equal(result.complete, connectFailures.length === 0);
  assert.equal(result.mutation.workersUsed, 2);
  const failed = new Set(result.mutation.outcomes.filter(row => connectFailures.includes(row)).map(row => row.id));
  const resolved = run => definitions(run).filter(row => !failed.has(row.id));
  if (results.runs.stack) assert.deepEqual(resolved(result), resolved(results.runs.stack.result));
  // Each job starts its own Vitest server and browser; both workers must have run at once.
  assert.equal(results.runs.workers.concurrentJobs, 2, 'the two workers never ran jobs at the same time');
  results.runs.workers.cost = {mutationWallMs: result.mutation.mutationWallMs,
    singleWorkerMutationWallMs: results.runs.stack?.result.mutation.mutationWallMs ?? null};
  save();
}
if (cases.includes('switching-closed')) {
  // The page has no process.env, so the switching guard throws on load, the
  // prepared baseline fails and no mutant runs. Switching stays unsupported.
  vitestConfig();
  const result = await check('switching-closed', baseConfig, ['--experimental-switching']);
  assert.equal(result.complete, false);
  assert.equal(result.setups[0].baseline.state, 'passed');
  assert.equal(result.mutation.preparedBaselines.length, 1);
  const prepared = result.mutation.preparedBaselines[0];
  assert.equal(prepared.state, 'execution-error');
  assert.equal(prepared.report.passed, 0);
  assert.ok(prepared.report.errors > 0);
  assert.equal(result.mutation.jobsAttempted, 0);
  assert.ok(result.mutation.outcomes.every(row => row.verdict === 'not-run'));
}
if (cases.includes('coverage-maps')) {
  // Instrumentation maps must match the Node route for the same sources.
  writeFileSync(join(project, 'maps.test.ts'), "import {test} from 'vitest';import './meter.tsx';import {describeLevel} from './gain.ts';test('load',()=>{describeLevel(0);});\n");
  const maps = {};
  for (const browser of [false, true]) {
    vitestConfig({include: ['maps.test.ts'], setup: false, browser});
    rmSync(join(project, 'coverage'), {recursive: true, force: true});
    const run = await runProcess(nodeCommand, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.mjs', '--coverage'],
      project, temporaryEnv, 120000);
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
if (cases.includes('custom-launch')) {
  // A persistent profile is outside the proved launch. It still runs, with a warning.
  const config = controlConfig('custom-launch', controls.assertion[0]);
  vitestConfig({include: ['control.test.ts'], sources: ['control.ts'], providerOptions: '{persistentContext:true}'});
  const result = await check('custom-launch', config);
  assert.equal(result.complete, true);
  assert.equal(result.mutation.outcomes[0].verdict, 'killed');
  const {defaultLaunch, supported} = result.diagnostics.runnerVersions[0].browser;
  assert.deepEqual({defaultLaunch, supported}, {defaultLaunch: false, supported: false});
}
if (cases.includes('node-reference')) {
  // The same control in Vitest's Node mode isolates the browser launch cost. It
  // keeps the plugin line, which must not affect a Node project.
  const config = controlConfig('node-reference', controls.assertion[0]);
  vitestConfig({include: ['control.test.ts'], sources: ['control.ts'], browser: false, runner: true});
  const result = await check('node-reference', config);
  assert.equal(result.mutation.outcomes[0].verdict, 'killed');
  assert.equal(result.setups[0].baseline.report.browser, undefined);
  const browser = results.runs.assertion?.result;
  results.runs['node-reference'].cost = {nodeMutantJobMs: mean(jobMs(result.mutation)),
    browserMutantJobMs: browser ? mean(jobMs(browser.mutation)) : null};
  save();
}
for (const [name, options] of Object.entries(baselineRejections)) {
  if (!cases.includes(name)) continue;
  const config = controlConfig(name, options.body ?? controls.assertion[0]);
  if (options.runnerChange) config.capture.push('user-setup.ts');
  vitestConfig({include: ['control.test.ts'], sources: ['control.ts'], ...options});
  const result = await check(name, config);
  assert.equal(result.complete, false);
  const baseline = result.setups[0].baseline;
  assert.equal(baseline.state, 'execution-error', JSON.stringify(baseline));
  if (options.problem) {
    assert.equal(baseline.report.adapterError,
      `Seshat cannot record evidence in Vitest ${environment.tools.vitest} browser mode: ${options.problem}`, JSON.stringify(baseline));
    rmSync(join(project, 'user-setup.ts'));
  }
  if (options.unsupported) assert.equal(baseline.evidenceError, options.unsupported, JSON.stringify(baseline));
  assert.equal(result.mutation.jobsAttempted, 0);
}
for (const [name, [body, first, options]] of Object.entries(continuations)) {
  if (!cases.includes(name)) continue;
  const config = controlConfig(name, `${body}test('later',()=>{expect(later).toBe(true);expect(last).toBe(true);});`);
  writeFileSync(join(project, 'control.ts'), 'export const ready = 1 === 1;\nexport const later = 2 === 2;\nexport const last = 3 === 3;\n');
  writeFileSync(join(project, 'control.test.ts'), readFileSync(join(project, 'control.test.ts'), 'utf8')
    .replace('import {ready}', 'import {ready,later,last}'));
  vitestConfig({include: ['control.test.ts'], sources: ['control.ts'], ...options});
  const result = await check(name, config);
  assert.deepEqual(result.mutation.outcomes.map(row => row.verdict), [first, 'killed', 'killed']);
  if (first === 'timed-out') assert.equal(result.mutation.outcomes[0].setups[0].testTimedOut, true);
  assert.equal(result.mutation.notRun, 0);
  assert.equal(result.complete, false);
  assert.equal(result.mutation.score, null);
}
for (const [name, body] of Object.entries(deadlines)) {
  if (!cases.includes(name)) continue;
  // On Linux and macOS Chromium runs in its own process group, so Seshat's group
  // kill cannot reach it; it must exit when its pipe to the killed Vitest process
  // closes. On Windows Playwright does not detach it.
  const config = controlConfig(name, body);
  config.setups[0].timeoutMs = 20000;
  vitestConfig({include: ['control.test.ts'], sources: ['control.ts']});
  const result = await check(name, config);
  const row = result.mutation.outcomes[0];
  assert.equal(row.verdict, 'timed-out', JSON.stringify(row));
  assert.equal(row.setups[0].timedOut, true);
  if (!windows) assert.ok(row.setups[0].detachedProcesses > 0, `${name}: browser PID was not tracked`);
  assert.equal(result.complete, false);
  assert.equal(result.mutation.score, null);
}
// A page that never runs a test file tested nothing: Seshat runs the job once
// more, and never counts its deadline as a kill. A mutant that blocks the page
// while its test file loads has reached the page, so its deadline counts.
function countedConfig(name, body) {
  const config = controlConfig(name, body);
  config.countTimeoutsAsKilled = true;
  // The limit, 5 times the baseline or 15 s, stays under timeoutMs, so deadlines can count.
  Object.assign(config.setups[0], {timeoutMs: 60000, mutantTimeoutMinMs: 15000});
  return config;
}
if (cases.includes('connect-retry')) {
  const config = controlConfig('connect-retry', controls.assertion[0]);
  vitestConfig({include: ['control.test.ts'], sources: ['control.ts'], refuse: 'first'});
  const job = (await check('connect-retry', config)).mutation.outcomes[0].setups[0];
  assert.equal(job.state, 'failed', JSON.stringify(job));
  assert.equal(job.jobsAttempted, 2);
  assert.equal(job.browserConnected, undefined);
  assert.equal(job.browserRetry.browserConnected, false);
  assert.equal(job.browserRetry.state, 'execution-error');
  assert.ok(job.browserRetry.diagnostic.includes('Failed to connect to the browser session'), job.browserRetry.diagnostic);
}
if (cases.includes('never-connects')) {
  // Vitest's own wait outlasts the job deadline, as with its 60 s default.
  const config = countedConfig('never-connects', controls.assertion[0]);
  vitestConfig({include: ['control.test.ts'], sources: ['control.ts'], refuse: 'always', connectTimeout: 120000});
  const result = await check('never-connects', config);
  const row = result.mutation.outcomes[0], job = row.setups[0];
  assert.equal(row.verdict, 'timed-out', JSON.stringify(row));
  assert.equal(row.countedAsKilled, false);
  assert.equal(job.jobsAttempted, 2);
  for (const attempt of [job, job.browserRetry]) {
    assert.equal(attempt.browserConnected, false);
    assert.equal(attempt.timedOut, true);
  }
  assert.equal(result.complete, false);
}
if (cases.includes('later-file-stall')) {
  // The first file runs; the second file's frame never connects, and no Vitest
  // timeout covers it, so the attempt runs to the deadline.
  const config = countedConfig('later-file-stall', controls.assertion[0]);
  writeFileSync(join(project, 'later.test.ts'), "import {test} from 'vitest';test('later',()=>{});\n");
  config.capture.push('later.test.ts');
  vitestConfig({include: ['control.test.ts', 'later.test.ts'], sources: ['control.ts'], refuse: 'later-file'});
  const result = await check('later-file-stall', config);
  rmSync(join(project, 'later.test.ts'));
  const row = result.mutation.outcomes[0], job = row.setups[0];
  assert.equal(row.verdict, 'killed', JSON.stringify(row));
  assert.equal(row.countedAsKilled, false);
  assert.equal(job.jobsAttempted, 2);
  assert.equal(job.browserRetry.browserConnected, false);
  assert.equal(job.browserRetry.timedOut, true);
}
if (cases.includes('counted-load-hang')) {
  const config = countedConfig('counted-load-hang', "while(!ready){}\ntest('loaded',()=>{});");
  vitestConfig({include: ['control.test.ts'], sources: ['control.ts']});
  const result = await check('counted-load-hang', config);
  const row = result.mutation.outcomes[0], job = row.setups[0];
  assert.equal(row.verdict, 'timed-out', JSON.stringify(row));
  assert.equal(row.countedAsKilled, true);
  assert.equal(job.timedOut, true);
  assert.equal(job.browserConnected, undefined);
  assert.equal(job.browserRetry, undefined);
}
if (cases.includes('cancellation')) {
  // The mutant's test writes the ready marker through a browser command, then waits.
  const config = controlConfig('cancellation', "import {commands} from 'vitest/browser';test('slow',async()=>{if(!ready){await (commands as any).entered();await new Promise(r=>setTimeout(r,120000));}},180000);");
  config.setups[0].timeoutMs = 180000;
  vitestConfig({include: ['control.test.ts'], sources: ['control.ts'], entered: true});
  writeFileSync(join(project, 'seshat.json'), JSON.stringify(config));
  const ready = join(work, 'cancellation-ready');
  const args = ['check', '--config', join(project, 'seshat.json'), '--scratch', scratch, '--json', '--no-progress'];
  // Node cannot send Ctrl+Break on Windows. The console helper starts the CLI in
  // a new process group, sends it Ctrl+Break once the marker exists, and
  // forwards the CLI's output.
  const helper = join(dirname(cli), 'windows-console-helper.exe');
  const started = performance.now();
  const child = windows
    ? spawn(helper, [ready, join(work, 'cancellation.stdout'), join(work, 'cancellation.stderr'), cli, ...args],
      {cwd: project, env: {...process.env, ...temporaryEnv}, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true})
    : spawn(cli, args, {cwd: project, env: {...process.env, ...temporaryEnv, SESHAT_CONSOLE_READY: ready},
      stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '', stderr = '', exit;
  child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
  const closed = new Promise(done => child.once('close', (status, signal) => { exit = {status, signal}; done(); }));
  try {
    if (!windows) {
      const deadline = performance.now() + 120000;
      while (!existsSync(ready)) {
        assert.equal(exit, undefined, `cancellation ended early: ${stderr}`);
        assert.ok(performance.now() < deadline, 'mutant test did not start');
        await delay(50);
      }
      child.kill('SIGINT');
    }
    await closed;
  } finally {
    if (!exit) { if (windows) killTree(child.pid); else child.kill('SIGKILL'); await closed; }
  }
  assert.ok(existsSync(ready), `the mutant test never started: ${stderr}`);
  const {result} = JSON.parse(stdout);
  results.runs.cancellation = {config, status: exit.status, stderr, wallMs: performance.now() - started, result: sanitize(result)};
  assert.equal(exit.status, windows ? 2 : 130, stderr);
  assert.equal(result.mutation.outcomes[0].verdict, 'cancelled');
  assert.equal(result.mutation.score, null);
  await assertCleanedUp('cancellation');
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
      ...(run.concurrentJobs ? {concurrentJobs: run.concurrentJobs, browserProcesses: run.browserProcesses} : {}),
      ...(run.connectFailures === undefined ? {} : {connectRetries: run.connectRetries, connectFailures: run.connectFailures})}
      : {files: run.files, identical: run.identical}];
  }))};
writeFileSync(join(work, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
if (process.env.SESHAT_PROOF_OUTPUT) cpSync(join(work, 'summary.json'), process.env.SESHAT_PROOF_OUTPUT);
console.log(`vitest-browser-check: ${cases.length} cases passed; ${relative(repo, work)}`);
