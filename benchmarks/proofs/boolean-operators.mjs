// Fixed boolean semantics and matched CLI cost on disposable fixtures.
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
const work = mkdtempSync(join(repo, 'work/assurance-proofs/boolean-'));
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
// Preserve distinctions that ordinary JSON loses when ! removal exposes an operand value.
const encode = value => JSON.stringify(value, (_, value) => {
  if (value === undefined) return {undefined:true};
  if (typeof value === 'bigint') return {bigint:String(value)};
  if (typeof value === 'symbol') return {symbol:String(value)};
  if (typeof value === 'number' && Number.isNaN(value)) return {number:'NaN'};
  if (Object.is(value, -0)) return {number:'-0'};
  return value;
});
async function evaluate(source, active) {
  const compiled = ts.transpileModule(source, {compilerOptions:{
    target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS,
    moduleDetection:ts.ModuleDetectionKind.Legacy, ignoreDeprecations:'6.0',
    jsx:ts.JsxEmit.React, jsxFactory:'h',
  }, reportDiagnostics:true});
  assert.deepEqual(compiled.diagnostics, []);
  try {
    return {value:encode(await runInNewContext(compiled.outputText,
      {process:{env:active === undefined ? {} : {SESHAT_MUTANT_ID:String(active)}}}, {timeout:1000}))};
  } catch (error) {
    return {error:error.name + ': ' + error.message};
  }
}
const cases = [
  ['literals', '[true, false];', [true,false], [[false,false],[true,true]]],
  ['truthiness', "function negate(value: unknown) { return !value; } [negate(0),negate(-0),negate(0n),negate(''),negate(null),negate(undefined),negate(NaN),negate(1),negate(1n),negate('x'),negate({}),negate([]),negate(Symbol('x'))];",
    [true,true,true,true,true,true,true,false,false,false,false,false,false],
    [[0,-0,0n,'',null,undefined,NaN,1,1n,'x',{},[],Symbol('x')]]],
  ['nested-negation', 'const value = 0; [!!value, !!!value];', [false,true],
    [[true,true],[true,true],[false,false],[false,false],[false,false]]],
  ['negated-literal', '!true;', false, [true,true]],
  ['conditional-grouping', 'const a = 1, b = 0; !(a ? b : a);', true, [0]],
  ['if-condition', "let result = 'off'; if (!0) result = 'on'; result;", 'on', ['off']],
  ['statement-negation', 'const a = {x:0,y:0}; a.x = 1\n!a.y;', true, [0]],
  ['statement-literal', 'const a = {x:0}; a.x = 1\ntrue;', true, [false]],
  ['statement-nested-logical', 'const a = {x:0}; a.x = 1\n!0 && 7;', 7, [0]],
  ['if-body', 'if (0) !missing; 7;', 7, [7]],
  ['loop-body', 'let calls = 0; while (calls < 1) !calls++; calls;', 1, [1]],
  ['switch-statement', 'let value = 0; switch (1) { case 1: value = 7\n!value; break; } value;', 7, [7]],
  ['directive-statement', "'use strict'\n!0;", true, [0]],
  ['nested-function-statement', '!function() { let value = 0; value = 1\n!value; }();', true, [undefined,true]],
  ['object-expression', '!{field:1};', false, [{field:1}]],
  ['single-evaluation', 'let calls = 0; function next() { calls += 1; return calls; } const result = !next(); [result,calls];', [false,1], [[1,1]]],
  ['evaluation-order', "const log: string[] = []; function next(name: string, value: number) { log.push(name); return value; } const result = !(next('left',7),next('right',0)); [result,log];",
    [true,['left','right']], [[0,['left','right']]]],
  ['nested-function', 'function outer(value: unknown) { function inner(value: unknown) { return !value; } return inner(value); } [outer(0),outer(7)];',
    [true,false], [[0,7]]],
  ['parameter-default', 'function flag(value: boolean = true) { return value; } [flag(),flag(false)];',
    [true,false], [[false,false],[true,true]]],
  ['class-field', 'class Flags { value = true; } new Flags().value;', true, [false]],
  ['no-object-coercion', "const log: string[] = []; const value = {valueOf() { log.push('coerce'); return 1; }}; const result = !value; [typeof result,log];",
    ['boolean',[]], [['object',[]]]],
  ['receiver-getter', "const log: string[] = []; const object = {get method() { log.push('get'); return function() { log.push(this === object ? 'bound' : 'lost'); return 7; }; }}; const result = !object.method(); [result,log];",
    [false,['get','bound']], [[7,['get','bound']]]],
  ['direct-eval', "function run() { let value = 0; const result = !eval('value = 7'); return [result,value]; } run();", [false,7], [[7,7]]],
  ['await', "async function run() { const result = !await Promise.resolve(0); return [result,'after']; } run();", [true,'after'], [[0,'after']]],
  ['yield', 'function* run() { return !(yield 7); } const iterator = run(); [iterator.next(),iterator.next(0)];',
    [{value:7,done:false},{value:true,done:true}], [[{value:7,done:false},{value:0,done:true}]]],
  ['literal-short-circuit', 'let calls = 0; function next() { calls += 1; return 7; } const result = false && next(); [result,calls];',
    [false,0], [[7,1]]],
  ['unicode-trivia', '/* 🎸 */ !\uFEFF/* operand */\n(0);', true, [0]],
  ['type-literals', 'type Flag = true | false; interface Flags {on:true; off:false} const value: true | false = true; value;',
    true, [false]],
  ['non-null', 'const value = 7 as number | null; value!;', 7, []],
  ['property-keys', 'const object = {true:1,false:2}; [object.true,object.false];', [1,2], []],
  ['tsx.tsx', 'function h(tag: any, props: any) { return tag(props); } function Element(props: {enabled:boolean}) { return props.enabled; } <Element enabled={!0}/>;',
    true, [0]],
  ['tsx-bare.tsx', 'function h(tag: any, props: any) { return props; } <input disabled/>;', {disabled:true}, []],
  ['discarded-negation', 'let calls = 0; function next() { calls += 1; return calls; } void !next(); calls;', 1, [1]],
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
  const sites = facts.mutants.filter(row => row.kind === 'boolean');
  assert.equal(sites.length, mutants.length, name);
  invoke(proof, ['prepare',input,prepared]);
  const switched = readFileSync(prepared,'utf8');
  const originalResult = {value:encode(expected)};
  assert.deepEqual(await evaluate(source), originalResult, name + ': original');
  assert.deepEqual(await evaluate(switched), originalResult, name + ': inactive');
  for (const [index, row] of sites.entries()) {
    invoke(proof, ['replace',input,replacement,String(row.id)]);
    const changed = readFileSync(replacement,'utf8');
    assert.notEqual(changed, source, name + ': unchanged mutant');
    const expectedResult = {value:encode(mutants[index])};
    assert.deepEqual(await evaluate(changed), expectedResult, name + ': replacement ' + row.id);
    assert.deepEqual(await evaluate(switched,row.id), expectedResult, name + ': switching ' + row.id);
    semanticMutants++;
  }
  assert.equal(readFileSync(input,'utf8'),source,name + ': source preservation');
  semantics.push({name,sites:sites.length,sourceSha256:digest(source)});
}
const unsupported = [
  ['call-target', "const object = {method() { return this === object; }}; let result; try { result = (!object.method)(); } catch { result = 'caught'; } result;", 'caught', true],
  ['optional-call-target', "const object = {method() { return this === object; }}; let result; try { result = (!object.method)?.(); } catch { result = 'caught'; } result;", 'caught', true],
  ['tag-target', "const object = {tag() { return this === object; }}; let result; try { result = (!object.tag)\`text\`; } catch { result = 'caught'; } result;", 'caught', true],
  ['eval-target', "function run() { const value = 7; try { return (!eval)('value'); } catch { return 'caught'; } } run();", 'caught', 7],
  ['typeof-reference', "declare const missing: unknown; let result; try { result = typeof (!missing); } catch { result = 'caught'; } result;", 'caught', 'undefined'],
  ['delete-reference', "const log: string[] = []; const object = {get field() { log.push('get'); return 7; }}; const result = delete (!object.field); [result,'field' in object,log];", [true,true,['get']], [true,false,[]]],
];
for (const [name, source, original, mutated] of unsupported) {
  const input = join(work, name + '.ts');
  const prepared = join(work, 'prepared-' + name + '.ts');
  const replacement = join(work, 'replacement-' + name + '.ts');
  writeFileSync(input,source);
  writeFileSync(prepared,'untouched');
  const sites = invoke(proof,['inspect',input]).mutants.filter(row => row.kind === 'boolean');
  assert.equal(sites.length,1,name);
  invoke(proof,['replace',input,replacement,String(sites[0].id)]);
  assert.deepEqual(await evaluate(source),{value:encode(original)},name + ': original');
  assert.deepEqual(await evaluate(readFileSync(replacement,'utf8')),{value:encode(mutated)},name + ': replacement');
  const rejected = invoke(proof,['prepare',input,prepared],2);
  assert.match(rejected.error,/switching/i);
  assert.equal(readFileSync(prepared,'utf8'),'untouched');
  assert.equal(readFileSync(input,'utf8'),source);
}
console.log('Boolean semantics: ' + cases.length + ' cases, ' + semanticMutants + ' active pairs, ' + unsupported.length + ' explicit switching exclusions');

