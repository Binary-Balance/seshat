// Focused installed-CLI switching checks. Inputs and evidence are disposable.
import assert from 'node:assert/strict';
import {appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
mkdirSync(join(repo, 'work/assurance-proofs'), {recursive: true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/switching-'));
const project = join(work, 'input');
const scratch = join(work, 'scratch');
const events = join(work, 'events.jsonl');
const binary = resolve(process.env.SESHAT_SWITCHING_BINARY ?? join(repo, 'benchmarks/proofs/target/debug/seshat'));
mkdirSync(join(project, 'src'), {recursive: true});
mkdirSync(join(project, 'tests'));
mkdirSync(scratch);

const originals = {
  'package.json': '{"type":"module"}\n',
  'tsconfig.json': '{"compilerOptions":{"strict":true,"noEmit":true,"skipLibCheck":true,"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext"},"include":["src/**/*.ts"]}\n',
  'src/first.ts': 'export function first(value: number) { return value >= 18; }\n',
  'src/second.ts': 'export function second(value: number) { return value < 3; }\n',
  'src/plain.ts': 'export const plain = 1;\n',
};
const test = `import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appendFileSync, readFileSync} from 'node:fs';
import {first} from '../src/first.ts';
import {second} from '../src/second.ts';
const firstSource = readFileSync(new URL('../src/first.ts', import.meta.url), 'utf8');
const secondSource = readFileSync(new URL('../src/second.ts', import.meta.url), 'utf8');
const switched = firstSource.includes('__seshat_compare');
const active = process.env.SESHAT_MUTANT_ID;
appendFileSync(${JSON.stringify(events)}, JSON.stringify({switched, secondSwitched: secondSource.includes('__seshat_compare'), active: active ?? null}) + '\\n');
test('both source files', () => {
  assert.deepEqual([first(17), first(18), second(2), second(3)], [false, true, true, false]);
});
`;
const preparedFailure = `import {test} from 'node:test';
import {readFileSync} from 'node:fs';
if (readFileSync(new URL('../src/first.ts', import.meta.url), 'utf8').includes('__seshat_compare')
  && process.env.SESHAT_MUTANT_ID === undefined) process.exit(1);
test('original only', () => {});
`;
const preparedTimeout = `import {test} from 'node:test';
import {readFileSync} from 'node:fs';
if (readFileSync(new URL('../src/first.ts', import.meta.url), 'utf8').includes('__seshat_compare')
  && process.env.SESHAT_MUTANT_ID === undefined) setInterval(() => {}, 1000);
test('original only', () => {});
`;
for (const [path, source] of Object.entries({...originals, 'tests/check.mjs': test,
  'tests/prepared-failure.mjs': preparedFailure, 'tests/prepared-timeout.mjs': preparedTimeout})) {
  mkdirSync(dirname(join(project, path)), {recursive: true});
  writeFileSync(join(project, path), source);
}

const setup = testFile => ({
  name: 'node', runner: 'node', cwd: '.', timeoutMs: testFile === 'tests/prepared-timeout.mjs' ? 2000 : 10000,
  typecheck: [process.execPath, join(repo, 'benchmarks/node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'],
  test: [process.execPath, '--test', '--test-concurrency=1', '--test-reporter={seshatReporter}', testFile],
  coverage: {command: [process.execPath, join(here, 'collect-node.mjs'), 'tests/check.mjs'], report: 'coverage/final.json'},
});
const baseConfig = (testFile, sourceInclude = ['src/**/*.ts']) => ({
  source: {include: sourceInclude},
  capture: ['package.json', 'tsconfig.json', 'src', 'tests'],
  setups: [setup(testFile)],
});

function restoreInputs() {
  for (const [path, source] of Object.entries({...originals, 'tests/check.mjs': test,
    'tests/prepared-failure.mjs': preparedFailure, 'tests/prepared-timeout.mjs': preparedTimeout})) {
    writeFileSync(join(project, path), source);
  }
}

function run(name, {workers = 1, switching = false, testFile = 'tests/check.mjs', sourceInclude} = {}) {
  const config = {...baseConfig(testFile, sourceInclude), workers};
  const configPath = join(project, 'seshat.json');
  writeFileSync(configPath, JSON.stringify(config));
  appendFileSync(events, JSON.stringify({run: name, marker: 'start'}) + '\n');
  const args = ['check', '--config', configPath, '--scratch', scratch, '--json', '--no-progress'];
  if (switching) args.push('--experimental-switching');
  const child = spawnSync(binary, args, {encoding: 'utf8', timeout: 60000});
  assert.ifError(child.error);
  const report = JSON.parse(child.stdout);
  assert.equal(child.status, report.complete === true ? 0 : 2, child.stdout + child.stderr);
  assert.deepEqual(readdirSync(scratch), [], `${name}: captured directories must be cleaned up`);
  for (const [path, source] of Object.entries(originals)) {
    assert.equal(readFileSync(join(project, path), 'utf8'), source, `${name}: ${path} changed`);
  }
  restoreInputs();
  return report.result;
}

function tuples(result) {
  return result.mutation.outcomes.map(({id, path, localId, offset, original, replacement, verdict}) =>
    ({id, path, localId, offset, original, replacement, verdict}));
}

const replace = {};
const switching = {};
for (const workers of [1, 2]) {
  replace[workers] = run(`replace-${workers}`, {workers});
  switching[workers] = run(`switch-${workers}`, {workers, switching: true});
  assert.deepEqual(tuples(switching[workers]), tuples(replace[workers]));
  assert.deepEqual(switching[workers].sources, replace[workers].sources);
  assert.equal(switching[workers].mutation.strategy, 'switch');
  assert.equal(switching[workers].mutation.preparedBaselineJobs, 1);
  assert.equal(switching[workers].mutation.preparedBaselines[0].state, 'passed');
  assert.equal(switching[workers].mutation.workersUsed, workers);
  assert.equal(switching[workers].mutation.workerBaselineJobs, workers - 1);
  assert.equal(switching[workers].mutation.workerBaselines.length, workers - 1);
  assert.ok(switching[workers].mutation.workerBaselines.every(({state}) => state === 'passed'));
  assert.deepEqual(switching[workers].mutation.outcomes.map(({path, localId}) => [path, localId]), [
    ['src/first.ts', 0], ['src/first.ts', 1], ['src/second.ts', 0], ['src/second.ts', 1],
  ]);
}

const zero = run('switch-zero', {switching: true, sourceInclude: ['src/plain.ts']});
assert.equal(zero.complete, true);
assert.equal(zero.mutation.strategy, 'switch');
assert.equal(zero.mutation.planned, 0);
assert.equal(zero.mutation.preparedBaselineJobs, 0);
assert.equal(zero.mutation.workerBaselineJobs, 0);
assert.equal(zero.mutation.workersUsed, 0);

const observed = readFileSync(events, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
for (const id of [0, 1, 2, 3]) {
  assert.ok(observed.some(event => event.switched && event.active === String(id)), `switch mutant ${id} was not active`);
}
assert.ok(observed.filter(event => event.switched && event.active === null).length >= 3,
  'prepared baselines must run without an active mutant');

const failed = run('prepared-failure', {switching: true, testFile: 'tests/prepared-failure.mjs'});
assert.equal(failed.complete, false);
assert.equal(failed.mutation.score, null);
assert.equal(failed.mutation.preparedBaselineJobs, 1);
assert.equal(failed.mutation.preparedBaselines[0].state, 'execution-error');
assert.equal(failed.mutation.jobsAttempted, 0);
assert.ok(failed.mutation.outcomes.every(({verdict}) => verdict === 'not-run'));

const timedOut = run('prepared-timeout', {switching: true, testFile: 'tests/prepared-timeout.mjs'});
assert.equal(timedOut.complete, false);
assert.equal(timedOut.mutation.score, null);
assert.equal(timedOut.mutation.preparedBaselines[0].state, 'timed-out');
assert.equal(timedOut.mutation.jobsAttempted, 0);

const crapConfig = join(project, 'seshat.json');
writeFileSync(crapConfig, JSON.stringify(baseConfig('tests/check.mjs')));
const rejected = spawnSync(binary, ['crap', '--config', crapConfig, '--scratch', scratch,
  '--experimental-switching', '--json'], {encoding: 'utf8'});
assert.equal(rejected.status, 2);
assert.match(JSON.parse(rejected.stdout).result.error, /only available for check or mutate/);
assert.deepEqual(readdirSync(scratch), []);
console.log(`Switching checks passed: replace/switch verdicts at workers 1 and 2, global IDs, prepared baselines, failure/timeout handling, rejection and cleanup. Evidence: ${work}`);
