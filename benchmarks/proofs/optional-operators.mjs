// Fixed optional/nullish semantics and matched CLI cost on disposable fixtures.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import ts from '../node_modules/typescript/lib/typescript.js';
import {packageVersion} from '../../packaging/metadata.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const suffix = process.platform === 'win32' ? '.exe' : '';
const binary = resolve(process.env.SESHAT_CLI_BINARY ?? join(repo, 'crates/seshat/target/release/seshat' + suffix));
const proof = resolve(process.env.SESHAT_PROOF_BINARY ?? join(repo, 'crates/seshat/target/release/seshat-proofs' + suffix));
mkdirSync(join(repo, 'work/assurance-proofs'), {recursive:true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/optional-'));
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
const encode = value => JSON.stringify(value, (_, value) => {
  if (value === undefined) return {undefined:true};
  if (typeof value === 'bigint') return {bigint:String(value)};
  if (typeof value === 'number' && Number.isNaN(value)) return {number:'NaN'};
  if (Object.is(value,-0)) return {number:'-0'};
  return value;
});
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
const error = name => ({error:name});
const cases = [
  ['static-member', 'const value = null as {field:number} | null; value?.field;', undefined, [error('TypeError')]],
  ['computed-short-circuit', "let calls = 0; const value = null as any; function key() { calls++; return 'field'; } let result; try { result = value?.[key()]; } catch (error) { result = error.name; } [result,calls];", [undefined,0], [['TypeError',1]]],
  ['computed-order', "const log: string[] = []; function object() { log.push('object'); return {field:7}; } function key() { log.push('key'); return 'field'; } const result = object()?.[key()]; [result,log];", [7,['object','key']], [[7,['object','key']]]],
  ['free-call', 'const fn = undefined as any; fn?.();', undefined, [error('TypeError')]],
  ['call-order', "const log: string[] = []; function next() { log.push('callee'); return (value: number) => { log.push('call'); return value; }; } function arg() { log.push('arg'); return 7; } const result = next()?.(arg()); [result,log];", [7,['callee','arg','call']], [[7,['callee','arg','call']]]],
  ['call-short-circuit', "let calls = 0; const fn = undefined as any; function arg() { calls++; return 7; } let result; try { result = fn?.(arg()); } catch (error) { result = error.name; } [result,calls];", [undefined,0], [['TypeError',1]]],
  ['receiver', "const log: string[] = []; const object = {get method() { log.push('get'); return function(value: number) { log.push(this === object ? 'bound' : 'lost'); return value; }; }}; function arg() { log.push('arg'); return 7; } const result = object.method?.(arg()); [result,log];", [7,['get','arg','bound']], [[7,['get','arg','bound']]]],
  ['getter-short-circuit', "const log: string[] = []; const object = {get method() { log.push('get'); return undefined; }}; function arg() { log.push('arg'); return 7; } let result; try { result = object.method?.(arg()); } catch (error) { result = error.name; } [result,log];", [undefined,['get']], [['TypeError',['get','arg']]]],
  ['member-call', "const object = {value:7, method() { return this.value; }}; object?.method();", 7, [7]],
  ['receiver-single-evaluation', "const log: string[] = []; const object = {method(value: number) { log.push(this === object ? 'bound' : 'lost'); return value; }}; function get() { log.push('receiver'); return object; } function arg() { log.push('arg'); return 7; } const result = get()?.method(arg()); [result,log];", [7,['receiver','arg','bound']], [[7,['receiver','arg','bound']]]],
  ['continuous-short-circuit', 'const value = null as any; value?.child.field;', undefined, [error('TypeError')]],
  ['first-segment', 'const value = null as any; value?.child?.field;', undefined, [error('TypeError'),undefined]],
  ['second-segment', 'const value = {child:null} as any; value?.child?.field;', undefined, [undefined,error('TypeError')]],
  ['mixed-chain', 'const value = {method() { return null; }} as any; value?.method?.()?.field;', undefined, [undefined,undefined,error('TypeError')]],
  ['parenthesized-chain', 'const value = null as any; let result; try { result = (value?.child).field; } catch { result = 7; } result;', 7, [7]],
  ['nested-key', "const value = {field:7}; const key = {name:'field'}; value?.[key?.name];", 7, [7,7]],
  ['nested-argument', "const object = {method(value: number) { return value; }}; const arg = {value:7}; object?.method(arg?.value);", 7, [7,7]],
  ['nullish-values', "function f(value: unknown) { return value ?? 7; } [f(null),f(undefined),f(0),f(-0),f(false),f(''),f(NaN),f(0n),f(1),f({})];", [7,7,0,-0,false,'',NaN,0n,1,{}], [[7,7,7,7,7,7,7,7,1,{}]]],
  ['nullish-side-effects', "const log: string[] = []; function next(name: string, value: number) { log.push(name); return value; } const result = next('left',0) ?? next('right',7); [result,log];", [0,['left']], [[7,['left','right']]]],
  ['nullish-short-circuit', "let calls = 0; function right() { calls++; return 9; } const result = 7 ?? right(); [result,calls];", [7,0], [[7,0]]],
  ['nested-defaults', 'const a = null, b = 0; (a ?? b) ?? 7;', 0, [7,0]],
  ['mixed-logical', 'const a = 0; (a ?? 7) && 9;', 0, [9]],
  ['default-parameter', 'function f(value = (0 as number | null) ?? 7) { return value; } f();', 0, [7]],
  ['chain-default', 'const value = {field:0}; value?.field ?? 7;', 0, [7,0]],
  ['class-field', 'class C { field = ({value:0} as any)?.value ?? 7; } new C().field;', 0, [7,0]],
  ['super-call', 'class B { method() { return this.value; } } class C extends B { value = 7; read() { return super.method?.(); } } new C().read();', 7, [7]],
  ['generic-call', 'const fn = <T,>(value: T) => value; fn?.<number>(7);', 7, [7]],
  ['non-null-chain', 'const value = {child:null} as any; value?.child!?.field;', undefined, [undefined,error('TypeError')]],
  ['await', 'async function f() { return (await Promise.resolve({field:0}))?.field ?? await Promise.resolve(7); } f();', 0, [7,0]],
  ['yield', 'function* f() { return (yield {field:0})?.field ?? (yield 7); } const iterator = f(); [iterator.next(),iterator.next({field:0}),iterator.next(9)];', [{value:{field:0},done:false},{value:0,done:true},{value:undefined,done:true}], [[{value:{field:0},done:false},{value:7,done:false},{value:9,done:true}],[{value:{field:0},done:false},{value:0,done:true},{value:undefined,done:true}]]],
  ['direct-eval-default', "function f() { let value = 0; const result = 0 ?? eval('value = 7'); return [result,value]; } f();", [0,0], [[7,7]]],
  ['optional-eval', "function f() { const local = 7; return eval?.('typeof local'); } f();", 'undefined', ['number']],
  ['numeric-receiver', '1?.toString();', '1', ['1']],
  ['unicode-trivia', "const object = {field:0}; /* 🎸 */ object /* ?. */ ?. /* field */ field ?? /* default */ 7;", 0, [7,0]],
  ['asi-chain', 'const object = {field:7}; let value = 0; value = 1\nobject?.field;', 7, [7]],
  ['asi-default', 'let value = 0; value = 1\n0 ?? 7;', 0, [7]],
  ['nested-function', 'function f(value: any) { return (() => value?.field ?? 7)(); } f({field:0});', 0, [7,0]],
  ['tsx.tsx', 'function h(tag: any, props: any) { return props; } const value = {field:0}; <input value={value?.field ?? 7}/>;', {value:0}, [{value:7},{value:0}]],
  ['excluded', 'interface T { field?: number; method?(): void } let value = null; value ??= 7; function f(arg = 7) { return arg; } value;', 7, []],
  ['equivalent-member', 'const value = {field:7}; value?.field;', 7, [7]],
  ['equivalent-default', 'const value = 7 as number | null; value ?? 9;', 7, [7]],
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
  const sites = facts.mutants.filter(row => row.kind === 'optional');
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
  // Whole-chain arms must also activate mutations inside their keys and arguments.
  for (const row of facts.mutants.filter(row => row.kind !== 'optional')) {
    invoke(proof, ['replace',input,replacement,String(row.id)]);
    assert.deepEqual(await evaluate(switched,row.id), await evaluate(readFileSync(replacement,'utf8')), name + ': nested operator ' + row.id);
  }
  assert.equal(readFileSync(input,'utf8'),source);
  semantics.push({name,sites:sites.length,sourceSha256:digest(source),original:originalResult,
    expectedMutants:mutants.map(value => value?.error ? value : {value:encode(value)}),definitions:sites});
}
console.log('Optional semantics: ' + cases.length + ' cases, ' + semanticMutants + ' active pairs');

const unsupported = [
  ['call-target', 'const value = {method() { return this === value; }}; (value?.method)();', true, true],
  ['optional-call-target', 'const value = {method() { return this === value; }}; (value?.method)?.();', true, true],
  ['tag-target', 'const value = {tag() { return this === value; }}; (value?.tag)`text`;', true, true],
  ['delete', 'const value = {field:7}; [delete value?.field,value];', [true,{}], [true,{}]],
  ['delete-ts-wrapper', 'const value = {field:7}; [delete (value?.field as any),value];', [true,{}], [true,{}]],
];
for (const [name,source,original,mutated] of unsupported) {
  const input = join(work,name + '.ts'), prepared = join(work,'prepared-' + name + '.ts');
  const replacement = join(work,'replacement-' + name + '.ts');
  writeFileSync(input,source); writeFileSync(prepared,'untouched');
  const sites = invoke(proof,['inspect',input]).mutants.filter(row => row.kind === 'optional');
  for (const site of sites) {
    invoke(proof,['replace',input,replacement,String(site.id)]);
    assert.deepEqual(await evaluate(readFileSync(replacement,'utf8')),{value:encode(mutated)});
  }
  assert.deepEqual(await evaluate(source),{value:encode(original)});
  assert.match(invoke(proof,['prepare',input,prepared],2).error,/optional chains/);
  assert.equal(readFileSync(prepared,'utf8'),'untouched');
  assert.equal(readFileSync(input,'utf8'),source);
}
const originals = {
  'package.json':'{"type":"module"}',
  'optional.ts':[
    'export function member(value: {field?: number} | null) { return value?.field; }',
    'export function call(value: (() => number) | undefined) { return value?.(); }',
    'export function defaults(value: number | null) { return value ?? 7; }',
    'export function chain(value: {child?: {field:number}} | null) { return value?.child?.field; }',
    'export function equivalent() { const value = {field:7}; return value?.field; }',
    'export function equivalentDefault() { const value = 7 as number | null; return value ?? 9; }',
    '',
  ].join('\n'),
  'comparison.ts':'export function positive(value: number) { return value > 0; }\n',
  'test.mjs':[
    "import {test} from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import {member,call,defaults,chain,equivalent,equivalentDefault} from './optional.ts';",
    "import {positive} from './comparison.ts';",
    "test('optional', () => {",
    '  assert.deepEqual([member(null),member({field:7})],[undefined,7]);',
    '  assert.deepEqual([call(undefined),call(() => 7)],[undefined,7]);',
    '  assert.deepEqual([defaults(null),defaults(0),defaults(7)],[7,0,7]);',
    '  assert.deepEqual([chain(null),chain({}),chain({child:{field:7}})],[undefined,undefined,7]);',
    '  assert.equal(equivalent(),7); assert.equal(equivalentDefault(),7);',
    '  assert.deepEqual([positive(-1),positive(0),positive(1)],[false,false,true]);',
    '});',
    '',
  ].join('\n'),
};
for (const [path,source] of Object.entries(originals)) writeFileSync(join(project,path),source);
const oldFamilies = ['comparison','logical','arithmetic','boolean','statement'];
const allFamilies = [...oldFamilies,'optional'];
const config = {source:{include:['*.ts']},capture:Object.keys(originals),setups:[{
  name:'node',runner:'node',cwd:'.',timeoutMs:10000,
  typecheck:[process.execPath,join(repo,'benchmarks/node_modules/typescript/bin/tsc'),'--ignoreConfig','--strict','--noEmit','--skipLibCheck','optional.ts','comparison.ts'],
  test:[process.execPath,'--test','--test-concurrency=1','--test-reporter={seshatReporter}','test.mjs'],
  coverage:{command:[process.execPath,join(here,'collect-node.mjs'),'test.mjs'],report:'coverage/final.json'},
}]};
// Exercise the npm launcher against the same binary in an installed package layout.
// No pack/install step or registry download is needed for this fixed fixture.
const launcherRoot = join(work,'installed/node_modules/@binary-balance/seshat');
const targetKey = process.platform + '-' + process.arch;
const payloadRoot = join(work,'installed/node_modules/@binary-balance/seshat-' + targetKey);
mkdirSync(join(launcherRoot,'bin'),{recursive:true});
mkdirSync(join(payloadRoot,'bin'),{recursive:true});
const version = packageVersion(readFileSync(join(repo,'crates/seshat/Cargo.toml'),'utf8'));
writeFileSync(join(launcherRoot,'package.json'),JSON.stringify({name:'@binary-balance/seshat',version}));
copyFileSync(join(repo,'packages/seshat/bin/seshat.mjs'),join(launcherRoot,'bin/seshat.mjs'));
writeFileSync(join(payloadRoot,'package.json'),JSON.stringify({name:'@binary-balance/seshat-' + targetKey,version}));
copyFileSync(binary,join(payloadRoot,'bin/seshat' + suffix));
const launcher = join(launcherRoot,'bin/seshat.mjs');
const reports = [];
function assess(name, operators, switching = false, workers = 1, status = 0, route = 'native') {
  const input = {...config,workers};
  if (operators !== undefined) input.mutationOperators = operators;
  const path = join(project,'seshat.json');
  writeFileSync(path,JSON.stringify(input));
  const args = ['mutate','--config',path,'--scratch',scratch,'--json','--no-progress'];
  if (switching) args.push('--experimental-switching');
  const started = performance.now();
  const report = route === 'launcher' ? invoke(process.execPath,[launcher,...args],status) : invoke(binary,args,status);
  const invocationWallMs = performance.now() - started;
  const result = report.result.mutation;
  assert.equal(report.complete,status === 0,JSON.stringify(report));
  const enabled = operators ?? allFamilies;
  assert.deepEqual(result.enabledOperators,enabled);
  const planned = (enabled.includes('optional') ? 7 : 0) + (enabled.includes('comparison') ? 2 : 0);
  assert.equal(result.planned,planned);
  assert.equal(result.completed,planned);
  assert.equal(result.notRun,0);
  assert.equal(result.jobsAttempted,planned);
  assert.equal(report.result.pseudoTesting.planned,7);
  for (const key of ['planned','completed','jobsAttempted']) {
    assert.equal(result.perOperator.reduce((sum,row) => sum + row[key],0),result[key]);
  }
  assert(result.perOperator.every(row => row.executionMs >= 0));
  if (enabled.includes('optional')) {
    assert.equal(result.perOperator.find(row => row.operator === '?.').planned,5);
    assert.equal(result.perOperator.find(row => row.operator === '??').planned,2);
  }
  if (status === 0) {
    assert.equal(result.unresolved,0);
    assert.equal(result.survived,enabled.includes('optional') ? 2 : 0);
    assert.equal(result.killed,planned - result.survived);
    assert.equal(result.score,planned === 0 ? null : result.killed / planned * 100);
  } else {
    assert.equal(result.unresolved,1);
    assert.equal(result.outcomes[0].verdict,'timed-out');
    assert.ok(result.outcomes.slice(1).every(row => ['killed','survived'].includes(row.verdict)));
    assert.equal(result.score,null);
    assert.equal(result.outcomes.filter(row => row.kind === 'optional' && row.verdict === 'timed-out').length,1);
  }
  assert.deepEqual(readdirSync(scratch),[]);
  for (const [path,source] of Object.entries(originals)) assert.equal(readFileSync(join(project,path),'utf8'),source);
  reports.push({name,route,invocationWallMs,totalWallMs:report.timings.wallMs,totalJobsAttempted:report.result.jobsAttempted,...result});
  console.log(name + ': ' + planned + ' planned, ' + result.killed + ' killed, ' + result.survived + ' survived');
  return result;
}
const stable = result => result.outcomes.map(({id,localId,path,offset,kind,original,replacement,verdict}) =>
  ({id,localId,path,offset,kind,original,replacement,verdict}));
const replaced = assess('default-replacement');
assert.deepEqual(stable(assess('default-switching',undefined,true)),stable(replaced));
const isolated = assess('optional-only',['optional']);
assert.deepEqual(stable(assess('optional-only-parallel',['optional'],false,2)),stable(isolated));
assert.deepEqual(stable(assess('optional-switching-parallel',['optional'],true,2)),stable(isolated));
assess('no-operators',[]);
const samples = Number(process.env.SESHAT_OPERATOR_SAMPLES ?? 1);
assert(Number.isInteger(samples) && samples >= 1 && samples <= 7);
// Warm each route and strategy, then reverse strategy/selection order per sample.
for (const route of ['native','launcher']) {
  for (const switching of [false,true]) assess('warmup-' + route + '-' + switching,undefined,switching,1,0,route);
  for (let sample = 0; sample < samples; sample++) {
    for (const switching of sample % 2 === 0 ? [false,true] : [true,false]) {
      for (const enabled of sample % 2 === 0 ? [false,true] : [true,false]) {
        assess('cost-' + route + '-' + (enabled ? 'on' : 'off') + '-' + (switching ? 'switch' : 'replace') + '-' + sample,
          enabled ? undefined : oldFamilies,switching,1,0,route);
      }
    }
  }
  for (let sample = 0; sample < samples; sample++) {
    for (const strategy of ['switch','replace']) {
      const off = reports.find(row => row.name === 'cost-' + route + '-off-' + strategy + '-' + sample);
      const on = reports.find(row => row.name === 'cost-' + route + '-on-' + strategy + '-' + sample);
      assert.equal(on.totalJobsAttempted - off.totalJobsAttempted,7);
    }
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
assess('job-timeout',['optional'],false,1,2);
assess('switch-job-timeout',['optional'],true,1,2);
config.setups[0].test = originalTestCommand;
// A successful process without the runner receipt is unresolved, never a survivor.
config.setups[0].test = [process.execPath,'-e',`
  if (process.env.SESHAT_EXECUTION_ID.includes('-mutant-')) process.exit(0);
  const child = require('node:child_process').spawnSync(process.execPath,
    ['--test','--test-concurrency=1','--test-reporter=' + process.env.SESHAT_NODE_REPORTER,'test.mjs'],{stdio:'inherit'});
  process.exit(child.status ?? 2);
`];
for (const switching of [false,true]) {
  const path = join(project,'seshat.json');
  writeFileSync(path,JSON.stringify({...config,mutationOperators:['optional']}));
  const args = ['mutate','--config',path,'--scratch',scratch,'--json','--no-progress'];
  if (switching) args.push('--experimental-switching');
  const report = invoke(binary,args,2);
  const result = report.result.mutation;
  assert.equal(report.complete,false);
  assert.equal(result.score,null);
  assert.equal(result.killed,0); assert.equal(result.survived,0);
  assert.equal(result.unresolved,7);
  assert.deepEqual(readdirSync(scratch),[]);
  for (const [path,source] of Object.entries(originals)) assert.equal(readFileSync(join(project,path),'utf8'),source);
  reports.push({name:'missing-receipt-' + (switching ? 'switch' : 'replace'),...result});
}
config.setups[0].test = originalTestCommand;
// Preparation rejects unsupported references after passing original baselines.
const excluded = 'export function remove(value: {field?:number} | null) { return delete value?.field; }\n';
writeFileSync(join(project,'excluded.ts'),excluded);
const rejectedConfig = {...config,capture:[...config.capture,'excluded.ts'],mutationOperators:['optional']};
const rejectedPath = join(project,'seshat.json');
writeFileSync(rejectedPath,JSON.stringify(rejectedConfig));
const rejected = invoke(binary,['mutate','--config',rejectedPath,'--scratch',scratch,'--json','--no-progress','--experimental-switching'],2);
assert.equal(rejected.complete,false);
assert.equal(rejected.result.mutation.score,null);
assert.match(rejected.result.mutation.error,/optional chains/);
assert.equal(rejected.result.mutation.jobsAttempted,0);
assert.equal(rejected.result.mutation.planned,8);
assert.deepEqual(readdirSync(scratch),[]);
assert.equal(readFileSync(join(project,'excluded.ts'),'utf8'),excluded);
for (const [path,source] of Object.entries(originals)) assert.equal(readFileSync(join(project,path),'utf8'),source);
reports.push({name:'unsupported-switching-reference',...rejected.result.mutation});

for (const report of reports) {
  for (const group of report.perOperator) {
    const sum = report.outcomes.filter(row => row.original === group.operator)
      .reduce((total,row) => total + (row.executionMs ?? 0),0);
    assert(Math.abs(sum - group.executionMs) < 0.000001,'per-operator timing total');
  }
}
const output = resolve(process.env.SESHAT_PROOF_OUTPUT ?? join(work,'optional.json'));
const evidence = {
  environment:{node:process.version,platform:process.platform,arch:process.arch,typescript:ts.version},
  binaries:{cliSha256:digest(readFileSync(binary)),proofSha256:digest(readFileSync(proof)),launcherSha256:digest(readFileSync(launcher))},
  semantics,semanticMutants,switchingExclusions:unsupported.map(([name]) => name),
  fixtureHashes:Object.fromEntries(Object.entries(originals).map(([path,source]) => [path,digest(source)])),
  equivalentMutants:{optional:{count:2,planned:7},
    basis:'equivalent() always creates a non-nullish object; equivalentDefault() always uses 7. Both token changes preserve returned values and effects. Neither function reflects on source. These closed examples do not estimate equivalence elsewhere.'},
  samples,reports,
};
mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify(evidence,(_,value) => typeof value === 'string'
  ? value.replaceAll(work,'<work>').replaceAll(repo,'<repo>').replaceAll(process.execPath,'<node>')
    .replaceAll(work.replaceAll('\\','/'),'<work>').replaceAll(repo.replaceAll('\\','/'),'<repo>') : value,2) + '\n');
console.log('Optional operator proof passed. Results: ' + output);
