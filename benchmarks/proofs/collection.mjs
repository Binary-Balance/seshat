// Real Node/Istanbul collection plus incomplete-evidence controls, in disposable input.
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const work = mkdtempSync(join(repo, 'work/assurance-proofs/collection-check-'));
const project = join(work, 'input project 🎸');
const scratch = join(work, 'scratch');
mkdirSync(join(project, 'src'), {recursive:true});
mkdirSync(join(project, 'tests'));
mkdirSync(scratch);
const originals = {
  'package.json':'{"type":"module"}',
  'src/rules.ts':'export function adult(age: number) { if (age >= 18) return true; return false; }\n',
  'src/unused.ts':'export function unused() { return 7; }\n',
  'tests/high.mjs':"import {test} from 'node:test';import assert from 'node:assert/strict';import {adult} from '../src/rules.ts';test('high',()=>assert.equal(adult(20),true));",
  'tests/low.mjs':"import {test} from 'node:test';import assert from 'node:assert/strict';import {adult} from '../src/rules.ts';test('low',()=>assert.equal(adult(10),false));",
  'tests/fail.mjs':"import {test} from 'node:test';test('fails',()=>{throw Error('expected failure');});",
  'tests/noisy.mjs':"import {test} from 'node:test';test('noisy',()=>console.log('x'.repeat(5*1024*1024)));",
  'stale.json':'{"stale":true}',
};
for (const [path, source] of Object.entries(originals)) writeFileSync(join(project, path), source);
const setup = name => ({name, runner:'node', cwd:'.', timeoutMs:10000,
  test:[process.execPath, '--test', '--test-reporter={seshatReporter}', `tests/${name}.mjs`],
  coverage:{command:[process.execPath, join(here, 'collect-node.mjs'), `tests/${name}.mjs`], report:`coverage-${name}/final.json`}});
const config = {source:{include:['src/**/*.ts']}, capture:['package.json', 'src', 'tests', 'stale.json'], setups:[setup('high'), setup('low')]};
const results = {};
function collect(name, change = () => {}) {
  const input = structuredClone(config);
  change(input);
  const configPath = join(project, 'seshat.json');
  writeFileSync(configPath, JSON.stringify(input));
  const child = spawnSync(join(repo, 'benchmarks/rust/target/release/seshat-proofs'), ['collect', configPath, scratch], {encoding:'utf8', timeout:30000});
  assert.ifError(child.error);
  const result = JSON.parse(child.stdout);
  assert.equal(child.status, result.complete === true ? 0 : 2, child.stderr + child.stdout);
  assert.deepEqual(readdirSync(scratch), [], 'owned copy and receipts must be removed');
  for (const [path, source] of Object.entries(originals)) assert.equal(readFileSync(join(project, path), 'utf8'), source, path);
  results[name] = result;
  return result;
}
const good = collect('complete');
assert.equal(good.complete, true, JSON.stringify(good));
assert.equal(good.jobsAttempted, 4);
assert.deepEqual(good.sources.map(s => s.result.functions.map(f => [f.complexity, f.covered, f.total, f.crap])), [[[2,3,3,2]], [[1,0,1,2]]]);
const partial = collect('single-setup', c => c.setups.pop());
assert.equal(partial.complete, true);
assert.equal(partial.sources[0].result.functions[0].covered, 2);
assert.ok(Math.abs(partial.sources[0].result.functions[0].crap - (2 + 4/27)) < 1e-10);

