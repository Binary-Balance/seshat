// Minimal native-executor regression: a comparison changes module initialisation.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {runProcess} from './process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const binary = resolve(process.env.SESHAT_PROOF_BINARY ?? join(repo, 'crates/seshat/target/release/seshat-proofs'));
const work = mkdtempSync(join(repo, 'work/assurance-proofs/node-load-space 🎸-'));
const project = join(work, 'input');
mkdirSync(project);
const source = "export const ready = 1 === 1; if (!ready) throw new Error('application guard');\n";
const plain = 'export const ready = 1 === 1;\n';
const test = "import {test} from 'node:test';import {ready} from './subject.ts';test('ready',()=>{if(!ready)throw Error('not ready')});\n";
writeFileSync(join(project, 'package.json'), '{"type":"module"}');
const config = {template:project,scratch:work,source:'subject.ts',runner:'node',timeoutMs:5000,
  test:[process.execPath,'--test',`--test-reporter=${pathToFileURL(join(here,'node-reporter.mjs')).href}`,'@ROOT@/check.mjs']};
const observerAvailable = ['24.20.0', '24.21.0'].includes(process.versions.node);
const importVerdict = observerAvailable ? 'killed' : 'execution-error';
const results = {};
async function execute(name, app, tests, expected, other) {
  writeFileSync(join(project, 'subject.ts'), app);
  writeFileSync(join(project, 'check.mjs'), tests);
  const input = structuredClone(config);
  if (other) { writeFileSync(join(project, 'other.mjs'), other); input.test.push('@ROOT@/other.mjs'); }
  const path = join(work, 'config.json');
  writeFileSync(path, JSON.stringify(input));
  const run = await runProcess(binary, ['execute',path,'replace'], repo);
  assert.equal(run.timedOut, false);
  assert.equal(run.overflow, false);
  const result = JSON.parse(run.stdout);
  results[name] = result;
  writeFileSync(join(work, 'result.json'), JSON.stringify(results,null,2));
  if (process.env.SESHAT_PROOF_OUTPUT) writeFileSync(process.env.SESHAT_PROOF_OUTPUT, JSON.stringify(results,null,2));
  assert.equal(result.baseline.state, 'passed', JSON.stringify(result));
  assert.equal(readFileSync(join(project, 'subject.ts'),'utf8'), app);
  assert.ok(!readdirSync(work).some(name=>name.startsWith('session-')));
  console.log(`${name}: ${result.outcomes[0].verdict}`);
  assert.equal(result.outcomes[0].verdict, expected, JSON.stringify(result));
  assert.equal(result.score, expected === 'killed' ? 100 : null);
  return result;
}
const guard = await execute('module-guard', source, test, importVerdict);
assert.equal(guard.outcomes[0].evidence.report.moduleFailures.length, observerAvailable ? 1 : 0);
for (const [name, body] of [
  ['catch-guard', "try { if (!ready) throw 0; } catch { throw new Error('catch guard'); }"],
  ['finally-guard', "try {} catch {} finally { if (!ready) throw new Error('finally guard'); }"],
  ['try-finally-guard', "try { if (!ready) throw new Error('no catch'); } finally {}"],
  ['nested-try-finally', "try { try { if (!ready) throw new Error('nested no catch'); } finally {} } finally {}"],
]) {
  const result = await execute(name, plain + body, test, importVerdict);
  assert.equal(result.outcomes[0].evidence.report.moduleFailures.length, observerAvailable ? 1 : 0);
}
const nested = "import {test} from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {ready} from './subject.ts';test('nested child cwd',()=>{if(!ready)throw Error('not ready');const child=spawnSync(process.execPath,['-e','if(!process.env.SESHAT_LOAD_CONTEXT)process.exit(1)'],{cwd:'..',env:process.env,encoding:'utf8'});assert.equal(child.status,0,child.stderr);});";
await execute('nested-child-cwd', source, nested, importVerdict);
await execute('unicode-crlf', 'const label="🎸";\r\n'+source.replace('\n','\r\n'), test, importVerdict);
const called = "import {test} from 'node:test';import {load} from './subject.ts';load();test('pass',()=>{});";
await execute('called-guard', plain+"export function load(){if(!ready)throw new Error('called guard');}", called, importVerdict);
for (const [name, declaration] of [
  ['function-in-try', "function load() { if (!ready) throw new Error('later call'); } outside = load;"],
  ['arrow-in-try', "outside = () => { if (!ready) throw new Error('later arrow'); };"],
]) {
  const result = await execute(name, plain + `let outside; try { ${declaration} } catch {} export {outside as load};`, called, importVerdict);
  assert.equal(result.outcomes[0].evidence.report.moduleFailures.length, observerAvailable ? 1 : 0);
}
await execute('custom-error', plain+"class AppError extends Error {} export function load(){if(!ready)throw new AppError('custom guard');}", called, importVerdict);
const setup = "import {test} from 'node:test';import {ready} from './subject.ts';if(!ready)throw new Error('setup failure');test('pass',()=>{});";
await execute('setup-throw', plain, setup, 'execution-error');
await execute('process-exit', plain, setup.replace("throw new Error('setup failure')", 'process.exit(1)'), 'execution-error');
await execute('missing-module', plain, setup.replace("throw new Error('setup failure')", "await import('./missing.mjs')"), 'execution-error');
await execute('reused-error', plain+"export const failure=new Error('created in application, thrown by setup');", setup.replace('{ready}', '{ready,failure}').replace("new Error('setup failure')", 'failure'), 'execution-error');
await execute('caught-error', plain+"export let failure;try{throw new Error('caught in application')}catch(error){failure=error;}", setup.replace('{ready}', '{ready,failure}').replace("new Error('setup failure')", 'failure'), 'execution-error');
for (const [name, guarded] of [
  ['outer-catches-catch', "try { throw 0; } catch { throw new Error('outer catch'); }"],
  ['outer-catches-finally', "try {} finally { throw new Error('outer catch'); }"],
  ['outer-catches-static', "class C { static { throw new Error('caught static'); } }"],
  ['function-has-catch', "function load() { try { throw new Error('inner catch'); } catch(error) { failure = error; } } load();"],
]) {
  await execute(name, plain + `export let failure; try { ${guarded} } catch(error) { failure = error; }`,
    setup.replace('{ready}', '{ready,failure}').replace("new Error('setup failure')", 'failure'), 'execution-error');
}
await execute('background-error', plain, setup.replace("throw new Error('setup failure')", "setImmediate(()=>{throw new Error('background')})"), 'execution-error');
await execute('custom-stack', 'Error.prepareStackTrace=()=>"custom stack";'+source, test, 'execution-error');
await execute('primitive-throw', source.replace("new Error('application guard')", "'application guard'"), test, 'execution-error');
const mixed = await execute('mixed-files', source, test, 'execution-error', "import {test} from 'node:test';import {readFileSync} from 'node:fs';if(readFileSync(new URL('./subject.ts',import.meta.url),'utf8').includes('!=='))throw new Error('unrelated setup');test('pass',()=>{});");
assert.equal(mixed.outcomes[0].evidence.report.failed, observerAvailable ? 1 : 0);
assert.equal(mixed.outcomes[0].evidence.report.errors, observerAvailable ? 1 : 2);
// Synthetic version only: exercise the observer guard, not a claimed future runtime.
// --require runs before the observer's --import in each test worker.
writeFileSync(join(project, 'runtime.cjs'), "Object.defineProperty(process.versions, 'node', {value:'24.22.0'});");
config.test.splice(1, 0, '--require', '@ROOT@/runtime.cjs');
const fallback = await execute('unverified-observer-import', source, test, 'execution-error');
assert.deepEqual(fallback.outcomes[0].evidence.report.moduleFailures, []);
assert.equal(fallback.outcomes[0].evidence.report.node, '24.22.0');
await execute('unverified-observer-assertion', plain, test, 'killed');
console.log(`Node load-failure checks passed: ${Object.keys(results).length} scenarios. Evidence: ${join(work,'result.json')}`);
