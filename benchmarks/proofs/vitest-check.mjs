// Native combined assessment of the checked-in React, Fastify and Vitest fixture.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {nodeCommand, npmCommand, runProcess} from './process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const workers = Number(process.env.SESHAT_CHECK_WORKERS ?? 1);
assert.ok(Number.isSafeInteger(workers) && workers > 0, 'SESHAT_CHECK_WORKERS must be a positive integer');
const {values} = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: false,
  options: {
    cli: {type: 'string'},
    deps: {type: 'string'},
    tarball: {type: 'string'},
    cases: {type: 'string'},
  },
});
const tarballArg = values.tarball ?? process.env.SESHAT_CLI_TARBALL;
const cliArg = values.cli ?? process.env.SESHAT_CLI_BINARY;
assert.ok(!(tarballArg && cliArg),
  'usage: node benchmarks/proofs/vitest-check.mjs [--tarball PATH | --cli PATH] [--deps PATH] [--cases LIST]');
const original = join(here, 'fixtures/vitest');
const expectedScores = {
  'tempo.ts': [[3,5,5,3]],
  'view.tsx': [[1,1,1,1]],
  'server.ts': [[1,3,3,1],[1,1,1,1]],
};
const defaultCases = [
  'stack', 'stack-repeat', 'worker-config-override', 'worker-project-override',
  'assertion', 'survived', 'clean-hooks', 'assertion-count', 'before-all',
  'before-each', 'after-each', 'cleanup', 'mixed', 'timeout', 'hook-timeout',
  'import-error', 'unhandled', 'around-each', 'missing-runner', 'retry', 'repeat',
  'expected-failure', 'concurrent',
];
const casesArg = values.cases ?? process.env.SESHAT_VITEST_CHECK_CASES;
const requestedCases = (casesArg ?? defaultCases.join(','))
  .split(',').map(name => name.trim());
assert.ok(requestedCases.length > 0 && requestedCases.every(name => name.length > 0),
  '--cases must contain at least one non-empty case name');
assert.ok(requestedCases.every(name => defaultCases.includes(name)),
  `unknown --cases name (expected one of: ${defaultCases.join(', ')})`);
