// Real provider mappings for #64. Run from the repository root.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createRequire} from 'node:module';

const repo = resolve('.');
const require = createRequire(join(repo, 'benchmarks/proofs/package.json'));
const ts = require('../node_modules/typescript');
const instrument = require('istanbul-lib-instrument');
const coverage = require('istanbul-lib-coverage');
const sourceMaps = require('istanbul-lib-source-maps');
const modules = join(repo, 'benchmarks/proofs/node_modules');
const binary = resolve(process.env.SESHAT_PROOF_BINARY ?? 'crates/seshat/target/release/seshat-proofs');
const work = mkdtempSync(join(tmpdir(), 'seshat-coverage-compatibility-'));
const json = (path, value) => writeFileSync(path, JSON.stringify(value));
function run(args) {
  const child = spawnSync(process.execPath, args, {
    cwd: work, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stdout + child.stderr);
}
function score(path, report) {
  const reportPath = join(work, 'score.json');
  json(reportPath, report);
  const child = spawnSync(binary, ['score', path, reportPath], {encoding: 'utf8', timeout: 10000});
  assert.ifError(child.error);
  const result = JSON.parse(child.stdout);
  assert.equal(child.status, result.complete ? 0 : 2, child.stderr);
  return result;
}
function compile(path) {
  const compiled = path.replace(/\.ts$/, '.cjs');
  const result = ts.transpileModule(readFileSync(path, 'utf8'), {fileName: path,
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      sourceMap: true, inlineSources: true}, reportDiagnostics: true});
  assert.equal(result.diagnostics.length, 0);
  const code = result.outputText.replace(/\/\/# sourceMappingURL=.*$/m, '');
  writeFileSync(compiled, code + '\n//# sourceMappingURL=data:application/json;base64,' +
    Buffer.from(result.sourceMapText).toString('base64'));
  const tool = instrument.createInstrumenter();
  writeFileSync(path.replace(/\.ts$/, '.instrumented.cjs'),
    tool.instrumentSync(code, compiled, JSON.parse(result.sourceMapText)));
  return {compiled, code};
}
async function remap(raw) {
  return JSON.parse(JSON.stringify((await sourceMaps.createSourceMapStore().transformCoverage(
    coverage.createCoverageMap(raw))).toJSON()));
}
function uniqueSpans(file) {
  const spans = Object.values(file.statementMap).map(loc => JSON.stringify(loc));
  assert.equal(new Set(spans).size, spans.length);
}

try {
  const source = join(work, 'comments.ts');
  writeFileSync(source, `export const called = () => 1; // trailing line comment
export const uncalled = () => 2; /* trailing block comment */
export class C {
  value = 3; /* trailing field comment */
  called = () => 4; // trailing arrow field comment
  uncalled = () => 5; /* trailing arrow field comment */
}
called();
new C().called();
`);
  // These two generated access callbacks do different work and execute separately.
  // TypeScript maps both to the original method name; equal coordinates are not
  // proof that counters represent the same executable statement.
  const decorated = join(work, 'decorated.ts');
  writeFileSync(decorated, `function dec(value: any, context: any) { context.access.has({}); return value; }
export class D { @dec method() { return 1; } }
new D();
`);
  const commentsCompiled = compile(source);
  const decoratedCompiled = compile(decorated);
  json(join(work, 'package.json'), {private: true, type: 'commonjs'});
  writeFileSync(join(work, 'checks.node.cjs'), `require('./comments.instrumented.cjs');
require('./decorated.instrumented.cjs');
require('node:fs').writeFileSync('node-raw.json', JSON.stringify(globalThis.__coverage__));
`);
  run(['checks.node.cjs']);
  const raw = JSON.parse(readFileSync(join(work, 'node-raw.json'), 'utf8'));
  const node = await remap(raw);
  uniqueSpans(node[source]);
  uniqueSpans(node[decorated]);

  // Remap each real generated statement separately so upstream deduplication
  // cannot obscure the independent counters that collide in the original source.
  const generated = raw[decoratedCompiled.compiled];
  const coincident = [];
  for (const [id, loc] of Object.entries(generated.statementMap)) {
    const single = {...generated, statementMap: {[id]: loc}, s: {[id]: generated.s[id]}};
    const file = (await remap({[decoratedCompiled.compiled]: single}))[decorated];
    for (const mapped of Object.values(file?.statementMap ?? {})) {
      if (mapped.start.line === 2 && mapped.start.column === 22 &&
          mapped.end.line === 2 && mapped.end.column === 28) {
        const line = decoratedCompiled.code.split('\n')[loc.start.line - 1];
        coincident.push({hits: generated.s[id], expression: line.slice(loc.start.column, loc.end.column)});
      }
    }
  }
  assert.deepEqual(coincident, [
    {hits: 1, expression: '"method" in obj'},
    {hits: 0, expression: 'obj.method'},
  ]);
  const mergedId = Object.keys(node[decorated].statementMap).find(id => {
    const loc = node[decorated].statementMap[id];
    return loc.start.line === 2 && loc.start.column === 22 && loc.end.column === 28;
  });
  assert.equal(node[decorated].s[mergedId], 1);

  writeFileSync(join(work, 'checks.jest.cjs'), `require('./comments.cjs');
require('./decorated.cjs');
test('loads fixture', () => {});
`);
  writeFileSync(join(work, 'jest.config.cjs'), `module.exports = {
rootDir: __dirname, testMatch: ['**/checks.jest.cjs'], testEnvironment: 'node',
coverageProvider: 'babel', collectCoverageFrom: ['comments.cjs', 'decorated.cjs'],
coverageReporters: ['json'], coverageDirectory: 'coverage-jest'};
`);
  writeFileSync(join(work, 'checks.vitest.mjs'), `import {test} from ${JSON.stringify(join(modules, 'vitest/dist/index.js'))};
import './comments.ts';
test('loads fixture', () => {});
`);
  const routes = {jest: [join(modules, 'jest/bin/jest.js'), '--config', 'jest.config.cjs', '--runInBand', '--coverage']};
  for (const provider of ['istanbul', 'v8']) {
    writeFileSync(join(work, `vitest-${provider}.config.mjs`), `export default {test: {
include: ['checks.vitest.mjs'], coverage: {provider: '${provider}', include: ['comments.ts'],
reporter: ['json'], reportsDirectory: 'coverage-vitest-${provider}'}}};
`);
    routes[`vitest-${provider}`] = [join(modules, 'vitest/vitest.mjs'), 'run', '--config',
      `vitest-${provider}.config.mjs`, '--coverage', '--maxWorkers=1', '--no-file-parallelism'];
  }
  const reports = {node};
  for (const [provider, args] of Object.entries(routes)) {
    run(args);
    reports[provider] = JSON.parse(readFileSync(join(work, `coverage-${provider}/coverage-final.json`), 'utf8'));
  }
  for (const [provider, report] of Object.entries(reports)) {
    uniqueSpans(report[source]);
    if (report[decorated]) uniqueSpans(report[decorated]);
    const result = score(source, report);
    assert.equal(result.complete, true, `${provider}: ${JSON.stringify(result)}`);
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.functions.filter(row => row.name.startsWith('arrow@'))
      .map(row => [row.covered, row.total]), [[1, 1], [0, 1], [1, 1], [0, 1]], provider);
    if (provider.startsWith('vitest')) {
      assert.ok(Object.values(report[source].statementMap).some(loc =>
        loc.start.line === 1 && loc.start.column === 28 && loc.end.column === null));
    }
    // A duplicate supplied to the core stays ambiguous, including equal counters.
    for (const hits of [0, 1]) {
      const duplicate = structuredClone(report);
      const id = Object.keys(duplicate[source].statementMap)[0];
      duplicate[source].statementMap.extra = structuredClone(duplicate[source].statementMap[id]);
      duplicate[source].s.extra = hits;
      const invalid = score(source, duplicate);
      assert.equal(invalid.complete, false);
      assert.ok(invalid.problems.includes('duplicate statement span'));
    }
    console.log(`${provider}: trailing comments accepted; uncalled arrows remain 0/1; duplicates rejected`);
  }
  run([join(modules, 'c8/bin/c8.js'), '--reporter=json', '--reports-dir=coverage-c8',
    '--include=comments.cjs', process.execPath, commentsCompiled.compiled]);
  const c8 = JSON.parse(readFileSync(join(work, 'coverage-c8/coverage-final.json'), 'utf8'));
  assert.equal(score(source, c8).complete, false, 'c8 line counters are not statement evidence');
  console.log('decorators: distinct generated statements collide at 2:22..2:28 with hits 1 and 0; upstream remapping deduplicates');
  console.log(`Node ${process.version}, TypeScript ${ts.version}; ` +
    ['vitest', 'jest', 'c8', 'istanbul-lib-instrument', 'istanbul-lib-source-maps']
      .map(name => `${name} ${require(`${name}/package.json`).version}`).join(', '));
} finally {
  rmSync(work, {recursive: true, force: true});
}
