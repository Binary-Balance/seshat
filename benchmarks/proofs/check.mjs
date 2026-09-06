// Combined captured-project proof. All application inputs are disposable.
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const work = mkdtempSync(join(repo, 'work/assurance-proofs/check-'));
const project = join(work, 'input 🎸');
const scratch = join(work, 'scratch');
mkdirSync(join(project, 'src'), {recursive:true});
mkdirSync(join(project, 'tests'));
mkdirSync(scratch);
const originals = {
  'package.json':'{"type":"module"}',
  'src/age.ts':'export function adult(age: number) { return age >= 18; }\nexport const initial = 2 < 3;\n',
  'src/label.ts':"export function label(value: string | null) { if (value === null) return 'none'; return value.toUpperCase(); }\n",
  'tests/high.mjs':"import {test} from 'node:test';import assert from 'node:assert/strict';import {adult,initial} from '../src/age.ts';import {label} from '../src/label.ts';test('high',()=>{assert.equal(adult(20),true);assert.equal(initial,true);assert.equal(label('ok'),'OK');});",
  'tests/low.mjs':"import {test} from 'node:test';import assert from 'node:assert/strict';import {adult,initial} from '../src/age.ts';import {label} from '../src/label.ts';test('low',()=>{assert.equal(adult(10),false);assert.equal(initial,true);assert.equal(label(null),'none');});",
};
const writeInputs = () => {for (const [path, source] of Object.entries(originals)) writeFileSync(join(project, path), source);};
writeInputs();
const setup = name => ({name, runner:'node', cwd:'.', timeoutMs:10000,
  typecheck:[process.execPath, join(repo, 'benchmarks/node_modules/typescript/bin/tsc'), '--ignoreConfig', '--strict', '--noEmit', '--skipLibCheck', '--target', 'es2022', 'src/age.ts', 'src/label.ts'],
  test:[process.execPath, '--test', '--test-reporter={seshatReporter}', `tests/${name}.mjs`],
  coverage:{command:[process.execPath, join(here, 'collect-node.mjs'), `tests/${name}.mjs`], report:`coverage-${name}/final.json`}});
const config = {source:{include:['src/**/*.ts']}, capture:['package.json', 'src', 'tests'], setups:[setup('high'), setup('low')]};
const results = {};
function check(name, change = () => {}) {
  const input = structuredClone(config);
  change(input);
  const configPath = join(project, 'seshat.json');
  writeFileSync(configPath, JSON.stringify(input));
  const child = spawnSync(join(repo, 'benchmarks/rust/target/release/seshat-proofs'), ['check', configPath, scratch], {encoding:'utf8', timeout:60000});
  assert.ifError(child.error);
  const result = JSON.parse(child.stdout);
  assert.equal(child.status, result.complete === true ? 0 : 2, child.stdout + child.stderr);
  assert.deepEqual(readdirSync(scratch), [], 'captured copy and receipts must be cleaned up');
  for (const [path, source] of Object.entries(originals)) assert.equal(readFileSync(join(project, path), 'utf8'), source);
  results[name] = result;
  console.log(`${name}: complete=${result.complete}, score=${result.mutation?.score ?? 'none'}`);
  return result;
}
const passed = check('complete');
assert.equal(passed.complete, true, JSON.stringify(passed));
assert.equal(passed.jobsAttempted, 16, 'two typechecks, two baselines, two coverage jobs, ten mutant jobs');
assert.equal(passed.mutation.score, 60);
assert.deepEqual(passed.mutation.outcomes.map(m => [m.id,m.path,m.localId,m.verdict]), [
  [0,'src/age.ts',0,'survived'], [1,'src/age.ts',1,'killed'],
  [2,'src/age.ts',2,'survived'], [3,'src/age.ts',3,'killed'], [4,'src/label.ts',0,'killed'],
]);
assert.ok(passed.mutation.outcomes.every(m => m.setups.length === 2 && m.setups.every(s => ['passed','failed'].includes(s.state))));
assert.ok(passed.setups.every(s => s.typecheck.state === 'passed'));
assert.ok(passed.sources.every(s => s.result.complete));
const repeat = check('repeat');
assert.deepEqual(repeat.mutation.outcomes.map(({id,path,localId,offset,original,replacement,verdict}) => ({id,path,localId,offset,original,replacement,verdict})),
  passed.mutation.outcomes.map(({id,path,localId,offset,original,replacement,verdict}) => ({id,path,localId,offset,original,replacement,verdict})));

