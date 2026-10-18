// Fixed statement-removal semantics and matched CLI cost on disposable fixtures.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import ts from '../node_modules/typescript/lib/typescript.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const suffix = process.platform === 'win32' ? '.exe' : '';
const binary = resolve(process.env.SESHAT_CLI_BINARY ?? join(repo, 'crates/seshat/target/release/seshat' + suffix));
const proof = resolve(process.env.SESHAT_PROOF_BINARY ?? join(repo, 'crates/seshat/target/release/seshat-proofs' + suffix));
mkdirSync(join(repo, 'work/assurance-proofs'), {recursive:true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/statement-'));
const project = join(work, 'input');
const scratch = join(work, 'scratch');
mkdirSync(project);
mkdirSync(scratch);
const digest = value => createHash('sha256').update(value).digest('hex');
function invoke(executable, args, status = 0) {
  const child = spawnSync(executable, args, {encoding:'utf8', timeout:120000, maxBuffer:16 * 1024 * 1024});
  assert.ifError(child.error);
  assert.equal(child.status, status, child.stdout + child.stderr);
  return JSON.parse(child.stdout);
}
const encode = value => JSON.stringify(value, (_, value) => value === undefined ? {undefined:true} : value);
async function evaluate(source, active) {
  const compiled = ts.transpileModule(source, {compilerOptions:{
    target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS,
    moduleDetection:ts.ModuleDetectionKind.Legacy, ignoreDeprecations:'6.0',
    alwaysStrict:false,
    jsx:ts.JsxEmit.React, jsxFactory:'h',
  }, reportDiagnostics:true});
  assert.deepEqual(compiled.diagnostics, []);
  try {
    return {value:encode(await runInNewContext(compiled.outputText,
      {process:{env:active === undefined ? {} : {SESHAT_MUTANT_ID:String(active)}}}, {timeout:1000}))};
  } catch (error) {
    return {error:error.name};
  }
}
const cases = [
  ['effects', "function f() { const log: string[] = []; log.push('first'); log.push('second'); return log; } f();",
    ['first','second'], [['second'],['first']]],
  ['guard', "const log: string[] = []; function f(stop: boolean) { if (stop) return; log.push('work'); } f(true); log;",
    [], [['work'],[]]],
  ['if-else', 'function f(flag: boolean) { let value = 0; if (flag) value = 1; else value = 2; return value; } [f(true),f(false)];',
    [1,2], [[0,2],[1,0]]],
  ['for', 'function f() { let value = 0; for (let i = 0; i < 2; i++) value++; return value; } f();', 2, [0]],
  ['while', 'function f() { let i = 0, value = 0; while (i++ < 2) value++; return value; } f();', 2, [0]],
  ['do', 'function f() { let i = 0, value = 0; do value++; while (i++ < 1); return value; } f();', 2, [0]],
  ['for-of', 'function f() { let value = 0; for (const item of [1,2]) value += item; return value; } f();', 3, [0]],
  ['for-in', 'function f() { let value = 0; for (const key in {a:1,b:2}) value++; return value; } f();', 2, [0]],
  ['label', 'function f() { let value = 0; label: value++; return value; } f();', 1, [0]],
  ['labelled-continue', 'function f() { let value = 0; outer: for (let i = 0; i < 2; i++) { if (i < 1) continue outer; value++; } return value; } f();', 1, [0]],
  ['fall-through', "function f() { const log: string[] = []; switch (1) { case 1: log.push('one'); case 2: log.push('two'); break; } return log; } f();",
    ['one','two'], [['two'],['one']]],
  ['switch-return', 'function f() { let value = 0; switch (1) { case 1: return; default: break; } value++; return value; } f();',
    undefined, [1,undefined]],
  ['finally', 'function f() { try { throw new Error(); } finally { return; } } f();', undefined, [{error:'Error'}]],
  ['return-asi', 'function f() { return\nmissing(); } f();', undefined, [{error:'ReferenceError'},undefined]],
  ['asi-and-trivia', 'function f() { const value = {x:0,y:0}; /* 🎸 */ value.x = 1\nvalue.y = 2\nreturn value; } f();',
    {x:1,y:2}, [{x:0,y:2},{x:1,y:0}]],
  ['directive', "function f() { 'use strict'; let value = 0; value++; return [this === undefined,value]; } f();", [true,1], [[true,0]]],
  ['directive-barrier', "function f() { 123; 'use strict'; return this === undefined; } f();", false, [false,false]],
  ['direct-eval', "function f() { let value = 0; eval('value = 7'); return value; } f();", 7, [0]],
  ['nested', 'function f() { let value = 0; function inner() { value++; } inner(); return value; } f();', 1, [0,0]],
  ['nested-expression', 'function f() { let value = 0; (() => { value++; })(); return value; } f();', 1, [0,0]],
  ['equivalent-expression', 'function f() { 123; return 7; } f();', 7, [7]],
  ['equivalent-return', 'function f() { return; } f();', undefined, [undefined]],
  ['same-span-boolean', 'function f() { true } f();', undefined, [undefined]],
  ['value-return', 'function f() { return 7; } f();', 7, []],
  ['void-return', 'const log: number[] = []; function f() { return void log.push(7); } [f(),log];', [undefined,[7]], []],
  ['async', 'async function f() { await Promise.resolve(); return; } f();', undefined, []],
  ['generator', 'function* f() { yield 7; return; } [...f()];', [7], []],
  ['nested-in-async', 'async function f() { function inner() { 123; } inner(); return 7; } f();', 7, [7]],
  ['nested-async', 'function f() { const inner = async () => { 123; return; }; return 7; } f();', 7, []],
  ['constructor', 'class C { constructor() { work(); } } 7;', 7, []],
  ['super-arrow', 'class B {} class C extends B { constructor() { (() => { consume(super()); })(); } } 7;', 7, []],
  ['super-method', 'class B { method() {} } class C extends B { method() { super.method(); return 7; } } new C().method();', 7, [7]],
  ['static-block', 'class C { static { 123; } } 7;', 7, []],
  ['tsx.tsx', 'function h(tag: any, props: any) { return props; } function f() { <input ready/>; return 7; } f();', 7, [7]],
];
let semanticMutants = 0;
const semantics = [];
for (const [name, source, expected, mutants] of cases) {
  const extension = name.endsWith('.tsx') ? '' : '.ts';
  const input = join(work, name + extension);
  const prepared = join(work, 'prepared-' + name + extension);
  const replacement = join(work, 'replacement-' + name + extension);
  writeFileSync(input, source);
  const facts = invoke(proof, ['inspect',input]);
  const sites = facts.mutants.filter(row => row.kind === 'statement');
  assert.equal(sites.length, mutants.length, name);
  assert.deepEqual(invoke(proof, ['inspect',input]), facts, name + ': stable identities');
  invoke(proof, ['prepare',input,prepared]);
  const switched = readFileSync(prepared,'utf8');
  const originalResult = {value:encode(expected)};
  assert.deepEqual(await evaluate(source), originalResult, name + ': original');
  assert.deepEqual(await evaluate(switched), originalResult, name + ': inactive');
  for (const [index, row] of sites.entries()) {
    invoke(proof, ['replace',input,replacement,String(row.id)]);
    const changed = readFileSync(replacement,'utf8');
    assert.notEqual(changed, source);
    const expectedResult = mutants[index]?.error ? mutants[index] : {value:encode(mutants[index])};
    assert.deepEqual(await evaluate(changed), expectedResult, name + ': replacement ' + row.id);
    assert.deepEqual(await evaluate(switched,row.id), expectedResult, name + ': switching ' + row.id);
    semanticMutants++;
  }
  // The new statement wrapper must also preserve nested expression mutations.
  for (const row of facts.mutants.filter(row => row.kind !== 'statement')) {
    invoke(proof, ['replace',input,replacement,String(row.id)]);
    assert.deepEqual(await evaluate(switched,row.id), await evaluate(readFileSync(replacement,'utf8')), name + ': nested operator ' + row.id);
  }
  assert.equal(readFileSync(input,'utf8'),source);
  semantics.push({name,sites:sites.length,sourceSha256:digest(source)});
}
console.log('Statement semantics: ' + cases.length + ' cases, ' + semanticMutants + ' active pairs');

const originals = {
  'package.json':'{"type":"module"}',
  'statements.ts':[
    'export function add(log: number[]) { log.push(7); return log.length; }',
    'export function guard(stop: boolean, log: number[]) { if (stop) return; log.push(1); }',
    'export function equivalent() { 123; return 7; }',
    'export function terminal() { return; }',
    '',
  ].join('\n'),
  'comparison.ts':'export function positive(value: number) { return value > 0; }\n',
  'test.mjs':[
    "import {test} from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import {add,guard,equivalent,terminal} from './statements.ts';",
    "import {positive} from './comparison.ts';",
    "test('statements', () => {",
    '  const log = []; assert.equal(add(log),1); assert.deepEqual(log,[7]);',
    '  const guarded = []; guard(true,guarded); assert.deepEqual(guarded,[]);',
    '  guard(false,guarded); assert.deepEqual(guarded,[1]);',
    '  assert.equal(equivalent(),7); assert.equal(terminal(),undefined);',
    '  assert.deepEqual([positive(-1),positive(0),positive(1)],[false,false,true]);',
    '});',
    '',
  ].join('\n'),
};
for (const [path,source] of Object.entries(originals)) writeFileSync(join(project,path),source);
const oldFamilies = ['comparison','logical','arithmetic','boolean'];
const allFamilies = [...oldFamilies,'statement'];
const config = {source:{include:['*.ts']},capture:Object.keys(originals),setups:[{
  name:'node',runner:'node',cwd:'.',timeoutMs:10000,
  typecheck:[process.execPath,join(repo,'benchmarks/node_modules/typescript/bin/tsc'),'--ignoreConfig','--strict','--noEmit','--skipLibCheck','statements.ts','comparison.ts'],
  test:[process.execPath,'--test','--test-concurrency=1','--test-reporter={seshatReporter}','test.mjs'],
  coverage:{command:[process.execPath,join(here,'collect-node.mjs'),'test.mjs'],report:'coverage/final.json'},
}]};
const reports = [];
function assess(name, operators, switching = false, workers = 1, status = 0) {
  const input = {...config,workers};
  if (operators !== undefined) input.mutationOperators = operators;
  const path = join(project,'seshat.json');
  writeFileSync(path,JSON.stringify(input));
  const args = ['mutate','--config',path,'--scratch',scratch,'--json','--no-progress'];
  if (switching) args.push('--experimental-switching');
  const report = invoke(binary,args,status);
  const result = report.result.mutation;
  assert.equal(report.complete,status === 0,JSON.stringify(report));
  const enabled = operators ?? allFamilies;
  assert.deepEqual(result.enabledOperators,enabled);
  const planned = (enabled.includes('statement') ? 5 : 0) + (enabled.includes('comparison') ? 2 : 0);
  assert.equal(result.planned,planned);
  assert.equal(result.completed,status === 0 ? planned : 1);
  assert.equal(result.notRun,status === 0 ? 0 : planned - 1);
  assert.equal(result.jobsAttempted,status === 0 ? planned : 1);
  assert.equal(report.result.pseudoTesting.planned,5);
  for (const key of ['planned','completed','jobsAttempted']) {
    assert.equal(result.perOperator.reduce((sum,row) => sum + row[key],0),result[key]);
  }
  assert(result.perOperator.every(row => row.executionMs >= 0));
  if (status === 0) {
    assert.equal(result.unresolved,0);
    assert.equal(result.survived,enabled.includes('statement') ? 2 : 0);
    assert.equal(result.killed,planned - result.survived);
    assert.equal(result.score,planned === 0 ? null : result.killed / planned * 100);
  } else {
    assert.equal(result.unresolved,planned);
    assert.equal(result.score,null);
    assert.equal(result.outcomes.filter(row => row.kind === 'statement' && row.verdict === 'timed-out').length,1);
  }
  assert.deepEqual(readdirSync(scratch),[]);
  for (const [path,source] of Object.entries(originals)) assert.equal(readFileSync(join(project,path),'utf8'),source);
  reports.push({name,totalJobsAttempted:report.result.jobsAttempted,...result});
  console.log(name + ': ' + planned + ' planned, ' + result.killed + ' killed, ' + result.survived + ' survived');
  return result;
}
const stable = result => result.outcomes.map(({id,localId,path,offset,kind,original,replacement,verdict}) =>
  ({id,localId,path,offset,kind,original,replacement,verdict}));
const replaced = assess('default-replacement');
assert.deepEqual(stable(assess('default-switching',undefined,true)),stable(replaced));
const isolated = assess('statement-only',['statement']);
assert.deepEqual(stable(assess('statement-only-parallel',['statement'],false,2)),stable(isolated));
assert.deepEqual(stable(assess('statement-switching-parallel',['statement'],true,2)),stable(isolated));
assess('no-operators',[]);
const samples = Number(process.env.SESHAT_OPERATOR_SAMPLES ?? 1);
assert(Number.isInteger(samples) && samples >= 1 && samples <= 7);
// Warm both strategies before the alternating matched measurements.
for (const switching of [false,true]) assess('warmup-' + switching,undefined,switching);
for (let sample = 0; sample < samples; sample++) {
  for (const switching of sample % 2 === 0 ? [false,true] : [true,false]) {
    for (const enabled of sample % 2 === 0 ? [false,true] : [true,false]) {
      assess('cost-' + (enabled ? 'on' : 'off') + '-' + (switching ? 'switch' : 'replace') + '-' + sample,
        enabled ? undefined : oldFamilies,switching);
    }
  }
}
for (let sample = 0; sample < samples; sample++) {
  for (const strategy of ['switch','replace']) {
    const off = reports.find(row => row.name === 'cost-off-' + strategy + '-' + sample);
    const on = reports.find(row => row.name === 'cost-on-' + strategy + '-' + sample);
    assert.equal(on.totalJobsAttempted - off.totalJobsAttempted,5);
  }
}
const originalTestCommand = config.setups[0].test;
config.setups[0].timeoutMs = 3000;
config.setups[0].test = [process.execPath,'-e',`
  if (process.env.SESHAT_EXECUTION_ID.includes('-mutant-0-')) setInterval(() => {},1000);
  else {
    const child = require('node:child_process').spawnSync(process.execPath,
      ['--test','--test-concurrency=1','--test-reporter=' + process.env.SESHAT_NODE_REPORTER,'test.mjs'],{stdio:'inherit'});
    process.exit(child.status ?? 2);
  }
`];
assess('job-timeout',['statement'],false,1,2);
config.setups[0].test = originalTestCommand;
const output = resolve(process.env.SESHAT_PROOF_OUTPUT ?? join(work,'statement.json'));
const evidence = {
  environment:{node:process.version,platform:process.platform,arch:process.arch,typescript:ts.version},
  binaries:{cliSha256:digest(readFileSync(binary)),proofSha256:digest(readFileSync(proof))},
  semantics,semanticMutants,
  fixtureHashes:Object.fromEntries(Object.entries(originals).map(([path,source]) => [path,digest(source)])),
  equivalentMutants:{statement:{count:2,planned:5},
    basis:'Discarding the numeric literal has no effect in equivalent(); dropping terminal bare return has no effect in terminal(). Neither function reflects on source. These closed examples do not estimate equivalence elsewhere.'},
  samples,reports,
};
mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify(evidence,(_,value) => typeof value === 'string'
  ? value.replaceAll(work,'<work>').replaceAll(repo,'<repo>').replaceAll(process.execPath,'<node>')
    .replaceAll(work.replaceAll('\\','/'),'<work>').replaceAll(repo.replaceAll('\\','/'),'<repo>') : value,2) + '\n');
console.log('Statement operator proof passed. Results: ' + output);
