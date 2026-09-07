// Exercise the actual candidate binary; all application inputs are disposable.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const binary = process.env.SESHAT_CLI_BINARY
  ? resolve(process.env.SESHAT_CLI_BINARY)
  : join(repo, 'benchmarks/rust/target/release/seshat');
const work = mkdtempSync(join(repo, 'work/assurance-proofs/cli-'));
const project = join(work, 'input 🎸');
const scratch = join(work, 'scratch');
mkdirSync(project); mkdirSync(scratch);
const originals = {
  'package.json':'{"type":"module"}',
  'subject.ts':'export function adult(age: number) { return age >= 18; }\n',
  'test.mjs':"import {test} from 'node:test';import assert from 'node:assert/strict';import {adult} from './subject.ts';test('adult',()=>assert.equal(adult(20),true));",
};
for (const [path, source] of Object.entries(originals)) writeFileSync(join(project, path), source);
const configPath = join(project, 'seshat.json');
const config = {source:{include:['subject.ts']}, capture:Object.keys(originals), setups:[{
  name:'node', runner:'node', cwd:'.', timeoutMs:10000,
  typecheck:[process.execPath, join(repo, 'benchmarks/node_modules/typescript/bin/tsc'), '--ignoreConfig', '--strict', '--noEmit', '--skipLibCheck', 'subject.ts'],
  test:[process.execPath, '--test', '--test-reporter={seshatReporter}', 'test.mjs'],
  coverage:{command:[process.execPath, join(here, 'collect-node.mjs'), 'test.mjs'], report:'coverage/final.json'},
}]};
const configure = (value = config) => writeFileSync(configPath, JSON.stringify(value));
configure();
const results = {};
function unchanged() {
  assert.deepEqual(readdirSync(scratch), [], 'scratch must be cleaned');
  for (const [path, source] of Object.entries(originals)) assert.equal(readFileSync(join(project, path), 'utf8'), source);
}
function run(name, args, status = 0) {
  const started = performance.now();
  const child = spawnSync(binary, args, {cwd:project, encoding:'utf8', timeout:60000});
  const elapsedMs = performance.now() - started;
  assert.ifError(child.error);
  assert.equal(child.status, status, child.stdout + child.stderr);
  unchanged();
  results[name] = {status:child.status, elapsedMs, stdout:child.stdout, stderr:child.stderr};
  console.log(`${name}: exit ${child.status}`);
  return child;
}
function json(name, command, status = 0) {
  const child = run(name, [command, '--config', configPath, '--scratch', scratch, '--json'], status);
  const report = JSON.parse(child.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.command, command);
  assert.equal(report.complete, status < 2);
  assert.equal(report.cancelled, false);
  assert.ok(report.timings.wallMs >= report.timings.captureMs);
  return report;
}
const stableMutation = mutation => mutation.outcomes.map(({id,path,localId,offset,original,replacement,verdict}) =>
  ({id,path,localId,offset,original,replacement,verdict}));
const checked = json('check', 'check');
assert.equal(checked.quality.state, 'not-configured');
assert.match(results.check.stderr, /capturing configured inputs/);
assert.equal(checked.result.mutation.score, 50);
assert.deepEqual(checked.scope.files, ['subject.ts']);
assert.equal(checked.result.jobsAttempted, 5);
for (const ms of Object.values(checked.result.phaseTimings)) assert.ok(Number.isFinite(ms) && ms >= 0);
for (const [phase,key] of [['typecheck','typecheckMs'],['baseline','baselineMs'],['coverage','coverageMs']]) {
  const setup = checked.result.setups[0];
  assert.ok(setup.timings[key] >= setup[phase].ms);
  assert.equal(checked.result.phaseTimings[key], setup.timings[key]);
}
assert.match(results.check.stderr, /analysis: 1 source file/);
assert.match(results.check.stderr, /baseline "node"/);
assert.match(results.check.stderr, /coverage "node"/);
assert.match(results.check.stderr, /mutation finished: completed 2\/2, running 0, not run 0, resolved 2, unresolved 0/);
const crap = json('crap', 'crap');
assert.equal(crap.result.mutation, undefined);
assert.equal(crap.result.jobsAttempted, 3);
assert.deepEqual(crap.result.sources, checked.result.sources);
const mutated = json('mutate', 'mutate');
assert.equal(mutated.result.jobsAttempted, 4);
assert.equal(mutated.result.setups[0].coverage.state, 'not-requested');
assert.deepEqual(mutated.result.sources, [{path:'subject.ts'}]);
assert.equal(mutated.result.phaseTimings.coverageMs, null);
assert.equal(mutated.result.phaseTimings.attributionMs, null);
assert.equal(mutated.result.setups[0].timings.coverageMs, null);
assert.equal(mutated.result.mutation.completed, 2);
assert.equal(mutated.result.mutation.notRun, 0);
assert.equal(mutated.result.mutation.unresolved, 0);
assert.deepEqual(stableMutation(mutated.result.mutation), stableMutation(checked.result.mutation));
const proofBinary = process.env.SESHAT_PROOF_BINARY
  ? resolve(process.env.SESHAT_PROOF_BINARY)
  : join(repo, 'benchmarks/rust/target/release/seshat-proofs');
