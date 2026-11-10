// With typecheckMutants, the real compiler rejects type-invalid operator
// mutants as compile-error; without it they keep their runtime verdicts.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const {values} = parseArgs({options:{cli:{type:'string'}}});
const binary = resolve(values.cli ?? process.env.SESHAT_CLI_BINARY ??
  join(repo, `crates/seshat/target/debug/seshat${process.platform === 'win32' ? '.exe' : ''}`));
mkdirSync(join(repo, 'work/assurance-proofs'), {recursive:true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/typecheck-mutants-'));
const project = join(work, 'input'), scratch = join(work, 'scratch');
mkdirSync(project); mkdirSync(scratch);
const inputs = {
  'package.json':'{"type":"module"}',
  'tsconfig.json':JSON.stringify({files:['subject.ts'], compilerOptions:{
    strict:true, noEmit:true, target:'ES2022', module:'NodeNext', moduleResolution:'NodeNext'}}),
  'subject.ts':`export interface User { name: string }
export function label(user?: User) { return user?.name; }
export function join(left: string, right: string) { return left + right; }
export function userName(user: User | null) { return user && user.name; }
export function enabled(): true { return true; }
export function adult(age: number) { return age >= 18; }
`,
  'test.mjs':`import {test} from 'node:test';
import assert from 'node:assert/strict';
import {label, join, userName, enabled, adult} from './subject.ts';
test('label', () => assert.equal(label({name:'a'}), 'a'));
test('join', () => assert.equal(join('a', 'b'), 'ab'));
test('userName', () => { assert.equal(userName(null), null); assert.equal(userName({name:'b'}), 'b'); });
test('enabled', () => assert.equal(enabled(), true));
test('adult', () => { assert.equal(adult(18), true); assert.equal(adult(17), false); });
`,
};
for (const [path, source] of Object.entries(inputs)) writeFileSync(join(project, path), source);
// The four type-invalid cases from issue 217, then a type-valid control.
const runtime = {'?.':'survived', '+':'killed', '&&':'killed', 'true':'killed', '>=':'killed'};
const results = [];
for (const typecheckMutants of [false, true]) {
  const config = {source:{include:['subject.ts']}, capture:Object.keys(inputs), setups:[{
    name:'node', runner:'node', cwd:'.', timeoutMs:30000, typecheckMutants,
    typecheck:[process.execPath, join(repo, 'benchmarks/proofs/node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'],
    test:[process.execPath, '--test', '--test-concurrency=1', '--test-reporter={seshatReporter}', 'test.mjs'],
    coverage:{command:[process.execPath, join(repo, 'benchmarks/proofs/collect-node.mjs'), 'test.mjs'],
      report:'coverage/final.json'},
  }]};
  const configPath = join(project, 'seshat.json');
  writeFileSync(configPath, JSON.stringify(config));
  const child = spawnSync(binary, ['mutate', '--config', configPath, '--scratch', scratch, '--json'],
    {encoding:'utf8', timeout:300000});
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const report = JSON.parse(child.stdout), mutation = report.result.mutation;
  assert.equal(mutation.complete, true);
  const verdicts = {};
  for (const row of mutation.outcomes) (verdicts[row.original] ??= []).push(row.verdict);
  for (const [original, verdict] of Object.entries(runtime)) {
    const expected = typecheckMutants && original !== '>=' ? 'compile-error' : verdict;
    assert.ok(verdicts[original]?.length, `no ${original} mutant planned`);
    assert.ok(verdicts[original].every(actual => actual === expected), `${original}: ${verdicts[original]}`);
  }
  assert.equal(mutation.compileErrors, typecheckMutants ? 4 : 0);
  assert.equal(mutation.score, typecheckMutants ? 100 : 5 / 6 * 100);
  const extreme = report.result.pseudoTesting.outcomes;
  assert.ok(extreme.length > 0 && extreme.every(row => row.verdict !== 'compile-error'));
  results.push({typecheckMutants, verdicts, compileErrors:mutation.compileErrors, score:mutation.score,
    mutationWallMs:mutation.mutationWallMs, jobsAttempted:mutation.jobsAttempted});
  console.log(`typecheckMutants=${typecheckMutants}: ${JSON.stringify(verdicts)}`);
}
writeFileSync(join(work, 'result.json'), JSON.stringify(results, null, 2) + '\n');
console.log(`Typecheck mutant proof passed. Results: ${relative(repo, join(work, 'result.json'))}`);
