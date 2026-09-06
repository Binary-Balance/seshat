// Minimal native-executor regression: a comparison changes module initialisation.
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runProcess} from './process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const work = mkdtempSync(join(repo, 'work/assurance-proofs/node-load-space 🎸-'));
const project = join(work, 'input');
mkdirSync(project);
const source = "export const ready = 1 === 1; if (!ready) throw new Error('application guard');\n";
const plain = 'export const ready = 1 === 1;\n';
const test = "import {test} from 'node:test';import {ready} from './subject.ts';test('ready',()=>{if(!ready)throw Error('not ready')});\n";
writeFileSync(join(project, 'package.json'), '{"type":"module"}');
const config = {template:project,scratch:work,source:'subject.ts',runner:'node',timeoutMs:5000,
  test:[process.execPath,'--test',`--test-reporter=${join(here,'node-reporter.mjs')}`,'@ROOT@/check.mjs']};
const results = {};
async function execute(name, app, tests, expected, other) {
  writeFileSync(join(project, 'subject.ts'), app);
  writeFileSync(join(project, 'check.mjs'), tests);
  const input = structuredClone(config);
  if (other) { writeFileSync(join(project, 'other.mjs'), other); input.test.push('@ROOT@/other.mjs'); }
  const path = join(work, 'config.json');
  writeFileSync(path, JSON.stringify(input));
  const run = await runProcess(join(repo, 'benchmarks/rust/target/release/seshat-proofs'), ['execute',path,'replace'], repo);
  assert.equal(run.timedOut, false);
  assert.equal(run.overflow, false);
  const result = JSON.parse(run.stdout);
  results[name] = result;
  writeFileSync(join(work, 'result.json'), JSON.stringify(results,null,2));
  assert.equal(result.baseline.state, 'passed', JSON.stringify(result));
  assert.equal(readFileSync(join(project, 'subject.ts'),'utf8'), app);
  assert.ok(!readdirSync(work).some(name=>name.startsWith('session-')));
  console.log(`${name}: ${result.outcomes[0].verdict}`);
  assert.equal(result.outcomes[0].verdict, expected, JSON.stringify(result));
  assert.equal(result.score, expected === 'killed' ? 100 : null);
  return result;
}
const guard = await execute('module-guard', source, test, 'killed');
assert.equal(guard.outcomes[0].evidence.report.moduleFailures.length, 1);
await execute('unicode-crlf', 'const label="🎸";\r\n'+source.replace('\n','\r\n'), test, 'killed');
const called = "import {test} from 'node:test';import {load} from './subject.ts';load();test('pass',()=>{});";
await execute('called-guard', plain+"export function load(){if(!ready)throw new Error('called guard');}", called, 'killed');
await execute('custom-error', plain+"class AppError extends Error {} export function load(){if(!ready)throw new AppError('custom guard');}", called, 'killed');
const setup = "import {test} from 'node:test';import {ready} from './subject.ts';if(!ready)throw new Error('setup failure');test('pass',()=>{});";
await execute('setup-throw', plain, setup, 'execution-error');
await execute('process-exit', plain, setup.replace("throw new Error('setup failure')", 'process.exit(1)'), 'execution-error');
await execute('missing-module', plain, setup.replace("throw new Error('setup failure')", "await import('./missing.mjs')"), 'execution-error');
await execute('reused-error', plain+"export const failure=new Error('created in application, thrown by setup');", setup.replace('{ready}', '{ready,failure}').replace("new Error('setup failure')", 'failure'), 'execution-error');
await execute('caught-error', plain+"export let failure;try{throw new Error('caught in application')}catch(error){failure=error;}", setup.replace('{ready}', '{ready,failure}').replace("new Error('setup failure')", 'failure'), 'execution-error');
await execute('background-error', plain, setup.replace("throw new Error('setup failure')", "setImmediate(()=>{throw new Error('background')})"), 'execution-error');
await execute('custom-stack', 'Error.prepareStackTrace=()=>"custom stack";'+source, test, 'execution-error');
await execute('primitive-throw', source.replace("new Error('application guard')", "'application guard'"), test, 'execution-error');
const mixed = await execute('mixed-files', source, test, 'execution-error', "import {test} from 'node:test';import {readFileSync} from 'node:fs';if(readFileSync(new URL('./subject.ts',import.meta.url),'utf8').includes('!=='))throw new Error('unrelated setup');test('pass',()=>{});");
assert.equal(mixed.outcomes[0].evidence.report.failed, 1);
assert.equal(mixed.outcomes[0].evidence.report.errors, 1);
console.log(`Node load-failure checks passed: ${Object.keys(results).length} scenarios. Evidence: ${join(work,'result.json')}`);