const legacy = spawnSync(proofBinary, ['check', configPath, scratch], {encoding:'utf8', timeout:60000});
assert.ifError(legacy.error); assert.equal(legacy.status, 0, legacy.stderr);
const proof = JSON.parse(legacy.stdout);
assert.deepEqual(proof.sources, checked.result.sources);
assert.deepEqual(stableMutation(proof.mutation), stableMutation(checked.result.mutation));
unchanged();
const human = run('default-config-and-scratch', ['check', '--no-progress']);
assert.equal(human.stderr, '');
assert.match(human.stdout, /CRAP 1\.000/);
assert.match(human.stdout, /score 50\.00%/);
assert.match(human.stdout, /Worker preparation: [\d.]+ ms/);
assert.match(human.stdout, /Coverage attribution: [\d.]+ ms/);
assert.match(human.stdout, /baselineMs: [\d.]+ ms/);
assert.match(human.stdout, /Mutation work: 2 completed, 0 not run, 0 unresolved/);
const quiet = run('json-no-progress', ['mutate', '--scratch', scratch, '--json', '--no-progress']);
assert.equal(quiet.stderr, ''); assert.equal(JSON.parse(quiet.stdout).complete, true);

// Alternate otherwise identical real executions; timing noise is not a performance guarantee.
const progressSamples = {on:[], off:[]};
for (let pair=0; pair<3; pair++) {
  for (const enabled of pair % 2 === 0 ? [true,false] : [false,true]) {
    const label = enabled ? 'on' : 'off';
    const name = `progress-${label}-${pair}`;
    const child = run(name, ['mutate','--scratch',scratch,'--json',...(enabled?[]:['--no-progress'])]);
    const report = JSON.parse(child.stdout);
    assert.deepEqual(stableMutation(report.result.mutation), stableMutation(mutated.result.mutation));
    assert.equal(report.result.jobsAttempted, mutated.result.jobsAttempted);
    assert.equal(report.quality.state, mutated.quality.state);
    if(enabled) assert.match(child.stderr, /mutation: completed/); else assert.equal(child.stderr,'');
    progressSamples[label].push(results[name].elapsedMs);
  }
}
const median = values => [...values].sort((a,b)=>a-b)[1];
console.log(`Progress wall-time medians: on=${median(progressSamples.on).toFixed(1)}ms off=${median(progressSamples.off).toFixed(1)}ms`);

const limited = structuredClone(config);
limited.thresholds = {maxCrap:1, minMutationScore:50}; configure(limited);
const boundary = json('threshold-equality', 'check');
assert.equal(boundary.quality.state, 'passed');
assert.deepEqual(boundary.quality.checks.map(c => c.actual), [1,50]);
assert.deepEqual(boundary.result.sources, checked.result.sources);
assert.deepEqual(stableMutation(boundary.result.mutation), stableMutation(checked.result.mutation));
limited.thresholds = {maxCrap:0.99999, minMutationScore:50.00001}; configure(limited);
const below = json('both-thresholds-fail', 'check', 1);
assert.equal(below.quality.state, 'failed');
assert.ok(below.quality.checks.every(c => c.state === 'failed'));
assert.equal(below.result.mutation.score, 50, 'threshold failure must retain valid scores');
assert.equal(json('crap-threshold-failure', 'crap', 1).quality.checks[0].state, 'failed');
const failedHuman = run('human-threshold-failure', ['mutate','--scratch',scratch,'--no-progress'], 1);
assert.match(failedHuman.stdout, /Quality thresholds: failed/);
assert.match(failedHuman.stdout, /minMutationScore: failed/);
limited.thresholds = {maxCrap:1, minMutationScore:100}; configure(limited);
const crapOnly = json('crap-ignores-mutation-threshold', 'crap');
assert.equal(crapOnly.quality.checks[1].state, 'not-requested');
limited.thresholds = {maxCrap:0, minMutationScore:50}; configure(limited);
assert.equal(json('mutate-ignores-crap-threshold', 'mutate').quality.checks[0].state, 'not-requested');
for (const thresholds of [{maxCrap:-1}, {minMutationScore:101}, {maxCrap:'30'}, {maxCRAP:30}, null]) {
  limited.thresholds = thresholds; configure(limited);
  const invalid = json(`invalid-threshold-${JSON.stringify(thresholds)}`, 'check', 2);
  assert.equal(invalid.scope, null); assert.equal(invalid.quality, null);
  assert.equal(invalid.result.jobsAttempted, undefined);
}