const wantedCases = new Set(requestedCases);
const wanted = name => wantedCases.has(name);
const installed = Boolean(tarballArg || cliArg);
mkdirSync(join(repo, 'work/assurance-proofs'), {recursive: true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/vitest-check-'));
const project = join(work, 'input 🎸');
const scratch = join(work, 'scratch');
mkdirSync(project); mkdirSync(scratch);
const npmEnv = {
  npm_config_cache: join(work, 'npm-cache'),
  npm_config_userconfig: join(work, 'user.npmrc'),
  npm_config_globalconfig: join(work, 'global.npmrc'),
  npm_config_update_notifier: 'false',
};
const portable = path => relative(repo, path) || '.';
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const packageVersion = path => JSON.parse(readFileSync(path, 'utf8')).version;
const toolNames = [
  'vitest', '@vitest/coverage-istanbul', 'fastify', '@sinclair/typebox',
  'react', 'react-dom',
];

async function runCommand(command, args, cwd, expected = 0, extraEnv = {}) {
  const child = await runProcess(command, args, cwd, extraEnv, 180000);
  assert.equal(child.timedOut, false, `${command} timed out`);
  assert.equal(child.overflow, false, `${command} overflowed output`);
  assert.equal(child.status, expected, `${command} ${args.join(' ')}\n${child.stdout}\n${child.stderr}`);
  return child;
}

function dependencyNodeModules(root) {
  const path = basename(root) === 'node_modules' ? root : join(root, 'node_modules');
  assert.ok(statSync(path).isDirectory(), `Vitest dependencies are missing: ${path}`);
  return path;
}

function fixtureVersions(root) {
  return Object.fromEntries(toolNames.map(name => [name, packageVersion(join(root, name, 'package.json'))]));
}

function sanitize(value) {
  return JSON.parse(JSON.stringify(value).replaceAll(work, '<work>').replaceAll(project, '<project>'));
}

const dependencyRoot = values.deps ? resolve(values.deps) : here;
const dependencyModules = dependencyNodeModules(dependencyRoot);
const environment = {node: process.version, tools: fixtureVersions(dependencyModules)};
const originalTypeScript = [
  join(repo, 'benchmarks/node_modules/typescript'),
  join(dependencyModules, '..', '..', 'node_modules/typescript'),
  join(dependencyModules, '..', 'node_modules/typescript'),
].find(existsSync);
assert.ok(originalTypeScript, 'TypeScript dependencies are missing');
const names = ['package.json','tsconfig.json','tempo.ts','view.tsx','server.ts','stack.test.tsx'];
const inputs = Object.fromEntries(names.map(name => [name, readFileSync(join(original, name), 'utf8')]));
for (const [name, source] of Object.entries(inputs)) writeFileSync(join(project, name), source);
// Native capture rejects dependency links that escape the project.
cpSync(dependencyModules, join(project, 'node_modules'), {recursive:true, verbatimSymlinks:true});
if (!existsSync(join(project, 'node_modules/typescript'))) cpSync(originalTypeScript, join(project, 'node_modules/typescript'), {recursive:true});
environment.tools.typescript = packageVersion(join(project, 'node_modules/typescript/package.json'));
for (const [name, version] of Object.entries(environment.tools)) assert.equal(packageVersion(join(project, 'node_modules', name, 'package.json')), version);
writeFileSync(join(project, 'vitest.config.mjs'), `export default {cacheDir:'.vite',test:{runner:process.env.SESHAT_VITEST_RUNNER,include:['stack.test.tsx'],coverage:{provider:'istanbul',include:['tempo.ts','view.tsx','server.ts'],reporter:['json'],reportsDirectory:'coverage'}}};\n`);
const args = [nodeCommand, 'node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.mjs',
  '--maxWorkers=1', '--no-file-parallelism', '--maxConcurrency=1', '--reporter=default', '--reporter={seshatReporter}'];
const config = {workers, source:{include:['tempo.ts','view.tsx','server.ts']},
  capture:[...names, 'vitest.config.mjs', 'node_modules'], setups:[{name:'stack',runner:'vitest',cwd:'.',timeoutMs:30000,
    typecheck:[nodeCommand,'node_modules/typescript/bin/tsc','--project','tsconfig.json'],
    test:args, coverage:{command:[...args,'--coverage'],report:'coverage/coverage-final.json'}}]};
const save = () => writeJson(join(work, 'result.json'), sanitize(results));

let cli;
let cliEvidence;
if (tarballArg) {
  const tarball = realpathSync(resolve(tarballArg));
  assert.ok(statSync(tarball).isFile(), 'CLI tarball is missing');
  const consumer = join(work, 'cli-consumer');
  mkdirSync(consumer);
  writeJson(join(consumer, 'package.json'), {name: 'seshat-vitest-consumer', private: true});
  await runCommand(npmCommand, [
    'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    '--save-dev', '--save-exact', '--cache', npmEnv.npm_config_cache,
    '--userconfig', npmEnv.npm_config_userconfig,
    '--globalconfig', npmEnv.npm_config_globalconfig, tarball,
  ], consumer, 0, npmEnv);
  const executable = process.platform === 'win32' ? 'seshat.cmd' : 'seshat';
  const native = join(consumer, 'node_modules/@binary-balance/seshat/bin/seshat');
  cli = realpathSync(existsSync(native) ? native : join(consumer, 'node_modules/.bin', executable));
  cliEvidence = {source: 'tarball', tarballSha256: sha256(tarball)};
} else if (cliArg) {
  cli = realpathSync(resolve(cliArg));
  assert.ok(statSync(cli).isFile(), 'CLI executable is missing');
  cliEvidence = {source: 'executable'};
} else {
  cli = join(repo, 'benchmarks/rust/target/release/seshat-proofs');
  assert.ok(statSync(cli).isFile(), 'legacy proof executable is missing');
  cliEvidence = {source: 'legacy-proof'};
}
if (installed) {
  const version = (await runCommand(cli, ['--version'], repo)).stdout.trim();
  assert.match(version, /^seshat 0\.0\.0 \(candidate\)$/);
  cliEvidence = {...cliEvidence, version, binarySha256: sha256(cli)};
}
const results = {
  version: 1,
  representativeOnly: true,
  environment,
  cli: cliEvidence,
  dependencies: {versions: environment.tools},
  work: portable(work),
  requestedCases,
  runs: {},
};
async function check(name, input) {
  const path = join(project,'seshat.json'); writeFileSync(path,JSON.stringify(input));
  const command = installed
    ? ['check','--config',path,'--scratch',scratch,'--json','--no-progress']
    : ['check',path,scratch];
  const run = await runProcess(cli, command, installed ? project : repo, {}, 600000);
  assert.equal(run.timedOut,false); assert.equal(run.overflow,false);
  const report = JSON.parse(run.stdout);
  const result = installed ? report.result : report;
  results.runs[name] = {
    config: input,
    execution: {status: run.status, signal: run.signal, stderr: run.stderr},
    result: sanitize(result),
    ...(installed ? {report: sanitize(report)} : {}),
    wallMs: run.ms,
  };
  save();
  assert.equal(run.status,result.complete?0:2,run.stderr);
  assert.deepEqual(readdirSync(scratch),[],'Native session must clean up');
  if (result.setups?.[0].coverage.state==='passed' && result.mutation?.planned > 0) {
    assert.equal(result.mutation.workersUsed,Math.min(workers,result.mutation.planned));
    assert.equal(result.mutation.workerBaselineJobs,result.mutation.workersUsed-1);
    assert.ok(result.mutation.workerBaselines.every(b=>b.state==='passed'));
    const receipts=[...result.mutation.workerBaselines,...result.mutation.outcomes.flatMap(m=>m.setups)].filter(s=>s.report).map(s=>s.report.executionId);
    assert.equal(new Set(receipts).size,receipts.length,'Workers reused a receipt identity');
  }
  for (const [name, source] of Object.entries(inputs)) {
    assert.equal(readFileSync(join(original,name),'utf8'),source);
    assert.equal(readFileSync(join(project,name),'utf8'),source);
  }
  console.log(`${name}: complete=${result.complete}, score=${result.mutation?.score}, ${Math.round(run.ms)}ms`);
  return result;
}
for (const name of ['stack','stack-repeat']) {
  if (!wanted(name)) continue;
  const result = await check(name,config);
  assert.equal(result.complete,true,JSON.stringify(result));
  assert.equal(result.setups[0].baseline.report.passed,3);
  assert.equal(result.setups[0].coverage.report.passed,3);
  assert.equal(result.mutation.planned,4);
  assert.equal(result.mutation.killed,4);
  assert.equal(result.mutation.score,100);
  for (const source of result.sources) assert.deepEqual(source.result.functions.map(f=>[f.complexity,f.covered,f.total,f.crap]), expectedScores[source.path]);
  assert.ok(result.mutation.workerBaselines.every(b=>b.report.passed===3));
  if (name==='stack-repeat' && results.runs.stack) {
    assert.deepEqual(result.sources,results.runs.stack.result.sources);
    // Repeated runs must agree on definitions and verdicts; timings naturally vary.
    const definitions=r=>r.mutation.outcomes.map(({setups,executionMs,...row})=>row);
    assert.deepEqual(definitions(result),definitions(results.runs.stack.result));
  }
}
if (wanted('worker-config-override')) {
  const overrideArgs = args.filter(value => value !== '--no-file-parallelism')
    .map(value => value === '--maxWorkers=1' ? '--maxWorkers=7' : value);
  writeFileSync(join(project,'vitest.config.mjs'), `export default {cacheDir:'.vite',test:{runner:process.env.SESHAT_VITEST_RUNNER,include:['stack.test.tsx'],maxWorkers:7,fileParallelism:false,coverage:{provider:'istanbul',include:['tempo.ts','view.tsx','server.ts'],reporter:['json'],reportsDirectory:'coverage'}}};\n`);
  const override = structuredClone(config);
  override.setups[0].test = overrideArgs;
  override.setups[0].coverage.command = [...overrideArgs, '--coverage'];
  const result = await check('worker-config-override', override);
  const rows = result.diagnostics.concurrency.runners;
  assert.deepEqual(rows.map(({command,effectiveWorkers,state,source}) =>
    ({command,effectiveWorkers,state,source})), [
    {command:'test',effectiveWorkers:1,state:'known',source:'resolved-config'},
    {command:'coverage',effectiveWorkers:1,state:'known',source:'resolved-config'},
  ]);
}
if (wanted('worker-project-override')) {
  const projectArgs = args.filter(value => value !== '--maxWorkers=1' && value !== '--no-file-parallelism');
  writeFileSync(join(project,'vitest.config.mjs'), `export default {cacheDir:'.vite',test:{maxWorkers:7,projects:[{test:{name:'limited',runner:process.env.SESHAT_VITEST_RUNNER,include:['stack.test.tsx'],maxWorkers:1,coverage:{provider:'istanbul',include:['tempo.ts','view.tsx','server.ts'],reporter:['json'],reportsDirectory:'coverage'}}}]}};\n`);
  const projectOverride = structuredClone(config);
  projectOverride.setups[0].test = projectArgs;
  projectOverride.setups[0].coverage.command = [...projectArgs, '--coverage'];
  const result = await check('worker-project-override', projectOverride);
  const rows = result.diagnostics.concurrency.runners;
  assert.deepEqual(rows.map(({command,effectiveWorkers,state,source}) =>
    ({command,effectiveWorkers,state,source})), [
    {command:'test',effectiveWorkers:1,state:'known',source:'resolved-config'},
    {command:'coverage',effectiveWorkers:1,state:'known',source:'resolved-config'},
  ]);
}
// Two independent changes make the existing failure controls exercise two workers.
writeFileSync(join(project,'control.ts'),`export const ready = 1 === 1${workers>1?' && 2 === 2':''};\n`);
for (const [name,body,expected] of [
  ['assertion', "test('assertion',()=>expect(ready).toBe(true));", 'killed'],
  ['survived', "test('unchanged',()=>expect(typeof ready).toBe('boolean'));", 'survived'],
  ['clean-hooks', "beforeEach(()=>{});afterEach(()=>{});test('assertion',()=>expect(ready).toBe(true));", 'killed'],
  ['assertion-count', "test('count',()=>{expect.assertions(1);if(ready)expect(ready).toBe(true);});", 'killed'],
  ['before-all', "beforeAll(()=>{if(!ready)throw Error('setup');});test('blocked',()=>{});", 'execution-error'],
  ['before-each', "beforeEach(()=>{if(!ready)throw Error('setup');});test('blocked',()=>{});", 'execution-error'],
  ['after-each', "afterEach(()=>{if(!ready)throw Error('cleanup');});test('passed',()=>{});", 'execution-error'],
  ['cleanup', "beforeEach(()=>()=>{if(!ready)throw Error('cleanup');});test('passed',()=>{});", 'execution-error'],
  ['mixed', "afterEach(()=>{if(!ready)throw Error('cleanup');});test('assertion',()=>expect(ready).toBe(true));", 'execution-error'],
  ['timeout', "test('timeout',()=>ready?Promise.resolve():new Promise(()=>{}),50);", 'timed-out'],
  ['hook-timeout', "beforeEach(()=>ready?Promise.resolve():new Promise(()=>{}),50);test('blocked',()=>{});", 'timed-out'],
  ['import-error', "if(!ready)throw Error('load');test('blocked',()=>{});", 'execution-error'],
  ['unhandled', "test('background',async()=>{if(!ready)void Promise.reject(Error('background'));await new Promise(r=>setTimeout(r,10));});", 'execution-error'],
  ['around-each', "aroundEach(async(run)=>{await run();if(!ready)throw Error('around cleanup');});test('passed',()=>{});", 'execution-error'],
]) {
  if (!wanted(name)) continue;
  writeFileSync(join(project,'control.test.ts'),`import {test,expect,beforeAll,beforeEach,afterEach,aroundEach} from 'vitest';import {ready} from './control.ts';\n${body}\n`);
  writeFileSync(join(project,'vitest.config.mjs'),`export default {cacheDir:'.vite',test:{runner:process.env.SESHAT_VITEST_RUNNER,include:['control.test.ts'],coverage:{provider:'istanbul',include:['control.ts'],reporter:['json'],reportsDirectory:'coverage'}}};\n`);
  const input = structuredClone(config); input.source.include=['control.ts']; input.capture.push('control.ts','control.test.ts');
  const result = await check(name,input);
  assert.equal(result.setups[0].baseline.state,'passed',JSON.stringify(result.setups));
  assert.equal(result.setups[0].coverage.state,'passed',JSON.stringify(result.setups));
  assert.equal(result.mutation.planned,workers>1?2:1);
  assert.ok(result.mutation.outcomes.every(m=>m.verdict===expected),JSON.stringify(result));
  const complete = ['killed','survived'].includes(expected);
  assert.equal(result.complete,complete); assert.equal(result.mutation.score,complete?(expected==='killed'?100:0):null);
}
if (wanted('missing-runner')) {
  writeFileSync(join(project,'vitest.config.mjs'), `export default {test:{include:['stack.test.tsx']}};\n`);
  const result = await check('missing-runner', config);
  assert.equal(result.complete, false);
  assert.equal(result.setups[0].baseline.state, 'execution-error');
  assert.equal(result.mutation.jobsAttempted, 0);
}
for (const [name, body] of [
  ['retry', "test('retry',{retry:1},()=>{});"],
  ['repeat', "test('repeat',{repeats:1},()=>{});"],
  ['expected-failure', "test.fails('expected',()=>{throw Error('expected');});"],
  ['concurrent', "test.concurrent('concurrent',()=>{});"],
]) {
  if (!wanted(name)) continue;
  writeFileSync(join(project,'control.test.ts'),`import {test} from 'vitest';${body}\n`);
  writeFileSync(join(project,'vitest.config.mjs'),`export default {test:{runner:process.env.SESHAT_VITEST_RUNNER,include:['control.test.ts']}};\n`);
  const input = structuredClone(config); input.capture.push('control.test.ts');
  const result = await check(name,input);
  assert.equal(result.complete,false);
  assert.equal(result.setups[0].baseline.state,'execution-error');
  assert.equal(result.mutation.jobsAttempted,0);
}
if (casesArg) assert.deepEqual(Object.keys(results.runs).sort(),[...wantedCases].sort());
for (const [name,source] of Object.entries(inputs)) {
  assert.equal(readFileSync(join(original,name),'utf8'),source);
  assert.equal(readFileSync(join(project,name),'utf8'),source);
}
results.checks = {requested: requestedCases.length, completed: Object.keys(results.runs).length};
results.originalsPreserved=true; save();
console.log(`Vitest ${installed ? 'installed-command' : 'native'} evidence: ${results.checks.completed} checks; ${join(work,'result.json')}`);
