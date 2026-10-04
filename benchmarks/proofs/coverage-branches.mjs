// Real source-mapped branch counters for the supported Node, Vitest and Jest/Expo routes.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const require = createRequire(join(here, 'package.json'));
const ts = require('../node_modules/typescript');
const instrument = require('istanbul-lib-instrument');
const coverage = require('istanbul-lib-coverage');
const sourceMaps = require('istanbul-lib-source-maps');
const modules = join(here, 'node_modules');
const expo = resolve(process.env.SESHAT_JEST_EXPO_DEPS ?? join(here, 'fixtures/jest-expo'));
const binary = resolve(process.env.SESHAT_PROOF_BINARY ?? 'crates/seshat/target/release/seshat-proofs');
mkdirSync(join(repo, 'work/assurance-proofs'), {recursive: true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/coverage-branches-'));
const source = join(work, 'subject.tsx');
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
writeFileSync(source, `/** @jsxRuntime classic */
/** @jsx React.createElement */
export function price(amount: number, member: boolean) {
  let total = amount;
  if (member) total = amount * 0.9;
  return total;
}
export function conditional(flag: boolean) { return flag ? 1 : 2; }
export function parenthesized(flag: boolean) {
  return flag ? (1) : (2);
}
export function logical(value: boolean, other: boolean) { return value && other; }
export function logicalWrapped(value: boolean, other: boolean, last: boolean) {
  return value && (other || last);
}
export function nullish(value: string | null) { return value ?? 'missing'; }
export function defaults(value = 7) { return value; }
export function destructured({value = 7}: {value?: number}) { return value; }
export function optional(value: {name: string} | null) { return value?.name; }
export function nested(value: boolean) {
  const inner = (flag: boolean) => flag ? 1 : 2;
  return inner(value);
}
export function choice(value: number) {
  switch (value) { case 1: return 1; case 2: return 2; default: return 3; }
}
export function straight() { return 1; }
export function empty() {}
function element(_tag: string, _props: unknown, text: string) { return text; }
const React = {createElement: element, Fragment: 'fragment'};
export function view(flag: boolean) {
  return <span>{flag ? 'on' : 'off'}</span>;
}
export function fragment(flag: boolean) {
  return <>{flag ? ('on') : ('off')}</>;
}
`);
const checks = `assert.equal(subject.price(100, true), 90);
assert.equal(subject.conditional(true), 1);
assert.equal(subject.parenthesized(true), 1);
assert.equal(subject.logical(false, true), false);
assert.equal(subject.logicalWrapped(false, true, false), false);
assert.equal(subject.nullish('present'), 'present');
assert.equal(subject.defaults(3), 3);
assert.equal(subject.destructured({value: 3}), 3);
assert.equal(subject.optional({name: 'present'}), 'present');
assert.equal(subject.nested(true), 1);
assert.equal(subject.choice(1), 1);
assert.equal(subject.straight(), 1);
subject.empty();
assert.equal(subject.view(true), 'on');
assert.equal(subject.fragment(true), 'on');
`;
function run(args) {
  const child = spawnSync(process.execPath, args, {
    cwd: work, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stdout + child.stderr);
}
json(join(work, 'package.json'), {private: true, type: 'commonjs'});
const compiled = ts.transpileModule(readFileSync(source, 'utf8'), {fileName: source,
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React, sourceMap: true, inlineSources: true}, reportDiagnostics: true});
assert.equal(compiled.diagnostics.length, 0);
const tool = instrument.createInstrumenter();
writeFileSync(join(work, 'subject.instrumented.cjs'), tool.instrumentSync(
  compiled.outputText.replace(/\/\/# sourceMappingURL=.*$/m, ''), join(work, 'subject.cjs'),
  JSON.parse(compiled.sourceMapText)));
writeFileSync(join(work, 'checks.node.cjs'), `const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const subject = require('./subject.instrumented.cjs');
test('branch coverage', () => { ${checks} });
after(() => require('node:fs').writeFileSync('node-raw.json', JSON.stringify(globalThis.__coverage__)));
`);
writeFileSync(join(work, 'checks.vitest.mjs'), `import {test} from ${JSON.stringify(join(modules, 'vitest/dist/index.js'))};
import assert from 'node:assert/strict';
import * as subject from './subject.tsx';
test('branch coverage', () => { ${checks} });
`);
writeFileSync(join(work, 'vitest.config.mjs'), `export default {test: {
include: ['checks.vitest.mjs'], coverage: {provider: 'istanbul', include: ['subject.tsx'],
reporter: ['json'], reportsDirectory: 'coverage-vitest'}}};
`);
writeFileSync(join(work, 'checks.jest.test.tsx'), `import assert from 'node:assert/strict';
import * as subject from './subject';
test('branch coverage', () => { ${checks} });
`);
writeFileSync(join(work, 'babel.config.cjs'), `module.exports = {presets: [[${JSON.stringify(join(expo, 'node_modules/babel-preset-expo'))}, {jsxRuntime: 'classic'}]]};
`);
writeFileSync(join(work, 'jest.config.cjs'), `module.exports = {
preset: ${JSON.stringify(join(expo, 'node_modules/jest-expo'))},
rootDir: __dirname, moduleDirectories: ['node_modules', ${JSON.stringify(join(expo, 'node_modules'))}],
testMatch: ['**/checks.jest.test.tsx'], coverageProvider: 'babel', collectCoverageFrom: ['subject.tsx'],
coverageReporters: ['json'], coverageDirectory: 'coverage-jest-expo'};
`);
run(['--test', 'checks.node.cjs']);
const mapped = await sourceMaps.createSourceMapStore().transformCoverage(
  coverage.createCoverageMap(JSON.parse(readFileSync(join(work, 'node-raw.json'), 'utf8'))));
json(join(work, 'node-mapped.json'), mapped.toJSON());
run([join(modules, 'vitest/vitest.mjs'), 'run', '--config', 'vitest.config.mjs', '--coverage',
  '--maxWorkers=1', '--no-file-parallelism']);
run([join(expo, 'node_modules/jest/bin/jest.js'), '--config', 'jest.config.cjs', '--runInBand', '--coverage']);

const reports = {
  node: join(work, 'node-mapped.json'),
  vitest: join(work, 'coverage-vitest/coverage-final.json'),
  'jest-expo': join(work, 'coverage-jest-expo/coverage-final.json'),
};
const results = {environment: {
  node: process.version, typescript: ts.version,
  vitest: require('vitest/package.json').version,
  jest: JSON.parse(readFileSync(join(expo, 'node_modules/jest/package.json'), 'utf8')).version,
  'jest-expo': JSON.parse(readFileSync(join(expo, 'node_modules/jest-expo/package.json'), 'utf8')).version,
}, routes: {}};
for (const [provider, path] of Object.entries(reports)) {
  const file = JSON.parse(readFileSync(path, 'utf8'))[source];
  const child = spawnSync(binary, ['score', source, path], {encoding: 'utf8', timeout: 10000});
  assert.ifError(child.error);
  const result = JSON.parse(child.stdout);
  results.routes[provider] = {result, branches: Object.entries(file.branchMap)
    .map(([id, branch]) => ({...branch, hits: file.b[id]}))};
  assert.equal(child.status, 0, JSON.stringify(result));
  const named = Object.fromEntries(result.functions.map(row => [row.name, row]));
  for (const name of ['price', 'conditional', 'parenthesized', 'logical', 'nullish', 'view', 'fragment']) {
    assert.equal(named[name].coverage, 1, `${provider}/${name}: statement coverage`);
    assert.equal(named[name].branchCoverage, 0.5, `${provider}/${name}: branch coverage`);
    assert.equal(named[name].coverageBasis, 'branch');
    assert.equal(named[name].crap, 2.5);
  }
  assert.equal(named.straight.branchTotal, 0);
  assert.equal(named.straight.coverageBasis, 'statement');
  assert.equal(named.straight.crap, 1);
  assert.equal(named.empty.status, 'not-applicable');
  for (const name of ['defaults', 'destructured']) {
    assert.equal(named[name].coverage, 1);
    assert.equal(named[name].branchTotal, 1);
    assert.equal(named[name].branchCoverage, 0);
    assert.equal(named[name].crap, 6);
  }
  assert.equal(named.optional.branchTotal, 0);
  assert.equal(named.optional.coverageBasis, 'statement');
  assert.equal(named.optional.crap, 2);
  assert.equal(named.nested.branchTotal, 0);
  assert.equal(named.nested.coverageBasis, 'statement');
  const inner = result.functions.find(row => row.name.startsWith('arrow@'));
  assert.equal(inner.branchCoverage, 0.5);
  assert.equal(inner.crap, 2.5);
  for (const name of ['choice', 'logicalWrapped']) {
    assert.equal(named[name].branchCovered, 1);
    assert.equal(named[name].branchTotal, 3);
    assert.ok(Math.abs(named[name].crap - 17 / 3) < 1e-12);
  }
  console.log(`${provider}: partial branches scored; defaults, nested scopes and statement fallback verified`);
}
const output = resolve(process.env.SESHAT_PROOF_OUTPUT ?? join(work, 'summary.json'));
json(output, results);
console.log(`Results: ${relative(repo, output)}`);
