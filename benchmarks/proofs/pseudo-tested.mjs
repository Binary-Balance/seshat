// Real Node coverage and tests; all application inputs are disposable.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const binary = process.env.SESHAT_CLI_BINARY ?? join(repo, 'crates/seshat/target/release/seshat');
mkdirSync(join(repo, 'work/assurance-proofs'), {recursive:true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/pseudo-tested-'));
const input = join(work, 'input'), scratch = join(work, 'scratch');
mkdirSync(input); mkdirSync(scratch);
const source = `export let count = 0;
export function checked(value: number) { return value + 1; }
export function unchecked(value: number) { return value + 2; }
export function side() { count += 1; }
export function absent() { return 9; }
export function empty() {}
export function outer() { function nested() { return 3; } nested(); }
export async function asyncValue() { return 2; }
export const concise = () => ({ value: 2 });
export function* generator() { yield 1; }
export class Model {
  constructor() { count += 1; }
  get value() { return 1; }
  set value(value: number) { count += value; }
  method() { return 1; }
}
`;
const tests = `import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checked, unchecked, side, empty, outer, asyncValue, concise, generator, Model} from './subject.ts';
test('functions', async () => {
  assert.equal(checked(2), 3); unchecked(2); side(); empty(); outer();
  assert.equal(await asyncValue(), 2); assert.deepEqual(concise(), {value:2});
  assert.deepEqual([...generator()], [1]);
  const model = new Model(); assert.equal(model.value, 1); model.value = 1;
  assert.equal(model.method(), 1);
});
`;
for (const [path, contents] of Object.entries({'subject.ts':source, 'test.mjs':tests, 'package.json':'{"type":"module"}'})) {
  writeFileSync(join(input, path), contents);
}
const setup = {
  name:'node', runner:'node', cwd:'.', timeoutMs:15000,
  typecheck:[process.execPath, join(repo, 'benchmarks/node_modules/typescript/bin/tsc'), '--ignoreConfig', '--strict', '--noEmit', '--skipLibCheck', '--target', 'es2022', 'subject.ts'],
  test:[process.execPath, '--test', '--test-reporter={seshatReporter}', 'test.mjs'],
  coverage:{command:[process.execPath, join(here, 'collect-node.mjs'), 'test.mjs'], report:'coverage/final.json'},
};
const config = {source:{include:['subject.ts']}, capture:['subject.ts','test.mjs','package.json'], setups:[setup]};
const configPath = join(input, 'seshat.json');
const results = {};
function run(name, command = 'check', change = () => {}, flags = []) {
  const value = structuredClone(config); change(value);
  writeFileSync(configPath, JSON.stringify(value));
  const child = spawnSync(binary, [command,'--config',configPath,'--scratch',scratch,'--json',...flags], {encoding:'utf8',timeout:60000});
  assert.ifError(child.error);
  const report = JSON.parse(child.stdout);
  assert.equal(child.status, report.complete ? 0 : 2, child.stdout + child.stderr);
  assert.deepEqual(readdirSync(scratch), []);
  assert.equal(readFileSync(join(input,'subject.ts'),'utf8'), source);
  results[name] = report;
  console.log(`${name}: complete=${report.complete}, pseudo-tested=${report.result.pseudoTesting?.pseudoTested}`);
  return report;
}
const checked = run('check');
assert.equal(checked.complete, true, JSON.stringify(checked));
const rows = checked.result.sources[0].result.functions;
const named = name => rows.find(row => row.name === name);
assert.equal(named('checked').pseudoTested, false);
assert.equal(named('unchecked').pseudoTested, true);
assert.equal(named('side').pseudoTested, true);
assert.equal(named('outer').pseudoTested, true);
assert.equal(named('nested').pseudoTested, true);
assert.equal(named('asyncValue').pseudoTested, false);
assert.equal(named('absent').pseudoTestReason, 'zero-coverage');
assert.equal(named('empty').pseudoTestReason, 'empty');
assert.equal(named('generator').pseudoTestReason, 'generator');
assert.equal(rows.filter(row => row.pseudoTestReason === 'constructor').length, 1);
assert.equal(rows.filter(row => row.pseudoTestReason === 'accessor').length, 2);
assert.equal(checked.result.pseudoTesting.pseudoTested, 4);
assert.equal(checked.result.pseudoTesting.checked, 4);
assert.equal(checked.result.pseudoTesting.planned, 8);
assert.equal(checked.result.pseudoTesting.unknown, 0);
assert.equal(checked.result.pseudoTesting.score, undefined);
assert.equal(checked.result.mutation.planned, 0);
assert.equal(checked.result.mutation.score, null);
assert.equal(checked.result.pseudoTesting.outcomes.find(row => row.name === 'side').replacement, '{}');
assert.equal(checked.result.pseudoTesting.outcomes.find(row => row.name === 'unchecked').replacement, '{ return undefined; }');
assert.deepEqual(run('mutate', 'mutate').result.sources, checked.result.sources);
assert.equal(run('switching', 'mutate', () => {}, ['--experimental-switching']).result.pseudoTesting.strategy, 'replace');
const crap = run('crap', 'crap');
assert.equal(crap.result.pseudoTesting, undefined);
assert.ok(crap.result.sources[0].result.functions.every(row => row.pseudoTested === undefined));

const wrapped = action => [process.execPath, '-e', `if(process.env.SESHAT_EXECUTION_ID.includes('-extreme-0-')){${action}}else{const child=require('child_process').spawnSync(process.execPath,['--test','--test-reporter='+process.env.SESHAT_NODE_REPORTER,'test.mjs'],{stdio:'inherit'});process.exit(child.status??2);}`];
for (const [name, action, verdict] of [['error','process.exit(1);','execution-error'], ['timeout','setInterval(()=>{},1000);','timed-out']]) {
  const report = run(name, 'mutate', value => {
    value.setups[0].typecheck = [process.execPath,'--check','test.mjs'];
    value.setups[0].timeoutMs = 15000;
    value.setups[0].test = wrapped(action);
  });
  assert.equal(report.complete, false);
  assert.equal(report.result.pseudoTesting.outcomes[0].verdict, verdict);
  assert.ok(report.result.pseudoTesting.outcomes.slice(1).every(row => row.verdict === 'not-run'));
  assert.equal(report.result.sources[0].result.functions[0].pseudoTested, null);
  assert.equal(report.result.pseudoTesting.pseudoTested, 0);
}
const baseline = run('baseline-error', 'check', value => value.setups[0].test = [process.execPath,'-e','process.exit(1)']);
assert.ok(baseline.result.pseudoTesting.outcomes.every(row => row.verdict === 'unassessed'));
assert.equal(baseline.result.pseudoTesting.jobsAttempted, 0);
const mixed = run('mixed-setups', 'check', value => {
  const second = structuredClone(value.setups[0]);
  second.name = 'second'; second.coverage.report = 'coverage-second/final.json';
  second.test = wrapped('process.exit(1);');
  value.setups.push(second);
});
assert.deepEqual(mixed.result.pseudoTesting.outcomes[0].setups.map(row => row.state), ['failed','execution-error']);
assert.equal(mixed.result.pseudoTesting.outcomes[0].verdict, 'execution-error');
assert.equal(mixed.result.sources[0].result.functions[0].pseudoTested, null);

const unknown = run('unknown-coverage', 'check', value => {
  value.setups[0].coverage.command = [process.execPath,'-e', `const fs=require('fs'),path=require('path'),file=path.resolve('subject.ts');
    fs.mkdirSync('coverage',{recursive:true});
    fs.writeFileSync(process.env.SESHAT_COVERAGE_REPORT,JSON.stringify({[file]:{path:file,statementMap:{},s:{},branchMap:{},b:{}}}));
    fs.writeFileSync(process.env.SESHAT_RECEIPT,JSON.stringify({version:1,executionId:process.env.SESHAT_EXECUTION_ID,node:process.versions.node,complete:true,passed:1,failed:0,errors:0}));`];
});
assert.equal(unknown.complete, false);
assert.equal(unknown.result.pseudoTesting.complete, false);
assert.equal(unknown.result.pseudoTesting.pseudoTested, 0);
assert.ok(unknown.result.sources[0].result.functions.every(row => row.pseudoTested === null));
assert.ok(unknown.result.pseudoTesting.outcomes.some(row => row.verdict === 'survived'));
assert.equal(unknown.result.sources[0].result.functions.find(row => row.name === 'absent').pseudoTestReason, null);

if (process.platform !== 'win32') {
  const marker = join(work, 'extreme-ready'), value = structuredClone(config);
  value.setups[0].typecheck = [process.execPath,'--check','test.mjs'];
  value.setups[0].timeoutMs = 30000;
  value.setups[0].test = wrapped(`require('fs').writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000);`);
  writeFileSync(configPath, JSON.stringify(value));
  const child = spawn(binary, ['mutate','--config',configPath,'--scratch',scratch,'--json'], {timeout:30000});
  let stdout = '', stderr = '', closed = false;
  child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
  const done = new Promise((resolve, reject) => {child.once('error',reject);child.once('close',status => {closed=true;resolve(status);});});
  try {
    const deadline = performance.now() + 15000;
    while (!existsSync(marker) && !closed && performance.now() < deadline) await delay(20);
    assert.ok(existsSync(marker), stdout + stderr);
    child.kill('SIGTERM');
    assert.equal(await done, 143, stdout + stderr);
    const report = JSON.parse(stdout);
    assert.equal(report.cancelled, true);
    assert.equal(report.result.pseudoTesting.complete, false);
    assert.equal(report.result.pseudoTesting.outcomes[0].verdict, 'cancelled');
    assert.equal(report.result.sources[0].result.functions[0].pseudoTested, null);
    assert.equal(report.result.mutation.jobsAttempted, 0);
    assert.deepEqual(readdirSync(scratch), []);
    assert.equal(readFileSync(join(input,'subject.ts'),'utf8'), source);
    results.cancellation = report;
    console.log('cancellation: extreme child stopped, flags unknown, scratch clean');
  } finally {
    if (!closed) child.kill('SIGKILL');
    await done;
  }
}

writeFileSync(process.env.SESHAT_PROOF_OUTPUT ?? join(work,'result.json'), JSON.stringify(results,null,2)+'\n');
console.log(`Pseudo-testing proof passed: ${Object.keys(results).length} scenarios.`);
