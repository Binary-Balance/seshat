import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const stable = path => path.replaceAll('\\', '/');
const previousCwd = process.cwd();
process.chdir(here);
const {beginFileCoverage} = await import('./vitest-runner.mjs');
process.chdir(previousCwd);

const path = join(tmpdir(), 'subject.js');
const absent = join(tmpdir(), 'absent.js');
const entry = () => ({path, hash:'hash', fnMap:{0:{}}, statementMap:{0:{}}, f:{0:0}, s:{0:1}});
function checkCounters(change, expected, initial = entry()) {
  const coverage = {[path]:initial};
  const evidence = beginFileCoverage([path, absent], coverage);
  change(coverage, initial);
  const result = evidence.finish(coverage);
  assert.equal(result.complete, expected);
  return {result, initial};
}

const runtime = checkCounters((_, source) => source.f[0]++, true);
assert.deepEqual(runtime.result.sources, [{path, hit:true, static:false}]);
assert.equal(Object.getOwnPropertyDescriptor(runtime.initial.f, '0').get, undefined);
const staticSource = entry(); staticSource.f[0] = 1;
assert.deepEqual(checkCounters(() => {}, true, staticSource).result.sources, [{path, hit:false, static:true}]);
assert.deepEqual(checkCounters((_, source) => source.s[0]++, true).result.sources, [{path, hit:true, static:false}]);
checkCounters((_, source) => { source.f[0]++; source.f[0] = 0; source.f[0] += 2; }, false);
checkCounters((_, source) => { source.s = {0:10}; }, false);
checkCounters((coverage, source) => { coverage[path] = {...source}; }, false);
checkCounters((_, source) => { source.fnMap[1] = {}; }, false);
checkCounters((_, source) => { source.f[0] = NaN; }, false);
checkCounters((coverage, source) => { coverage[absent] = {...source, path:absent}; }, false);
checkCounters((coverage, source) => { coverage[absent] = {...source}; }, false);
checkCounters((coverage, source) => { coverage[`${path}?variant`] = {...source, path:`${path}?variant`}; }, false);
const incomplete = entry(); delete incomplete.s[0];
checkCounters(() => {}, false, incomplete);
assert.equal(beginFileCoverage([path], undefined).finish(undefined).complete, false);
const original = {[path]:entry()};
assert.equal(beginFileCoverage([path], original).finish({...original}).complete, false);

