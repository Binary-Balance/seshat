// Real node:test hangs must leave a timeout and permit later, isolated mutants.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const {values} = parseArgs({options:{cli:{type:'string'}}});
const binary = resolve(values.cli ?? process.env.SESHAT_CLI_BINARY ??
  join(repo, `crates/seshat/target/debug/seshat${process.platform === 'win32' ? '.exe' : ''}`));
mkdirSync(join(repo, 'work/assurance-proofs'), {recursive:true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/job-deadlines-'));
const project = join(work, 'input'), scratch = join(work, 'scratch');
mkdirSync(project); mkdirSync(scratch);
const inputs = {
  'package.json':'{"type":"module"}',
  'subject.ts':'export function ready() { return 1; }\nexport function adult(age: number) { return age >= 18; }\n',
  'test.mjs':`import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ready,adult} from './subject.ts';
test('ready',()=>{while(ready() !== 1) {}});
test('adult',()=>assert.equal(adult(20),true));
`,
};
for (const [path, source] of Object.entries(inputs)) writeFileSync(join(project, path), source);
const results = [];
for (const workers of [1, 2]) {
  for (const switching of [false, true]) {
    const config = {workers, source:{include:['subject.ts']}, capture:Object.keys(inputs), setups:[{
      name:'node', runner:'node', cwd:'.', timeoutMs:3000,
      typecheck:[process.execPath, '--check', 'test.mjs'],
      test:[process.execPath, '--test', '--test-concurrency=1', '--test-reporter={seshatReporter}', 'test.mjs'],
      coverage:{command:[process.execPath, join(repo, 'benchmarks/proofs/collect-node.mjs'), 'test.mjs'],
        report:'coverage/final.json'},
    }]};
    const configPath = join(project, 'seshat.json');
    writeFileSync(configPath, JSON.stringify(config));
    const args = ['mutate', '--config', configPath, '--scratch', scratch, '--json'];
    if (switching) args.push('--experimental-switching');
    const child = spawnSync(binary, args, {encoding:'utf8', timeout:60000});
    assert.ifError(child.error);
    assert.equal(child.status, 2, child.stdout + child.stderr);
    const report = JSON.parse(child.stdout), result = report.result;
    const extreme = result.pseudoTesting, mutation = result.mutation;
    assert.equal(report.complete, false);
    assert.equal(extreme.notRun, 0, child.stdout);
    assert.deepEqual(extreme.outcomes.map(row => row.verdict), ['timed-out','killed']);
    for (const row of extreme.outcomes.filter(row => row.verdict === 'timed-out')) {
      assert.equal(row.setups[0].timedOut, true);
      assert.notEqual(row.setups[0].testTimedOut, true);
      assert.equal(row.setups[0].cleanupError, null);
    }
    assert.ok(mutation.workersUsed > 0);
    assert.equal(mutation.notRun, 0);
    assert.deepEqual(mutation.outcomes.map(row => row.verdict), ['survived','killed']);
    assert.equal(mutation.complete, false);
    assert.equal(mutation.score, null, 'unresolved extreme mutants withhold the overall score');
    assert.deepEqual(readdirSync(scratch), []);
    for (const [path, source] of Object.entries(inputs)) assert.equal(readFileSync(join(project, path), 'utf8'), source);
    results.push({workers, switching, report});
    console.log(`job deadline: workers=${workers}, switching=${switching}, later mutants completed`);
  }
}
writeFileSync(join(work, 'result.json'), JSON.stringify(results, null, 2).replaceAll(work, '<work>') + '\n');
console.log(`Job deadline continuation passed. Results: ${relative(repo, join(work, 'result.json'))}`);