const node = code => [process.execPath, '-e', code];
const afterCoverage = code => node(`const run=require('child_process').spawnSync(process.execPath,${JSON.stringify([join(here, 'collect-node.mjs'), 'tests/high.mjs'])},{stdio:'inherit'});if(run.status!==0)process.exit(2);const fs=require('fs'),path=process.env.SESHAT_COVERAGE_REPORT;${code}`);
for (const [name, change, phase, expected] of [
  ['missing-receipt', c => c.setups[0].test = node(''), 'baseline', 'execution-error'],
  ['failing-test', c => c.setups[0].test = [process.execPath, '--test', '--test-reporter={seshatReporter}', 'tests/fail.mjs'], 'baseline', 'failed'],
  ['stale-report', c => {c.setups[0].coverage.command = c.setups[0].test; c.setups[0].coverage.report = 'stale.json';}, 'coverage', 'execution-error'],
  ['source-destination', c => c.setups[0].coverage.report = 'src/rules.ts', 'coverage', 'execution-error'],
  ['changed-source', c => c.setups[0].test = node("require('fs').writeFileSync('src/rules.ts','changed')"), 'baseline', 'execution-error'],
  ['replayed-receipt', c => c.setups[0].test = node("require('fs').writeFileSync(process.env.SESHAT_RECEIPT,JSON.stringify({version:1,executionId:'old',node:process.versions.node,complete:true,passed:1,failed:0,errors:0}))"), 'baseline', 'execution-error'],
  ['timeout', c => {c.setups[0].timeoutMs = 100; c.setups[0].test = node('setInterval(()=>{},1000)');}, 'baseline', 'timed-out'],
  ['overflow', c => c.setups[0].test = node("process.stdout.write('x'.repeat(5*1024*1024))"), 'baseline', 'execution-error'],
  ['test-log-overflow', c => c.setups[0].test = [process.execPath, '--test', '--test-reporter={seshatReporter}', 'tests/noisy.mjs'], 'baseline', 'execution-error'],
  ['malformed-report', c => c.setups[0].coverage.command = afterCoverage("fs.writeFileSync(path,'{')"), 'coverage', 'execution-error'],
  ['outside-identity', c => c.setups[0].coverage.command = afterCoverage("fs.writeFileSync(path,JSON.stringify({'/outside.ts':{path:'/outside.ts'}}))"), 'coverage', 'execution-error'],
  ['linked-report', c => c.setups[0].coverage.command = afterCoverage("fs.unlinkSync(path);fs.symlinkSync('../stale.json',path)"), 'coverage', 'execution-error'],
  ['hardlinked-report', c => c.setups[0].coverage.command = afterCoverage("fs.unlinkSync(path);fs.linkSync('stale.json',path)"), 'coverage', 'execution-error'],
]) {
  const result = collect(name, change);
  assert.equal(result.complete, false, name);
  assert.equal(result.setups[0][phase].state, expected, JSON.stringify(result));
  assert.equal(result.setups[1].baseline.state, 'not-run');
}
assert.match(results['changed-source'].setups[0].baseline.sourceError, /source changed/);
assert.equal(results.timeout.setups[0].baseline.timedOut, true);
assert.equal(results.overflow.setups[0].baseline.overflow, true);
assert.equal(results['test-log-overflow'].setups[0].baseline.overflow, true);
assert.match(results['replayed-receipt'].setups[0].baseline.evidenceError, /execution identity/);
assert.match(results['stale-report'].setups[0].coverage.coverageError, /stale\.json/);
assert.equal(results['malformed-report'].setups[0].coverage.report.complete, true);
const missing = collect('missing-source', c => c.setups[0].coverage.command = afterCoverage("fs.writeFileSync(path,'{}')"));
// The second setup still covers both selected files; a missing file in one setup
// does not discard valid coverage collected by another setup.
assert.equal(missing.complete, true);
const absent = collect('missing-all-source', c => {c.setups.pop();c.setups[0].coverage.command = afterCoverage("fs.writeFileSync(path,'{}')");});
assert.equal(absent.complete, false);
const later = collect('later-failure', c => c.setups[1].test = node(''));
assert.equal(later.complete, false);
assert.equal(later.setups[0].coverage.state, 'passed');
assert.equal(later.sources[0].result.functions[0].covered, 2);
assert.equal(later.setups[1].coverage.state, 'not-run');
const output = join(work, 'result.json');
writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
console.log(`Collection checks passed: ${Object.keys(results).length} scenarios, real coverage, merged setups, CRAP, failure controls, source preservation and cleanup. Results: ${output}`);
