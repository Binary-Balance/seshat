// Real source-mapped branch counters for the supported Node, Vitest and Jest/Expo routes.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
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
const modules = resolve(process.env.SESHAT_VITEST_DEPS ?? join(here, 'node_modules'));
const vitestRequire = createRequire(join(modules, 'coverage-proof.cjs'));
const expo = resolve(process.env.SESHAT_JEST_EXPO_DEPS ?? join(here, 'fixtures/jest-expo'));
const plain = resolve(process.env.SESHAT_JEST_DEPS ?? join(repo, 'examples/jest'));
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
export function nestedConditional(flag: boolean, other: boolean) {
  return flag ? (other ? 1 : 2) : 3;
}
export function nestedLogical(flag: boolean, value: boolean, other: boolean) {
  return flag ? (value && other) : false;
}
export function logical(value: boolean, other: boolean) { return value && other; }
export function logicalWrapped(value: boolean, other: boolean, last: boolean) {
  return value && (other || last);
}
export function logicalIf(value: boolean, other: boolean) {
  if (value || other) { return 1; }
  return 0;
}
export function objectConditional(flag: boolean) {
  return {
    value: flag
      ? {answer: 1}
      : {answer: 2},
    nested: {
      port: flag ? 1234 : 5678,
      next: true,
    },
  };
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
export function fragmentMultiline(flag: boolean) {
  return <>
    {flag ? 'on' : 'off'}
  </>;
}
export function elementMultiline(flag: boolean) {
  return <span>
    {flag ? 'on' : 'off'}
  </span>;
}
export function fragmentText(flag: boolean) {
  return <>{flag ? 'on' : 'off'} tail</>;
}
export function fragmentSibling(flag: boolean) {
  return <>{flag ? 'on' : 'off'}<span>tail</span></>;
}
export function attribute(flag: boolean) {
  return <span title={flag ? 'on' : 'off'}>tail</span>;
}
export function attributeClosed(flag: boolean) {
  return <span title={flag ? 'on' : 'off'} />;
}
export function viewComment(flag: boolean) {
  return <span>{flag ? 'on' : 'off'} {/* comment */}</span>;
}
export function fragmentComment(flag: boolean) {
  return <>{flag ? 'on' : 'off'} {/* comment */}</>;
}
export function viewNested(flag: boolean, other: boolean) {
  return <span>{flag ? (other ? 'on' : 'off') : 'missing'}</span>;
}
export function attributeNested(flag: boolean, other: boolean) {
  return <span title={flag ? (other ? 'on' : 'off') : 'missing'} />;
}
function key() { return 'present'; }
export function computed(value = 7, {[key()]: other}: {present: number}) {
  return value + other;
}
export function defaultsNamed(value = 7, next = function defaultNext() { return 3; }) {
  return value + next();
}
/* istanbul ignore next -- @preserve */
export function suppressed(flag: boolean) {
  function suppressedNested() { return flag ? 1 : 2; }
  return suppressedNested();
}
/* istanbul ignore next -- @preserve */
export const suppressedArrow = ((flag: boolean) => flag ? 1 : 2);
export class SuppressedMethod {
  /* istanbul ignore next -- @preserve */
  ignored(flag: boolean) { return flag ? 1 : 2; }
}
/* c8 ignore next -- @preserve */
export function c8Hint() { return 1; }
/* v8 ignore next -- @preserve */
export function v8Hint() { return 1; }
export const suppressedAccessors = {
  /* istanbul ignore next -- @preserve */
  get value() { return 1; },
  /* istanbul ignore next -- @preserve */
  set value(value: number) { if (value < 0) throw new Error('negative'); },
};
`);
const ignoredSource = join(work, 'ignored.ts');
writeFileSync(ignoredSource, `/* istanbul ignore file -- @preserve */
export function ignoredFile(flag: boolean) { return flag ? 1 : 2; }
`);
const otherHintsSource = join(work, 'other-hints.ts');
writeFileSync(otherHintsSource, `/* c8 ignore file -- @preserve */
/* v8 ignore file -- @preserve */
export function otherHints() { return 1; }
`);
const partialSource = join(work, 'partial.ts');
writeFileSync(partialSource, `export function partiallySuppressed(flag: boolean) {
  /* istanbul ignore next -- @preserve */
  const inner = flag ? () => 1 : () => 2;
  return 0;
}
export function ignoredStatement(flag: boolean) {
  /* istanbul ignore next -- @preserve */
  void flag;
  return 1;
}
export function allStatementsIgnored() {
  /* istanbul ignore next -- @preserve */
  return 1;
}
export function ignoredIf(flag: boolean) {
  /* istanbul ignore if -- @preserve */
  if (flag) {
    function hidden() { return flag ? 1 : 0; }
    return hidden();
  } else { return 2; }
}
export function ignoredElse(flag: boolean) {
  /* istanbul ignore else -- @preserve */
  if (flag) { return 1; } else { return 2; }
}
export function ignoredImplicitElse(flag: boolean) {
  /* istanbul ignore else -- @preserve */
  if (flag) { return 1; }
  return 2;
}
export function ignoredTernary(flag: boolean) {
  return flag ? /* istanbul ignore next -- @preserve */ 1 : 2;
}
export function ignoredLogical(flag: boolean) {
  return flag || /* istanbul ignore next -- @preserve */ false;
}
export function retainedBranch(flag: boolean) {
  /* istanbul ignore next -- @preserve */
  void flag;
  return flag ? 1 : 2;
}
`);
const partialChecks = `assert.equal(partial.partiallySuppressed(true), 0);
assert.equal(partial.ignoredStatement(true), 1);
assert.equal(partial.allStatementsIgnored(), 1);
assert.equal(partial.ignoredIf(false), 2);
assert.equal(partial.ignoredElse(true), 1);
assert.equal(partial.ignoredImplicitElse(true), 1);
assert.equal(partial.ignoredTernary(false), 2);
assert.equal(partial.ignoredLogical(true), true);
assert.equal(partial.retainedBranch(true), 1);`;
const parenthesizedSource = join(work, 'parenthesized.ts');
writeFileSync(parenthesizedSource, `export function parenthesizedWrapper() {
  const ignored = /* istanbul ignore next -- @preserve */ (() => 1);
  return ignored();
}
`);
const functionCountersSource = join(work, 'function-counters.ts');
writeFileSync(functionCountersSource, `function key() { return 'value'; }
export function functionCounterWrapper() {
  const ignored = /* istanbul ignore next -- @preserve */
    (({[key()]: value}: Record<string, number>) => {});
  return ignored({value: 1});
}
export function emptyWrapper() {
  const ignored = /* istanbul ignore next -- @preserve */ (() => {});
  return ignored();
}
export function declarationWrapper() {
  const ignored = /* istanbul ignore next -- @preserve */ (() => { function nested() {} });
  return ignored();
}
`);
const checks = `assert.equal(subject.price(100, true), 90);
assert.equal(subject.conditional(true), 1);
assert.equal(subject.parenthesized(true), 1);
assert.equal(subject.nestedConditional(true, true), 1);
assert.equal(subject.nestedLogical(true, false, true), false);
assert.equal(subject.logical(false, true), false);
assert.equal(subject.logicalWrapped(false, true, false), false);
assert.equal(subject.logicalIf(false, false), 0);
assert.equal(subject.logicalIf(true, false), 1);
assert.deepEqual(subject.objectConditional(true), {value: {answer: 1}, nested: {port: 1234, next: true}});
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
assert.equal(subject.fragmentMultiline(true), 'on');
assert.equal(subject.elementMultiline(true), 'on');
assert.equal(subject.fragmentText(true), 'on');
assert.equal(subject.fragmentSibling(true), 'on');
assert.equal(subject.attribute(true), 'tail');
assert.equal(subject.attributeClosed(true), undefined);
assert.equal(subject.viewComment(true), 'on');
assert.equal(subject.fragmentComment(true), 'on');
assert.equal(subject.viewNested(true, true), 'on');
assert.equal(subject.attributeNested(true, true), undefined);
assert.equal(subject.computed(undefined, {present: 3}), 10);
assert.equal(subject.defaultsNamed(), 10);
assert.equal(subject.suppressed(true), 1);
assert.equal(subject.suppressedArrow(true), 1);
assert.equal(new subject.SuppressedMethod().ignored(true), 1);
assert.equal(subject.c8Hint(), 1);
assert.equal(subject.v8Hint(), 1);
assert.equal(subject.suppressedAccessors.value, 1);
subject.suppressedAccessors.value = 1;
`;
function run(args) {
  const child = spawnSync(process.execPath, args, {
    cwd: work, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stdout + child.stderr);
}
json(join(work, 'package.json'), {private: true, type: 'commonjs'});
function instrumentSource(source, name) {
  const compiled = ts.transpileModule(readFileSync(source, 'utf8'), {fileName: source,
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React, sourceMap: true, inlineSources: true}, reportDiagnostics: true});
  assert.equal(compiled.diagnostics.length, 0);
  writeFileSync(join(work, `${name}.instrumented.cjs`), instrument.createInstrumenter().instrumentSync(
    compiled.outputText.replace(/\/\/# sourceMappingURL=.*$/m, ''), join(work, `${name}.cjs`),
    JSON.parse(compiled.sourceMapText)));
}
instrumentSource(source, 'subject');
instrumentSource(ignoredSource, 'ignored');
instrumentSource(otherHintsSource, 'other-hints');
instrumentSource(partialSource, 'partial');
instrumentSource(parenthesizedSource, 'parenthesized');
instrumentSource(functionCountersSource, 'function-counters');
function scoreSource(source, report, status = 0) {
  const child = spawnSync(binary, ['score', source, report], {encoding: 'utf8', timeout: 10000});
  assert.ifError(child.error);
  const result = JSON.parse(child.stdout);
  assert.equal(child.status, status, JSON.stringify({source, report, problems: result.problems}));
  return result;
}
writeFileSync(join(work, 'checks.node.cjs'), `const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const subject = require('./subject.instrumented.cjs');
require('./ignored.instrumented.cjs').ignoredFile(true);
require('./other-hints.instrumented.cjs').otherHints();
const partial = require('./partial.instrumented.cjs');
${partialChecks}
assert.equal(require('./parenthesized.instrumented.cjs').parenthesizedWrapper(), 1);
const functionCounters = require('./function-counters.instrumented.cjs');
functionCounters.functionCounterWrapper(); functionCounters.emptyWrapper(); functionCounters.declarationWrapper();
test('branch coverage', () => { ${checks} });
after(() => require('node:fs').writeFileSync('node-raw.json', JSON.stringify(globalThis.__coverage__)));
`);
writeFileSync(join(work, 'checks.vitest.mjs'), `import {test} from ${JSON.stringify(join(modules, 'vitest/dist/index.js'))};
import assert from 'node:assert/strict';
import * as subject from './subject.tsx';
import {ignoredFile} from './ignored.ts';
import {otherHints} from './other-hints.ts';
import * as partial from './partial.ts';
import {parenthesizedWrapper} from './parenthesized.ts';
import * as functionCounters from './function-counters.ts';
ignoredFile(true);
otherHints();
${partialChecks}
assert.equal(parenthesizedWrapper(), 1);
functionCounters.functionCounterWrapper(); functionCounters.emptyWrapper(); functionCounters.declarationWrapper();
test('branch coverage', () => { ${checks} });
`);
writeFileSync(join(work, 'vitest.config.mjs'), `export default {test: {
include: ['checks.vitest.mjs'], coverage: {provider: 'istanbul', include: ['subject.tsx', 'ignored.ts', 'other-hints.ts', 'partial.ts', 'parenthesized.ts', 'function-counters.ts'],
reporter: ['json'], reportsDirectory: 'coverage-vitest'}}};
`);
writeFileSync(join(work, 'checks.jest.test.tsx'), `import assert from 'node:assert/strict';
import * as subject from './subject';
import {ignoredFile} from './ignored';
import {otherHints} from './other-hints';
import * as partial from './partial';
import {parenthesizedWrapper} from './parenthesized';
import * as functionCounters from './function-counters';
ignoredFile(true);
otherHints();
${partialChecks}
assert.equal(parenthesizedWrapper(), 1);
functionCounters.functionCounterWrapper(); functionCounters.emptyWrapper(); functionCounters.declarationWrapper();
test('branch coverage', () => { ${checks} });
`);
writeFileSync(join(work, 'babel.config.cjs'), `module.exports = {presets: [[${JSON.stringify(join(expo, 'node_modules/babel-preset-expo'))}, {jsxRuntime: 'classic'}]]};
`);
writeFileSync(join(work, 'jest.config.cjs'), `module.exports = {
preset: ${JSON.stringify(join(expo, 'node_modules/jest-expo'))},
rootDir: __dirname, moduleDirectories: ['node_modules', ${JSON.stringify(join(expo, 'node_modules'))}],
testMatch: ['**/checks.jest.test.tsx'], coverageProvider: 'babel', collectCoverageFrom: ['subject.tsx', 'ignored.ts', 'other-hints.ts', 'partial.ts', 'parenthesized.ts', 'function-counters.ts'],
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
  vitest: vitestRequire('vitest/package.json').version,
  vite: vitestRequire('vite/package.json').version,
  'coverage-istanbul': vitestRequire('@vitest/coverage-istanbul/package.json').version,
  jest: JSON.parse(readFileSync(join(expo, 'node_modules/jest/package.json'), 'utf8')).version,
  'jest-expo': JSON.parse(readFileSync(join(expo, 'node_modules/jest-expo/package.json'), 'utf8')).version,
}, routes: {}};
for (const [provider, path] of Object.entries(reports)) {
  const file = JSON.parse(readFileSync(path, 'utf8'))[source];
  const result = scoreSource(source, path);
  results.routes[provider] = {result, branches: Object.entries(file.branchMap)
    .map(([id, branch]) => ({...branch, hits: file.b[id]}))};
  const named = Object.fromEntries(result.functions.map(row => [row.name, row]));
  for (const name of ['price', 'conditional', 'parenthesized', 'logical', 'nullish',
    'view', 'fragment', 'fragmentMultiline', 'elementMultiline', 'fragmentText',
    'fragmentSibling', 'attribute', 'attributeClosed', 'viewComment', 'fragmentComment']) {
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
  for (const name of ['nestedConditional', 'nestedLogical', 'viewNested', 'attributeNested']) {
    assert.equal(named[name].branchCovered, 2);
    assert.equal(named[name].branchTotal, 4);
    assert.equal(named[name].crap, 4.125);
  }
  assert.equal(named.computed.branchCovered, 1);
  assert.equal(named.computed.branchTotal, 1);
  assert.equal(named.computed.crap, 2);
  assert.equal(named.defaultsNamed.branchCovered, 2);
  assert.equal(named.defaultsNamed.branchTotal, 2);
  assert.equal(named.defaultsNamed.crap, 3);
  assert.equal(named.logicalIf.coverage, 1);
  assert.equal(named.logicalIf.branchCovered, 4);
  assert.equal(named.logicalIf.branchTotal, 4);
  assert.equal(named.logicalIf.crap, 3);
  assert.equal(named.objectConditional.coverage, 1);
  assert.equal(named.objectConditional.branchCovered, 2);
  assert.equal(named.objectConditional.branchTotal, 4);
  assert.equal(named.objectConditional.crap, 4.125);
  for (const name of ['suppressed', 'suppressedNested']) {
    assert.equal(named[name].status, 'suppressed', `${provider}/${name}: ${JSON.stringify(named[name])}`);
    assert.equal(named[name].crap, null);
    assert.equal(named[name].coverage, null);
    assert.equal(named[name].coverageSuppressions, 1);
  }
  const sourceText = readFileSync(source, 'utf8');
  for (const start of [
    sourceText.indexOf('(flag: boolean) => flag ? 1 : 2', sourceText.indexOf('export const suppressedArrow')),
    sourceText.indexOf('ignored(flag: boolean)') + 'ignored'.length,
  ]) {
    const row = result.functions.find(row => row.start === start);
    assert.equal(row.status, 'suppressed', `${provider}: suppressed scope at ${start}`);
    assert.equal(row.coverage, null);
    assert.equal(row.crap, null);
    assert.equal(row.coverageSuppressions, 1);
  }
  const suppressed = result.functions.filter(row => row.status === 'suppressed');
  assert.equal(suppressed.length, 6);
  assert.ok(suppressed.every(row => row.coverage === null && row.crap === null && row.coverageSuppressions === 1));
  assert.equal(result.coverageSuppressions.count, 7);
  for (const name of ['c8Hint', 'v8Hint']) {
    assert.equal(named[name].status, 'measured');
    assert.equal(named[name].coverageSuppressions, 1);
    assert.equal(named[name].crap, 1);
  }
  const ignoredResult = scoreSource(ignoredSource, path);
  assert.equal(ignoredResult.functions[0].status, 'suppressed');
  assert.equal(ignoredResult.coverageSuppressions.count, 1);
  results.routes[provider].ignoredFile = ignoredResult;
  const otherHintsResult = scoreSource(otherHintsSource, path);
  assert.equal(otherHintsResult.coverageSuppressions.count, 2);
  assert.equal(otherHintsResult.functions[0].status, 'measured');
  assert.equal(otherHintsResult.functions[0].coverageSuppressions, 2);
  assert.equal(otherHintsResult.functions[0].coverage, 1);
  assert.equal(otherHintsResult.functions[0].crap, 1);
  assert.ok(otherHintsResult.coverageSuppressions.hints.every(hint =>
    !hint.wholeFunction && hint.functions.length === 1));
  results.routes[provider].otherHints = otherHintsResult;
  results.routes[provider].partialSuppression = verifyPartial(provider, path);
  // Vitest's transform keeps instrumenting this arrow despite the preserved hint.
  const parenthesizedResult = scoreSource(parenthesizedSource, path, provider === 'vitest' ? 2 : 0);
  assert.equal(parenthesizedResult.coverageSuppressions.count, 1);
  assert.equal(parenthesizedResult.functions[1].coverageSuppressions, 1);
  assert.equal(parenthesizedResult.functions[1].crap, null);
  if (provider === 'vitest') {
    assert.equal(parenthesizedResult.complete, false);
    assert.equal(parenthesizedResult.functions[0].status, 'unknown');
    assert.equal(parenthesizedResult.functions[0].crap, null);
  } else {
    assert.equal(parenthesizedResult.complete, true);
    assert.equal(parenthesizedResult.functions[0].status, 'measured');
    assert.equal(parenthesizedResult.functions[0].crap, 1);
    assert.equal(parenthesizedResult.functions[1].status, 'suppressed');
  }
  results.routes[provider].parenthesizedSuppression = parenthesizedResult;
  const functionCountersResult = scoreSource(functionCountersSource, path, provider === 'vitest' ? 2 : 0);
  const functionCandidates = functionCountersResult.functions.filter(row => row.coverageSuppressions > 0);
  assert.equal(functionCandidates.length, 4);
  assert.ok(functionCandidates.every(row => row.total === 0 && row.branchTotal === 0 && row.coverage === null && row.crap === null));
  if (provider === 'vitest') {
    assert.equal(functionCountersResult.complete, false);
    assert.ok(functionCandidates.filter(row => row.status === 'unknown').length >= 3);
    const raw = JSON.parse(readFileSync(path, 'utf8'))[functionCountersSource];
    const arrowLine = readFileSync(functionCountersSource, 'utf8').split('\n').findIndex(line => line.includes('(({[key()]')) + 1;
    assert.ok(Object.entries(raw.fnMap).some(([id, fn]) => fn.loc.start.line === arrowLine && raw.f[id] > 0));
  } else {
    assert.equal(functionCountersResult.complete, true);
    assert.ok(functionCandidates.every(row => row.status === 'suppressed'));
  }
  results.routes[provider].functionCounterSuppression = functionCountersResult;
  const unhintedSource = join(work, `function-counters-unhinted-${provider}.ts`);
  writeFileSync(unhintedSource, readFileSync(functionCountersSource, 'utf8')
    .replace(/\/\* istanbul ignore next -- @preserve \*\//g, hint => ' '.repeat(hint.length)));
  const unhintedReport = join(work, `function-counters-unhinted-${provider}.json`);
  const raw = JSON.parse(readFileSync(path, 'utf8'))[functionCountersSource];
  json(unhintedReport, {[unhintedSource]: {...raw, path: unhintedSource}});
  const unhinted = scoreSource(unhintedSource, unhintedReport, 2);
  assert.equal(unhinted.functions.find(row => row.start === functionCandidates[0].start).status, 'unknown');
  function rejects(name, invalid) {
    const invalidPath = join(work, `${provider}-${name}.json`);
    json(invalidPath, invalid);
    const rejected = spawnSync(binary, ['score', source, invalidPath], {encoding: 'utf8', timeout: 10000});
    assert.ifError(rejected.error);
    assert.equal(rejected.status, 2, rejected.stdout + rejected.stderr);
    const result = JSON.parse(rejected.stdout);
    assert.equal(result.complete, false);
    return Object.fromEntries(result.functions.map(row => [row.name, row]));
  }
  const malformed = JSON.parse(readFileSync(path, 'utf8'));
  const logicalLine = readFileSync(source, 'utf8').split('\n')
    .findIndex(line => line.startsWith('export function logicalIf(')) + 2;
  const logicalId = Object.entries(malformed[source].branchMap)
    .find(([, branch]) => branch.type === 'binary-expr' && branch.loc.start.line === logicalLine)[0];
  malformed[source].b[logicalId][1] = -1;
  const isolated = rejects('invalid-logical-counter', malformed);
  assert.equal(isolated.logicalIf.coverage, 1);
  assert.equal(isolated.logicalIf.status, 'unknown');
  assert.equal(isolated.logicalIf.crap, null);
  assert.equal(isolated.logicalIf.coverageBasis, null);
  assert.equal(isolated.price.crap, 2.5);
  assert.equal(isolated.objectConditional.crap, 4.125);
  const invalid = JSON.parse(readFileSync(path, 'utf8'));
  const computedLine = readFileSync(source, 'utf8').split('\n')
    .findIndex(line => line.startsWith('export function computed(')) + 1;
  const branch = Object.values(invalid[source].branchMap)
    .find(branch => branch.type === 'default-arg' && branch.loc.start.line === computedLine);
  const line = readFileSync(source, 'utf8').split('\n')[computedLine - 1];
  const end = {line: computedLine, column: line.indexOf('key()') + 'key()'.length};
  branch.loc.end = end;
  branch.locations[0].end = end;
  rejects('computed-key-crossing', invalid);
  const defaultsLine = readFileSync(source, 'utf8').split('\n')
    .findIndex(line => line.startsWith('export function defaultsNamed(')) + 1;
  const defaults = Object.entries(file.branchMap)
    .filter(([, branch]) => branch.type === 'default-arg' && branch.loc.start.line === defaultsLine)
    .sort(([, a], [, b]) => a.loc.start.column - b.loc.start.column);
  assert.equal(defaults.length, 2);
  for (const range of ['branch', 'outcome', 'both']) {
    const invalid = JSON.parse(readFileSync(path, 'utf8'));
    const first = invalid[source].branchMap[defaults[0][0]];
    const end = defaults[1][1].locations[0].end;
    if (range !== 'outcome') first.loc.end = end;
    if (range !== 'branch') first.locations[0].end = end;
    rejects(`defaultsNamed-${range}-crossing`, invalid);
  }
  console.log(`${provider}: partial branches scored; defaults, nested scopes and statement fallback verified`);
}
function verifyPartial(provider, path) {
  const result = scoreSource(partialSource, path);
  assert.equal(result.complete, true);
  const named = Object.fromEntries(result.functions.map(row => [row.name, row]));
  for (const name of ['partiallySuppressed', 'ignoredStatement', 'allStatementsIgnored',
    'ignoredIf', 'ignoredElse', 'ignoredImplicitElse', 'ignoredTernary', 'ignoredLogical', 'retainedBranch']) {
    assert.equal(named[name].status, 'partially-suppressed', `${provider}/${name}: ${JSON.stringify(result)}`);
    assert.equal(named[name].crap, null);
    assert.equal(named[name].coverageBasis, null);
    assert.equal(named[name].coverageSuppressions, 1);
    assert.equal(named[name].coverage, name === 'allStatementsIgnored' ? null
      : name === 'ignoredImplicitElse' ? 2 / 3 : 1);
  }
  assert.equal(named.allStatementsIgnored.total, 0);
  for (const name of ['ignoredIf', 'ignoredElse', 'ignoredImplicitElse', 'ignoredTernary', 'ignoredLogical']) {
    assert.equal(named[name].branchTotal, 1, `${provider}/${name}`);
    assert.equal(named[name].branchCovered, 1, `${provider}/${name}`);
    assert.equal(named[name].branchCoverage, 1);
  }
  assert.equal(named.retainedBranch.branchTotal, 2);
  assert.equal(named.retainedBranch.branchCoverage, 0.5);
  assert.equal(result.coverageSuppressions.count, 9);
  assert.equal(result.functions.filter(row => row.status === 'suppressed').length, 3);
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const text = readFileSync(partialSource, 'utf8');
  const lines = text.split('\n');
  for (const kind of ['statement', 'branch']) {
    const invalid = structuredClone(raw);
    const file = invalid[partialSource];
    const map = kind === 'statement' ? file.statementMap : file.branchMap;
    const counters = kind === 'statement' ? file.s : file.b;
    const id = Object.keys(map).find(id => {
      const location = kind === 'statement' ? map[id] : map[id].loc;
      return lines[location.start.line - 1].includes('return flag ? 1 : 2;');
    });
    assert.ok(id !== undefined, `${provider}: retained ${kind}`);
    delete map[id]; delete counters[id];
    const invalidPath = join(work, `${provider}-missing-retained-${kind}.json`);
    json(invalidPath, invalid);
    const rejected = scoreSource(partialSource, invalidPath, 2);
    assert.equal(rejected.complete, false);
  }
  return result;
}
writeFileSync(join(work, 'checks.plain.test.ts'), `import assert from 'node:assert/strict';
import * as partial from './partial';
test('partial coverage hints', () => { ${partialChecks} });
`);
writeFileSync(join(work, 'jest-plain.config.cjs'), `module.exports = {
rootDir: __dirname, testMatch: ['**/checks.plain.test.ts'],
transform: {'^.+\\.tsx?$': [${JSON.stringify(join(plain, 'node_modules/babel-jest'))}, {
configFile: false, babelrc: false,
presets: [${JSON.stringify(join(plain, 'node_modules/@babel/preset-typescript'))}],
plugins: [${JSON.stringify(join(plain, 'node_modules/@babel/plugin-transform-modules-commonjs'))}]}]},
coverageProvider: 'babel', collectCoverageFrom: ['partial.ts'],
coverageReporters: ['json'], coverageDirectory: 'coverage-jest-plain'};
`);
run([join(plain, 'node_modules/jest/bin/jest.js'), '--config', 'jest-plain.config.cjs', '--runInBand', '--coverage']);
results.routes.jest = {partialSuppression: verifyPartial('jest', join(work, 'coverage-jest-plain/coverage-final.json'))};
results.environment.plainJest = JSON.parse(readFileSync(join(plain, 'node_modules/jest/package.json'), 'utf8')).version;
const project = join(work, 'mutation-input'), scratch = join(work, 'mutation-scratch');
mkdirSync(project); mkdirSync(scratch);
const mutationSource = `export function below(value: number) {
  /* istanbul ignore next -- @preserve */
  void value;
  return value < 1;
}
`;
writeFileSync(join(project, 'subject.ts'), mutationSource);
json(join(project, 'package.json'), {private: true, type: 'module'});
writeFileSync(join(project, 'subject.test.mjs'), `import {test} from 'node:test';
import assert from 'node:assert/strict';
import {below} from './subject.ts';
test('boundary', () => { assert.equal(below(0), true); assert.equal(below(1), false); });
`);
const config = join(project, 'seshat.json');
json(config, {source: {include: ['subject.ts']},
  capture: ['package.json', 'subject.ts', 'subject.test.mjs'], mutationOperators: ['comparison'],
  setups: [{name: 'node', runner: 'node', cwd: '.', timeoutMs: 15000,
    typecheck: [process.execPath, join(here, '../node_modules/typescript/bin/tsc'),
      '--ignoreConfig', '--strict', '--noEmit', '--target', 'es2022', 'subject.ts'],
    test: [process.execPath, '--test', '--test-reporter={seshatReporter}', 'subject.test.mjs'],
    coverage: {command: [process.execPath, join(here, 'collect-node.mjs'), 'subject.test.mjs'], report: 'coverage/final.json'}}]});
const checked = spawnSync(binary, ['check', config, scratch], {encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024});
assert.ifError(checked.error);
assert.equal(checked.status, 0, checked.stdout + checked.stderr);
const assessment = JSON.parse(checked.stdout);
assert.equal(assessment.complete, true);
const assessedFunction = assessment.sources[0].result.functions[0];
assert.equal(assessedFunction.status, 'partially-suppressed');
assert.equal(assessedFunction.coverage, 1);
assert.equal(assessedFunction.crap, null);
assert.equal(assessedFunction.pseudoTested, false);
assert.equal(assessment.pseudoTesting.planned, 1);
assert.equal(assessment.pseudoTesting.killed, 1);
assert.equal(assessment.mutation.planned, 2);
assert.equal(assessment.mutation.killed, 2);
assert.equal(assessment.mutation.score, 100);
assert.deepEqual(readdirSync(scratch), []);
assert.equal(readFileSync(join(project, 'subject.ts'), 'utf8'), mutationSource);
results.mutation = {complete: assessment.complete, function: assessedFunction,
  jobsAttempted: assessment.jobsAttempted, workerBaselineJobs: assessment.mutation.workerBaselineJobs,
  phaseTimings: assessment.phaseTimings,
  mutationWallMs: assessment.mutation.mutationWallMs, executionMs: assessment.executionMs, pseudoTesting: {planned: assessment.pseudoTesting.planned, killed: assessment.pseudoTesting.killed},
  operators: assessment.mutation.outcomes.map(({original, replacement, verdict}) => ({original, replacement, verdict}))};
console.log('node: partial coverage retains verified extreme and operator mutation jobs; source and scratch preserved');
const output = resolve(process.env.SESHAT_PROOF_OUTPUT ?? join(work, 'summary.json'));
json(output, results);
console.log(`Results: ${relative(repo, output)}`);