const originals = {
  'package.json':'{"type":"module"}',
  'boolean.ts':[
    'export function enabled() { return true; }',
    'export function disabled() { return false; }',
    'export function negate(value: unknown) { return !value; }',
    'export function ignored(value: unknown) { void !value; return 7; }',
    '',
  ].join('\n'),
  'comparison.ts':'export function positive(value: number) { return value > 0; }\n',
  'test.mjs':[
    "import {test} from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import {enabled,disabled,negate,ignored} from './boolean.ts';",
    "import {positive} from './comparison.ts';",
    "test('operators', () => {",
    '  assert.equal(enabled(),true); assert.equal(disabled(),false);',
    '  assert.deepEqual([negate(0),negate(7)],[true,false]);',
    '  assert.deepEqual([ignored(0),ignored(7)],[7,7]);',
    '  assert.deepEqual([positive(-1),positive(0),positive(1)],[false,false,true]);',
    '});',
    '',
  ].join('\n'),
};
for (const [path,source] of Object.entries(originals)) writeFileSync(join(project,path),source);
const oldFamilies = ['comparison','logical','arithmetic'];
const booleanFamilies = [...oldFamilies,'boolean'];
const allFamilies = [...booleanFamilies,'statement','optional'];
const config = {source:{include:['*.ts']},capture:Object.keys(originals),setups:[{
  name:'node',runner:'node',cwd:'.',timeoutMs:10000,
  typecheck:[process.execPath,join(repo,'benchmarks/node_modules/typescript/bin/tsc'),'--ignoreConfig','--strict','--noEmit','--skipLibCheck','boolean.ts','comparison.ts'],
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
  assert.deepEqual(result.enabledOperators,operators ?? allFamilies);
  const enabled = operators ?? allFamilies;
  const planned = (enabled.includes('boolean') ? 4 : 0) + (enabled.includes('comparison') ? 2 : 0) + (enabled.includes('statement') ? 1 : 0);
  assert.equal(result.planned,planned);
  assert.equal(result.completed,planned);
  assert.equal(result.notRun,0);
  assert.equal(result.jobsAttempted,planned);
  assert.equal(result.survived,Number(enabled.includes('boolean')) + Number(enabled.includes('statement')));
  assert.equal(report.result.pseudoTesting.planned,5);
  for (const key of ['planned','completed','jobsAttempted']) {
    assert.equal(result.perOperator.reduce((sum,row) => sum + row[key],0),result[key]);
  }
  assert(result.perOperator.every(row => row.executionMs >= 0));
  if (status === 0) {
    assert.equal(result.unresolved,0);
    assert.equal(result.killed,planned - result.survived);
    assert.equal(result.score,planned === 0 ? null : result.killed / planned * 100);
  } else {
    assert.equal(result.unresolved,1);
    assert.equal(result.outcomes[0].verdict,'timed-out');
    assert.ok(result.outcomes.slice(1).every(row => ['killed','survived'].includes(row.verdict)));
    assert.equal(result.score,null);
    assert.equal(result.outcomes.filter(row => row.kind === 'boolean' && row.verdict === 'timed-out').length,1);
  }
  assert.deepEqual(readdirSync(scratch),[]);
  for (const [path,source] of Object.entries(originals)) assert.equal(readFileSync(join(project,path),'utf8'),source);
  reports.push({name,totalJobsAttempted:report.result.jobsAttempted,phaseTimings:report.result.phaseTimings,...result});
  console.log(name + ': ' + planned + ' planned, ' + result.killed + ' killed, ' + result.survived + ' survived');
  return result;
}
const stable = result => result.outcomes.map(({id,localId,path,offset,kind,original,replacement,verdict}) =>
  ({id,localId,path,offset,kind,original,replacement,verdict}));
const replacement = assess('default-replacement');
assert.deepEqual(stable(assess('default-switching',undefined,true)),stable(replacement));
const booleanRows = stable(replacement).filter(row => row.kind === 'boolean');
const isolated = assess('boolean-only-parallel',['boolean'],false,2);
const coordinates = rows => rows.map(({id,localId,...row}) => row);
assert.deepEqual(coordinates(stable(isolated)),coordinates(booleanRows));
assert.deepEqual(stable(assess('boolean-switching-parallel',['boolean'],true,2)),stable(isolated));
assess('no-operators',[]);
const samples = Number(process.env.SESHAT_OPERATOR_SAMPLES ?? 1);
assert(Number.isInteger(samples) && samples >= 1 && samples <= 7);
for (let sample = 0; sample < samples; sample++) {
  for (const switching of sample % 2 === 0 ? [false,true] : [true,false]) {
    for (const enabled of sample % 2 === 0 ? [false,true] : [true,false]) {
      assess('cost-' + (enabled ? 'on' : 'off') + '-' + (switching ? 'switch' : 'replace') + '-' + sample,
        enabled ? booleanFamilies : oldFamilies,switching);
    }
  }
}
for (let sample = 0; sample < samples; sample++) {
  for (const strategy of ['switch','replace']) {
    const off = reports.find(row => row.name === 'cost-off-' + strategy + '-' + sample);
    const on = reports.find(row => row.name === 'cost-on-' + strategy + '-' + sample);
    assert.equal(on.totalJobsAttempted - off.totalJobsAttempted,4);
  }
}
const originalTestCommand = config.setups[0].test;
config.setups[0].timeoutMs = 3000;
// Hang only the first operator execution, leaving original and extreme checks unchanged.
config.setups[0].test = [process.execPath,'-e',`
  if (process.env.SESHAT_EXECUTION_ID.includes('-mutant-0-')) setInterval(() => {},1000);
  else {
    const child = require('node:child_process').spawnSync(process.execPath,
      ['--test','--test-concurrency=1','--test-reporter=' + process.env.SESHAT_NODE_REPORTER,'test.mjs'],{stdio:'inherit'});
    process.exit(child.status ?? 2);
  }
`];
assess('job-timeout',['boolean'],false,1,2);
const timeoutCommandSha256 = digest(JSON.stringify(config.setups[0].test));
config.setups[0].test = originalTestCommand;
config.setups[0].timeoutMs = 10000;
const originalBoolean = originals['boolean.ts'];
originals['boolean.ts'] = originalBoolean.replace(
  'export function ignored(value: unknown) { void !value; return 7; }',
  "export function ignored(value: unknown) {\n  try {\n    // @ts-expect-error deliberate caught call of a boolean\n    (!value)();\n  } catch {}\n  return 7;\n}");
writeFileSync(join(project,'boolean.ts'),originals['boolean.ts']);
const rejectedConfig = join(project,'seshat.json');
writeFileSync(rejectedConfig,JSON.stringify({...config,mutationOperators:['boolean']}));
const rejectedRun = invoke(binary,['mutate','--config',rejectedConfig,'--scratch',scratch,'--json','--no-progress','--experimental-switching'],2);
assert.equal(rejectedRun.complete,false);
assert.equal(rejectedRun.result.mutation.score,null);
assert.match(rejectedRun.result.mutation.error,/switching/i);
assert.deepEqual(readdirSync(scratch),[]);
for (const [path,source] of Object.entries(originals)) assert.equal(readFileSync(join(project,path),'utf8'),source);
const rejectedFixtureSha256 = digest(originals['boolean.ts']);
originals['boolean.ts'] = originalBoolean;
writeFileSync(join(project,'boolean.ts'),originalBoolean);
const output = resolve(process.env.SESHAT_PROOF_OUTPUT ?? join(work,'boolean.json'));
const evidence = {
  environment:{node:process.version,platform:process.platform,arch:process.arch,typescript:ts.version},
  binaries:{cliSha256:digest(readFileSync(binary)),proofSha256:digest(readFileSync(proof))},
  semantics,semanticMutants,switchingExclusions:unsupported.map(([name]) => name),
  fixtureHashes:Object.fromEntries(Object.entries(originals).map(([path,source]) => [path,digest(source)])),
  equivalentMutants:{boolean:{count:1,planned:4},
    basis:'The discarded !value in ignored() cannot affect its return value or invoke coercion. This closed fixture does not reflect on function source. Survival is not used to infer equivalence.'},
  timeoutCommandSha256,rejectedFixtureSha256,
  switchingRejection:{complete:rejectedRun.complete,mutation:rejectedRun.result.mutation},
  samples,reports,
};
mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify(evidence,(_,value) => typeof value === 'string'
  ? value.replaceAll(work,'<work>').replaceAll(repo,'<repo>').replaceAll(process.execPath,'<node>')
    .replaceAll(work.replaceAll('\\','/'),'<work>').replaceAll(repo.replaceAll('\\','/'),'<repo>') : value,2) + '\n');
console.log('Boolean operator proof passed. Results: ' + output);