const work = mkdtempSync(join(tmpdir(), 'seshat-vitest-file-coverage-'));
try {
  symlinkSync(join(here, 'node_modules'), join(work, 'node_modules'), 'junction');
  writeFileSync(join(work, 'package.json'), JSON.stringify({private:true, type:'module'}));
  const sourceNames = ['before', 'beforeEach', 'after', 'afterEach', 'around', 'aroundEach',
    'cleanup', 'finished', 'fixture', 'body', 'static', 'cold', 'absent'];
  const sources = sourceNames.map(name => stable(join(work, `${name}.js`))).sort();
  writeFileSync(join(work, 'sources.json'), JSON.stringify(sources));
  for (const name of sourceNames) writeFileSync(join(work, `${name}.js`), 'export function value() { return 1; }\n');
  const imports = sourceNames.filter(name => name !== 'absent')
    .map(name => `import {value as ${name}Value} from './${name}.js';`).join('\n');
  writeFileSync(join(work, 'a.test.js'), `
import {beforeAll, beforeEach, afterAll, afterEach, aroundAll, aroundEach, describe, test, expect, onTestFinished} from 'vitest';
${imports}
staticValue();
beforeAll(() => { beforeValue(); return () => cleanupValue(); });
beforeEach(() => beforeEachValue());
afterAll(() => afterValue());
afterEach(() => afterEachValue());
aroundAll(async run => { await run(); aroundValue(); });
aroundEach(async run => { await run(); aroundEachValue(); });
const fixtureTest = test.extend({resource:[async ({}, use) => { await use(1); fixtureValue(); }, {scope:'file'}]});
describe('suite 🎸', () => {
  fixtureTest('exact > name', ({resource}) => {
    onTestFinished(() => finishedValue()); expect(bodyValue()).toBe(resource);
  });
});
`);
  writeFileSync(join(work, 'b.test.js'), `import {test, expect} from 'vitest';\n${imports}\ntest('second', () => expect(bodyValue()).toBe(1));\n`);
  let runNumber = 0;
  function run({files = ['a.test.js', 'b.test.js'], options = '', provider = 'istanbul', coverage = true,
    selection = '1', extra = '', coverageOptions = ''} = {}) {
    const receipt = join(work, `receipt-${++runNumber}.json`);
    writeFileSync(join(work, 'vitest.config.mjs'), `${extra}\nexport default {test:{
      runner:${JSON.stringify(join(here, 'vitest-runner.mjs'))}, include:${JSON.stringify(files)},
      maxWorkers:1, fileParallelism:false, maxConcurrency:1,
      coverage:{provider:${JSON.stringify(provider)}, include:['*.js'], exclude:['*.test.js','vitest.config.mjs'],
        reporter:['json'], reportsDirectory:'coverage', ${coverageOptions}}, ${options}}};\n`);
    const env = {...process.env, SESHAT_EXECUTION_ID:`run-${runNumber}`, SESHAT_RECEIPT:receipt,
      SESHAT_SOURCES:join(work, 'sources.json'), SESHAT_TEST_SELECTION:selection};
    if (coverage) env.SESHAT_COVERAGE_REPORT = join(work, 'coverage/coverage-final.json');
    else delete env.SESHAT_COVERAGE_REPORT;
    const child = spawnSync(process.execPath, [join(here, 'node_modules/vitest/vitest.mjs'), 'run',
      '--config', join(work, 'vitest.config.mjs'), '--reporter', join(here, 'vitest-reporter.mjs'),
      ...(coverage ? ['--coverage'] : [])], {cwd:work, env, encoding:'utf8', timeout:30000});
    assert.equal(child.error, undefined, child.stderr);
    assert.ok(child.status === 0 || child.status === 1, child.stderr);
    const result = JSON.parse(readFileSync(receipt, 'utf8'));
    return result;
  }

  const full = run();
  const merged = JSON.parse(readFileSync(join(work, 'coverage/coverage-final.json'), 'utf8'));
  assert.ok(Object.values(merged[stable(join(work, 'absent.js'))].s).every(count => count === 0));
  assert.equal(full.errors, 0, JSON.stringify(full));
  assert.equal(full.passed, 2);
  assert.deepEqual(full.testFiles, ['a.test.js', 'b.test.js'].map(file => stable(join(work, file))));
  assert.deepEqual(full.tests, [
    {file:stable(join(work, 'a.test.js')), id:'suite 🎸 > exact > name'},
    {file:stable(join(work, 'b.test.js')), id:'second'},
  ]);
  assert.equal(full.fileCoverage.complete, true, JSON.stringify(full));
  for (const row of full.fileCoverage.files) {
    assert.deepEqual(row.sources.map(source => source.path), sources.filter(path => basename(path) !== 'absent.js'));
    const byName = Object.fromEntries(row.sources.map(source => [basename(source.path), source]));
    const first = basename(row.file) === 'a.test.js';
    for (const name of ['before', 'beforeEach', 'after', 'afterEach', 'around', 'aroundEach', 'cleanup', 'finished', 'fixture']) {
      assert.equal(byName[`${name}.js`].hit, first);
    }
    assert.equal(byName['body.js'].hit, true);
    assert.equal(byName['static.js'].static, first);
    assert.equal(byName['static.js'].hit, false);
    assert.equal(byName['cold.js'].hit, false);
    assert.equal(byName['cold.js'].static, false);
  }
  assert.equal('fileCoverage' in run({selection:'0'}), false);
  assert.equal('fileCoverage' in run({coverage:false}), false);
  assert.deepEqual(run({provider:'v8'}).fileCoverage, {version:1, complete:false, files:[]});
  assert.deepEqual(run({options:'isolate:false'}).fileCoverage, {version:1, complete:false, files:[]});
  const custom = run({extra:"import {createInstrumenter} from '@vitest/istanbul-lib-instrument';",
    coverageOptions:`instrumenter:options=>createInstrumenter({...options, produceSourceMap:true,
      autoWrap:false, esModules:true, compact:false, coverageGlobalScope:'globalThis', coverageGlobalScopeFunc:false,
      ignoreLines:true})`});
  assert.equal(custom.passed, 2);
  assert.deepEqual(custom.fileCoverage, {version:1, complete:false, files:[]});

  writeFileSync(join(work, 'no-counters.test.js'), "import {test} from 'vitest';test('no counters', () => {});\n");
  const noCounters = run({files:['no-counters.test.js']});
  assert.equal(noCounters.fileCoverage.complete, true);
  assert.deepEqual(noCounters.fileCoverage.files, [{file:stable(join(work, 'no-counters.test.js')), sources:[]}]);

  writeFileSync(join(work, 'duplicate.test.js'), `import {test} from 'vitest';\nimport {value} from './body.js';
test('duplicate', () => value());\ntest('duplicate', () => value());\n`);
  const duplicate = run({files:['duplicate.test.js']});
  assert.equal(duplicate.passed, 2);
  assert.equal(duplicate.fileCoverage.complete, true);
  assert.deepEqual(duplicate.tests, Array.from({length:2}, () => ({file:stable(join(work, 'duplicate.test.js')), id:'duplicate'})));

  writeFileSync(join(work, 'query.test.js'), `import {test, expect} from 'vitest';
import {value} from './body.js?variant';test('query import', () => expect(value()).toBe(1));\n`);
  const query = run({files:['duplicate.test.js','query.test.js']});
  assert.equal(query.passed, 3);
  assert.deepEqual(query.fileCoverage, {version:1, complete:false, files:[]});

  writeFileSync(join(work, 'reset.test.js'), `import {test} from 'vitest';
import {value} from './body.js';
test('reset', () => {
  value();
  const source = globalThis.__VITEST_COVERAGE__[${JSON.stringify(stable(join(work, 'body.js')))}];
  for (const counters of [source.f, source.s]) for (const key of Object.keys(counters)) counters[key] = 0;
  value(); value();
});\n`);
  const reset = run({files:['reset.test.js']});
  assert.equal(reset.passed, 1);
  assert.equal(reset.errors, 0);
  assert.deepEqual(reset.fileCoverage, {version:1, complete:false, files:[]});

  writeFileSync(join(work, 'skip.test.js'), `import {test} from 'vitest';\nimport './body.js';\ntest.skip('skip', () => {});\n`);
  const skipped = run({files:['a.test.js', 'skip.test.js']});
  assert.equal(skipped.passed, 1);
  assert.equal(skipped.errors, 1);
  assert.equal(skipped.testFiles.length, 2);
  assert.equal(skipped.tests.length, 1);
  assert.deepEqual(skipped.fileCoverage, {version:1, complete:false, files:[]});

  writeFileSync(join(work, 'failure.test.js'), `import {test, expect, afterEach} from 'vitest';
import {value} from './body.js';
test('assertion', () => expect(value()).toBe(2));\n`);
  const failure = run({files:['failure.test.js']});
  assert.equal(failure.failed, 1);
  assert.equal(failure.errors, 0);
  assert.deepEqual(failure.tests, [{file:stable(join(work, 'failure.test.js')), id:'assertion'}]);
  writeFileSync(join(work, 'failure.test.js'), `import {test, afterEach} from 'vitest';
import {value} from './body.js';
afterEach(() => { throw new Error('cleanup failure'); });
test('cleanup', () => value());\n`);
  const cleanupFailure = run({files:['failure.test.js']});
  assert.equal(cleanupFailure.failed, 0);
  assert.equal(cleanupFailure.errors, 1);
  assert.deepEqual(cleanupFailure.fileCoverage, {version:1, complete:false, files:[]});
  console.log('Vitest file coverage checks passed: counters, hook ordering, static calls, identities and conservative fallbacks.');
} finally {
  rmSync(work, {recursive:true, force:true});
}
