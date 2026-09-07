// Native combined assessment of the checked-in React, Fastify and Vitest fixture.
import assert from 'node:assert/strict';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runProcess} from './process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const workers = Number(process.env.SESHAT_CHECK_WORKERS ?? 1);
assert.ok(Number.isSafeInteger(workers) && workers > 0, 'SESHAT_CHECK_WORKERS must be a positive integer');
const original = join(here, 'fixtures/vitest');
const expectedScores = {
  'tempo.ts': [[3,5,5,3]],
  'view.tsx': [[1,1,1,1]],
  'server.ts': [[1,3,3,1],[1,1,1,1]],
};
const environment = {node:process.version, tools:Object.fromEntries(
  ['vitest','@vitest/coverage-istanbul','fastify','@sinclair/typebox','react','react-dom'].map(name =>
    [name, JSON.parse(readFileSync(join(here,'node_modules',name,'package.json'),'utf8')).version]))};
const work = mkdtempSync(join(repo, 'work/assurance-proofs/vitest-check-'));
const project = join(work, 'input 🎸');
const scratch = join(work, 'scratch');
mkdirSync(project); mkdirSync(scratch);
const names = ['package.json','tsconfig.json','tempo.ts','view.tsx','server.ts','stack.test.tsx'];
const inputs = Object.fromEntries(names.map(name => [name, readFileSync(join(original, name), 'utf8')]));
for (const [name, source] of Object.entries(inputs)) writeFileSync(join(project, name), source);
// Native capture rejects dependency links that escape the project.
cpSync(join(here, 'node_modules'), join(project, 'node_modules'), {recursive:true, verbatimSymlinks:true});
if (!existsSync(join(project, 'node_modules/typescript'))) cpSync(join(repo, 'benchmarks/node_modules/typescript'), join(project, 'node_modules/typescript'), {recursive:true});
for (const [name, version] of Object.entries(environment.tools)) assert.equal(JSON.parse(readFileSync(join(project, 'node_modules', name, 'package.json'), 'utf8')).version, version);
writeFileSync(join(project, 'vitest.config.mjs'), `export default {cacheDir:'.vite',test:{runner:process.env.SESHAT_VITEST_RUNNER,include:['stack.test.tsx'],coverage:{provider:'istanbul',include:['tempo.ts','view.tsx','server.ts'],reporter:['json'],reportsDirectory:'coverage'}}};\n`);
const args = [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.mjs',
  '--maxWorkers=1', '--no-file-parallelism', '--maxConcurrency=1', '--reporter=default', '--reporter={seshatReporter}'];
const config = {workers, source:{include:['tempo.ts','view.tsx','server.ts']},
  capture:[...names, 'vitest.config.mjs', 'node_modules'], setups:[{name:'stack',runner:'vitest',cwd:'.',timeoutMs:30000,
    typecheck:[process.execPath,'node_modules/typescript/bin/tsc','--project','tsconfig.json'],
    test:args, coverage:{command:[...args,'--coverage'],report:'coverage/coverage-final.json'}}]};
const selected = process.env.SESHAT_VITEST_CHECK_CASES?.split(',');
const wanted = name => !selected || selected.includes(name);
const results = {representativeOnly:true, environment, runs:{}};
const save = () => writeFileSync(join(work, 'result.json'), JSON.stringify(results,null,2)+'\n');
async function check(name, input) {
  const path = join(project,'seshat.json'); writeFileSync(path,JSON.stringify(input));
  const run = await runProcess(join(repo,'benchmarks/rust/target/release/seshat-proofs'), ['check',path,scratch], repo, {}, 120000);
  assert.equal(run.timedOut,false); assert.equal(run.overflow,false);
  const result = JSON.parse(run.stdout); results.runs[name]={config:input,result,wallMs:run.ms}; save();
  assert.equal(run.status,result.complete?0:2,run.stderr);
  assert.deepEqual(readdirSync(scratch),[],'Native session must clean up');
  if (result.setups?.[0].coverage.state==='passed' && result.mutation?.planned > 0) {
    assert.equal(result.mutation.workersUsed,Math.min(workers,result.mutation.planned));
    assert.equal(result.mutation.workerBaselineJobs,result.mutation.workersUsed-1);
    assert.ok(result.mutation.workerBaselines.every(b=>b.state==='passed'));
    const receipts=[...result.mutation.workerBaselines,...result.mutation.outcomes.flatMap(m=>m.setups)].filter(s=>s.report).map(s=>s.report.executionId);
    assert.equal(new Set(receipts).size,receipts.length,'Workers reused a receipt identity');
  }
  for (const [name, source] of Object.entries(inputs)) assert.equal(readFileSync(join(original,name),'utf8'),source);
  console.log(`${name}: complete=${result.complete}, score=${result.mutation?.score}, ${Math.round(run.ms)}ms`);
  return result;
}
for (const name of ['stack','stack-repeat']) {
  if (name==='stack-repeat' && !selected?.includes(name)) continue;
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
if (selected) assert.deepEqual(Object.keys(results.runs).sort(),[...selected].sort());
for (const [name,source] of Object.entries(inputs)) {
  assert.equal(readFileSync(join(original,name),'utf8'),source);
  assert.equal(readFileSync(join(project,name),'utf8'),source);
}
results.originalsPreserved=true; save();
console.log(`Vitest native evidence: ${join(work,'result.json')}`);