const missing = check('missing-typecheck', c => delete c.setups[1].typecheck);
assert.match(missing.error, /typecheck/);
const label = originals['src/label.ts'];
originals['src/label.ts'] = 'export const bad: number = "not a number";\n';
writeInputs();
const invalid = check('invalid-original');
assert.equal(invalid.setups[0].typecheck.state, 'execution-error');
assert.equal(invalid.setups[0].baseline.state, 'not-run');
assert.equal(invalid.mutation.jobsAttempted, 0);
assert.equal(invalid.mutation.score, null);
originals['src/label.ts'] = label;
writeInputs();

const node = code => [process.execPath, '-e', code];
const wrappedTest = (condition, action) => node(`const fs=require('fs');if(${condition}){${action}}else{const run=require('child_process').spawnSync(process.execPath,['--test','--test-reporter='+process.env.SESHAT_NODE_REPORTER,'tests/low.mjs'],{stdio:'inherit'});process.exit(run.status??2);}`);
const inverted = "fs.readFileSync('src/age.ts','utf8').includes('age < 18')";
for (const [name, action, expected] of [
  ['mixed-error', 'process.exit(1);', 'execution-error'],
  ['mixed-timeout', 'setInterval(()=>{},1000);', 'timed-out'],
]) {
  const failed = check(name, c => {c.setups[1].timeoutMs=3000;c.setups[1].test=wrappedTest(inverted,action);});
  assert.equal(failed.complete, false);
  assert.equal(failed.mutation.score, null);
  assert.equal(failed.mutation.outcomes[0].verdict, 'survived');
  assert.equal(failed.mutation.outcomes[1].setups[0].state, 'failed');
  assert.equal(failed.mutation.outcomes[1].setups[1].state, expected);
  assert.equal(failed.mutation.outcomes[1].verdict, expected);
  assert.ok(failed.mutation.outcomes.slice(2).every(m => m.verdict === 'not-run'));
}
const baseline = check('failed-baseline', c => c.setups[0].test = node('process.exit(1)'));
assert.equal(baseline.mutation.jobsAttempted, 0);
assert.ok(baseline.mutation.outcomes.every(m => m.verdict === 'unassessed'));
const coverage = check('missing-coverage', c => c.setups[0].coverage.command = c.setups[0].test);
assert.equal(coverage.mutation.jobsAttempted, 0);
assert.equal(coverage.mutation.score, null);
const changed = check('changed-mutant-source', c => c.setups[1].test = wrappedTest(inverted, "fs.writeFileSync('src/label.ts','changed');process.exit(0);"));
assert.equal(changed.complete, false);
assert.match(changed.mutation.outcomes[1].setups[1].sourceError, /source changed/);
assert.match(changed.mutation.restorationError, /source changed/);
assert.equal(changed.mutation.score, null);
const linked = check('linked-mutant-source', c => c.setups[1].test = wrappedTest(inverted,
  `fs.unlinkSync('src/age.ts');fs.symlinkSync(${JSON.stringify(join(project, 'src/age.ts'))},'src/age.ts');process.exit(0);`));
assert.equal(linked.complete, false);
assert.match(linked.mutation.outcomes[1].setups[1].sourceError, /unsafe path/);
assert.match(linked.mutation.restorationError, /unsafe path/);
assert.equal(linked.mutation.score, null);

originals['src/age.ts'] = 'export function adult(age: number) { return Boolean(age); }\nexport const initial = true;\n';
originals['src/label.ts'] = 'export function label(value: string | null) { return String(value); }\n';
originals['tests/high.mjs'] = "import {test} from 'node:test';import assert from 'node:assert/strict';import {adult,initial} from '../src/age.ts';import {label} from '../src/label.ts';test('plain',()=>{assert.equal(adult(20),true);assert.equal(initial,true);assert.equal(label('ok'),'ok');});";
originals['tests/low.mjs'] = originals['tests/high.mjs'];
writeInputs();
const empty = check('no-mutants');
assert.equal(empty.complete, true, JSON.stringify(empty));
assert.equal(empty.mutation.planned, 0);
assert.equal(empty.mutation.score, null);
assert.equal(empty.mutation.jobsAttempted, 0);
const output = join(work, 'result.json');
writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
console.log(`Combined check passed: ${Object.keys(results).length} scenarios. Results: ${output}`);