const marker = join(work, 'coverage-called');
const invalidCoverage = structuredClone(config);
invalidCoverage.thresholds = {maxCrap:0, minMutationScore:50};
invalidCoverage.setups[0].coverage.command = [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'called');process.exit(1)`];
configure(invalidCoverage);
assert.deepEqual(stableMutation(json('mutation-skips-coverage', 'mutate').result.mutation), stableMutation(checked.result.mutation));
assert.equal(existsSync(marker), false);
const incompleteCoverage = json('check-needs-coverage', 'check', 2);
assert.equal(incompleteCoverage.result.mutation.score, null);
assert.equal(incompleteCoverage.quality.state, 'incomplete');
assert.equal(existsSync(marker), true);
assert.equal(json('crap-needs-coverage', 'crap', 2).result.setups[0].coverage.state, 'execution-error');
const missingTypecheck = structuredClone(config); delete missingTypecheck.setups[0].typecheck;
configure(missingTypecheck);
assert.match(json('mutate-needs-typecheck', 'mutate', 2).result.error, /typecheck/);
const failedBaseline = structuredClone(config); failedBaseline.setups[0].test = [process.execPath, '-e', 'process.exit(1)'];
configure(failedBaseline);
assert.equal(json('baseline-failure', 'mutate', 2).result.mutation.score, null);
const timeoutConfig = structuredClone(config);
timeoutConfig.thresholds = {minMutationScore:0};
timeoutConfig.setups[0].timeoutMs = 200;
timeoutConfig.setups[0].typecheck = [process.execPath,'-e','setInterval(()=>{},1000)'];
configure(timeoutConfig);
const timeoutReport = json('timeout-with-threshold', 'mutate', 2);
assert.equal(timeoutReport.result.setups[0].typecheck.state, 'timed-out');
assert.equal(timeoutReport.quality.state, 'incomplete');
assert.equal(timeoutReport.quality.checks[0].actual, null);
assert.ok(timeoutReport.result.phaseTimings.typecheckMs >= 200);
assert.equal(timeoutReport.result.phaseTimings.baselineMs, null);
assert.equal(timeoutReport.result.phaseTimings.coverageMs, null);

writeFileSync(configPath, 'broken JSON');
for (const args of [['--help'], ['check','--help'], ['--version']]) {
  run(args.join('-'), args);
}
for (const args of [[], ['bogus'], ['check','--wat'], ['check','--config'], ['check','--json','--json'], ['check','extra']]) {
  const report = JSON.parse(run(`invalid-${args.join('-')}`, [...args,'--json'], 2).stdout);
  assert.equal(report.scope, null);
  assert.equal(report.timings.captureMs, null, 'argument validation must precede capture');
  assert.equal(report.complete, false);
}
assert.equal(json('invalid-config', 'check', 2).scope, null);

originals['subject.ts'] = 'export function adult(age: number) { return Boolean(age); }\n';
writeFileSync(join(project, 'subject.ts'), originals['subject.ts']);
configure();
const empty = json('no-mutants', 'mutate');
assert.equal(empty.result.mutation.planned, 0);
assert.equal(empty.result.mutation.score, null);
assert.equal(empty.result.mutation.completed, 0);
assert.equal(empty.result.mutation.notRun, 0);
configure({...config, thresholds:{minMutationScore:100}});
const emptyThreshold = json('no-mutants-with-threshold', 'mutate');
assert.equal(emptyThreshold.quality.state, 'not-evaluated');
assert.equal(emptyThreshold.quality.checks[0].state, 'not-applicable');

for (const [signal, code, number] of [['SIGINT',130,2], ['SIGTERM',143,15]]) {
  const ready = join(work, signal);
  const waiting = structuredClone(config);
  waiting.thresholds = {maxCrap:0, minMutationScore:100};
  waiting.setups[0].typecheck = [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`];
  configure(waiting);
  const child = spawn(binary, ['mutate','--scratch',scratch,'--json'], {cwd:project, stdio:['ignore','pipe','pipe']});
  let stdout = '', stderr = '', closed = false;
  child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
  const done = new Promise((resolve,reject) => {child.once('error',reject); child.once('close',(status) => {closed = true; resolve(status);});});
  try {
    const deadline = performance.now() + 10000;
    while (!existsSync(ready) && !closed && performance.now() < deadline) await delay(20);
    assert.ok(existsSync(ready), stderr + stdout);
    child.kill(signal);
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
    let status;
    try {status = await done;} finally {clearTimeout(timeout);}
    assert.equal(status, code, stderr + stdout);
    const report = JSON.parse(stdout);
    assert.equal(report.cancelled, true); assert.equal(report.signal, number);
    assert.equal(report.complete, false); assert.equal(report.result.mutation.score, null);
    assert.equal(report.quality.state, 'incomplete');
    assert.equal(report.quality.checks[1].state, 'incomplete');
    assert.equal(report.result.phaseTimings.baselineMs, null);
    assert.ok(report.result.phaseTimings.cleanupMs >= 0);
    assert.throws(() => process.kill(Number(readFileSync(ready,'utf8')),0), {code:'ESRCH'});
    unchanged(); results[signal] = report;
    console.log(`${signal}: exit ${status}, score withheld, child stopped`);
  } finally {
    if (!closed) child.kill('SIGTERM');
    await done;
  }
}
writeFileSync(join(work,'result.json'), JSON.stringify(results,null,2)+'\n');
console.log(`CLI passed: ${Object.keys(results).length} scenarios plus legacy parity. Results: ${join(work,'result.json')}`);
