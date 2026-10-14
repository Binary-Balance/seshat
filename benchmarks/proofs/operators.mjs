// Operator semantics and real CLI assessments on disposable, self-contained fixtures.
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
const binary = resolve(process.env.SESHAT_CLI_BINARY ?? `crates/seshat/target/release/seshat${suffix}`);
const proof = resolve(process.env.SESHAT_PROOF_BINARY ?? `crates/seshat/target/release/seshat-proofs${suffix}`);
mkdirSync(join(repo, 'work/assurance-proofs'), {recursive: true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/operators-'));
const project = join(work, 'input');
const scratch = join(work, 'scratch');
mkdirSync(project);
mkdirSync(scratch);

function invoke(executable, args, timeout = 120000) {
  const child = spawnSync(executable, args, {encoding: 'utf8', timeout});
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  return JSON.parse(child.stdout);
}
async function evaluate(source, active) {
  const compiled = ts.transpileModule(source, {compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    moduleDetection: ts.ModuleDetectionKind.Legacy, ignoreDeprecations: '6.0',
  }, reportDiagnostics: true});
  assert.deepEqual(compiled.diagnostics, []);
  try {
    const result = await runInNewContext(compiled.outputText,
      {process: {env: active === undefined ? {} : {SESHAT_MUTANT_ID: String(active)}}}, {timeout: 1000});
    return {value: JSON.stringify(result, (_, value) => typeof value === 'bigint' ? `${value}n` : value)};
  } catch (error) {
    return {error: `${error.name}: ${error.message}`};
  }
}

const cases = [
  ['adjacent-signs', 'const a = 8, b = 2; [a+-b, a-+b];', [6, 6], [[10, 6], [6, 10]]],
  ['adjacent-comment', '8*/*division*/2;', 16, [4]],
  ['adjacent-regex', '8*/xx/.source.length;', 16, [4]],
  ['unicode-trivia', '[4\uFEFF+\uFEFF2, false\uFEFF&&\uFEFFtrue];', [6, false], [[2, false], [6, true]]],
  ['and-short-circuit', "const log: string[] = []; function next(name: string, value: number) { log.push(name); return value; } const result = next('left', 0) && next('right', 7); [result, log];", [0, ['left']], [[7, ['left', 'right']]]],
  ['or-short-circuit', "const log: string[] = []; function next(name: string, value: string) { log.push(name); return value; } const result = next('left', 'yes') || next('right', 'right'); [result, log];", ['yes', ['left']], [['right', ['left', 'right']]]],
  ['and-chain', "function f(a: string, b: string, c: string) { return a && b && c; } [f('a', 'b', ''), f('', 'b', 'c')];", ['', ''], [['b', 'c'], ['', 'c']]],
  ['or-chain', "function f(a: string, b: string, c: string) { return a || b || c; } [f('a', '', 'c'), f('', 'b', '')];", ['a', 'b'], [['c', ''], ['c', '']]],
  ['arithmetic', '[8 + 2, 8 - 2, 8 * 2, 8 / 2];', [10, 6, 16, 4], [[6, 6, 16, 4], [10, 10, 16, 4], [10, 6, 4, 4], [10, 6, 16, 16]]],
  ['bigint', '[8n + 2n, 8n - 2n, 8n * 2n, 8n / 2n];', ['10n', '6n', '16n', '4n']],
  ['coercion', "const log: string[] = []; const a = {valueOf() { log.push('coerce'); return 8; }}; function b() { log.push('right'); return 2; } const result = a as any + b(); [result, log];", [10, ['right', 'coerce']], [[6, ['right', 'coerce']]]],
  ['await', 'async function f() { return false && await Promise.resolve(7); } f();', false, [7]],
  ['yield', 'function* f() { return true || (yield 7); } const iterator = f(); [iterator.next(), iterator.next(3)];', [{value: true, done: true}, {done: true}], [[{value: 7, done: false}, {value: 3, done: true}]]],
  ['direct-eval', "function f() { let value = 1; false && eval('value = 9'); return value; } f();", 1, [9]],
  ['mixed', 'function f(a: number, b: number) { return (a + b > 0) && a / b; } [f(8, 2), f(-8, 2)];', [4, false]],
  ['equivalent-addition', '4 + 0;', 4, [4]],
  ['equivalent-logical', 'false && false;', false, [false]],
];
let semanticMutants = 0;
for (const [name, source, expected, mutants] of cases) {
  const input = join(work, `${name}.ts`);
  const prepared = join(work, `${name}-prepared.ts`);
  const replacement = join(work, `${name}-replacement.ts`);
  writeFileSync(input, source);
  const facts = invoke(proof, ['inspect', input]);
  invoke(proof, ['prepare', input, prepared]);
  const switched = readFileSync(prepared, 'utf8');
  assert.deepEqual(await evaluate(source), {value: JSON.stringify(expected)}, `${name}: original`);
  assert.deepEqual(await evaluate(switched), await evaluate(source), `${name}: inactive`);
  if (mutants) assert.equal(facts.mutants.length, mutants.length, name);
  for (const row of facts.mutants) {
    invoke(proof, ['replace', input, replacement, String(row.id)]);
    const result = await evaluate(readFileSync(replacement, 'utf8'));
    if (mutants) assert.deepEqual(result, {value: JSON.stringify(mutants[row.id])}, `${name}: mutant ${row.id}`);
    assert.deepEqual(await evaluate(switched, row.id), result, `${name}: switching ${row.id}`);
    semanticMutants++;
  }
}
console.log(`Operator semantics: ${cases.length} cases, ${semanticMutants} replacement/switching pairs`);

const originals = {
  'package.json': '{"type":"module"}',
  'arithmetic.ts': `export function add(a: number, b: number) { return a + b; }
export function subtract(a: number, b: number) { return a - b; }
export function multiply(a: number, b: number) { return a * b; }
export function divide(a: number, b: number) { return a / b; }
export function compare(a: number, b: number) { return a < b; }
export function equivalentAdd() { return 4 + 0; }
`,
  'logical.ts': `export function and(a: boolean, b: boolean) { return a && b; }
export function or(a: boolean, b: boolean) { return a || b; }
export function equivalentLogical() { return false && false; }
`,
  'test.mjs': `import {test} from 'node:test';
import assert from 'node:assert/strict';
import {add, subtract, multiply, divide, compare, equivalentAdd} from './arithmetic.ts';
import {and, or, equivalentLogical} from './logical.ts';
test('operators', () => {
  assert.deepEqual([add(8, 2), subtract(8, 2), multiply(8, 2), divide(8, 2)], [10, 6, 16, 4]);
  assert.deepEqual([compare(1, 2), compare(2, 2), compare(2, 1)], [true, false, false]);
  assert.deepEqual([and(true, false), and(false, true), and(true, true)], [false, false, true]);
  assert.deepEqual([or(true, false), or(false, true), or(false, false)], [true, true, false]);
  assert.equal(equivalentAdd(), 4);
  assert.equal(equivalentLogical(), false);
});
`,
};
for (const [path, source] of Object.entries(originals)) writeFileSync(join(project, path), source);
const config = {source: {include: ['*.ts']}, capture: Object.keys(originals), setups: [{
  name: 'node', runner: 'node', cwd: '.', timeoutMs: 10000,
  typecheck: [process.execPath, join(repo, 'benchmarks/node_modules/typescript/bin/tsc'), '--ignoreConfig', '--strict', '--noEmit', '--skipLibCheck', '--target', 'es2022', 'arithmetic.ts', 'logical.ts'],
  test: [process.execPath, '--test', '--test-concurrency=1', '--test-reporter={seshatReporter}', 'test.mjs'],
  coverage: {command: [process.execPath, join(here, 'collect-node.mjs'), 'test.mjs'], report: 'coverage/final.json'},
}]};
const reports = [];
function assess(name, operators, switching = false, workers = 1) {
  const input = {...config, workers};
  if (operators !== undefined) input.mutationOperators = operators;
  const path = join(project, 'seshat.json');
  writeFileSync(path, JSON.stringify(input));
  const args = ['mutate', '--config', path, '--scratch', scratch, '--json', '--no-progress'];
  if (switching) args.push('--experimental-switching');
  const report = invoke(binary, args);
  assert.equal(report.complete, true, JSON.stringify(report));
  assert.equal(report.schemaVersion, 1);
  const result = report.result.mutation;
  const enabled = operators ?? ['comparison', 'logical', 'arithmetic'];
  assert.deepEqual(result.enabledOperators, enabled);
  const counts = {comparison: 2, logical: 3, arithmetic: 5};
  const planned = enabled.reduce((sum, family) => sum + counts[family], 0);
  assert.equal(result.planned, planned);
  assert.equal(result.completed, planned);
  assert.equal(result.notRun, 0);
  assert.equal(result.unresolved, 0);
  assert.equal(result.jobsAttempted, planned);
  assert.equal(result.workersUsed, Math.min(workers, planned));
  const equivalent = result.outcomes.filter(row => row.verdict === 'survived');
  assert.equal(equivalent.length, enabled.filter(family => family !== 'comparison').length);
  assert.ok(equivalent.every(row => originals[row.path].slice(0, row.offset).split('function ').at(-1).startsWith('equivalent')));
  assert.equal(result.score, planned === 0 ? null : (planned - equivalent.length) / planned * 100);
  for (const key of ['planned', 'completed', 'jobsAttempted']) {
    assert.equal(result.perOperator.reduce((sum, row) => sum + row[key], 0), result[key]);
  }
  assert.ok(result.perOperator.every(row => row.executionMs >= 0));
  assert.equal(report.result.pseudoTesting.planned, 9, 'operator selection does not disable extreme mutation');
  assert.deepEqual(readdirSync(scratch), []);
  for (const [path, source] of Object.entries(originals)) assert.equal(readFileSync(join(project, path), 'utf8'), source);
  reports.push({name, ...result});
  console.log(`${name}: ${planned} planned, ${result.killed} killed, ${result.survived} survived`);
  return result;
}
const stable = result => result.outcomes.map(({id, localId, path, offset, kind, original, replacement, verdict}) =>
  ({id, localId, path, offset, kind, original, replacement, verdict}));
const replaced = assess('default-replacement');
assert.deepEqual(stable(assess('default-switching', undefined, true)), stable(replaced));
assess('logical-switching-parallel', ['logical'], true, 2);
assess('arithmetic-replacement-parallel', ['arithmetic'], false, 2);
assess('comparison-only', ['comparison']);
assess('no-operator-mutants', []);

const samples = Number(process.env.SESHAT_OPERATOR_SAMPLES ?? 1);
assert.ok(Number.isInteger(samples) && samples >= 1 && samples <= 7);
for (let sample = 0; sample < samples; sample++) {
  for (const family of ['logical', 'arithmetic']) {
    for (const switching of sample % 2 === 0 ? [false, true] : [true, false]) {
      const result = assess(`cost-${family}-${switching ? 'switch' : 'replace'}-${sample}`, [family], switching);
      const earlier = reports.find(row => row.name === `cost-${family}-${switching ? 'replace' : 'switch'}-${sample}`);
      if (earlier) assert.deepEqual(stable(result), stable(earlier));
    }
  }
}
const output = resolve(process.env.SESHAT_PROOF_OUTPUT ?? join(work, 'operators.json'));
// Source identities and all execution paths in retained evidence must be portable.
const portable = JSON.stringify({environment: {node: process.version, platform: process.platform, arch: process.arch},
  typescriptVersion: ts.version,
  binaries: {cliSha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
    proofSha256: createHash('sha256').update(readFileSync(proof)).digest('hex')},
  semanticCases: cases.length, semanticMutants,
  fixtureHashes: Object.fromEntries(Object.entries(originals).map(([path, source]) => [path, createHash('sha256').update(source).digest('hex')])),
  equivalentMutants: {logical: {count: 1, planned: 3}, arithmetic: {count: 1, planned: 5},
    basis: 'Hand-checked constant expressions false && false and 4 + 0. These are fixture rates, not automatic equivalence detection or a population estimate.'},
  samples, reports}, (_, value) => typeof value === 'string'
    ? value.replaceAll(work, '<work>').replaceAll(repo, '<repo>')
      .replaceAll(work.replaceAll('\\', '/'), '<work>').replaceAll(repo.replaceAll('\\', '/'), '<repo>')
    : value, 2);
writeFileSync(output, portable + '\n');
console.log(`Operator evidence: ${output}`);
