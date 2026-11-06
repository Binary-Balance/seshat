// Run against either installed, verified Expo dependency tree without copying it.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const deps = resolve(process.argv[2] ?? join(here, 'fixtures/jest-expo/node_modules'));
const stable = path => path.replaceAll('\\', '/');
const work = mkdtempSync(join(tmpdir(), 'seshat-jest-file-coverage-'));
const write = (name, text) => writeFileSync(join(work, name), text);
try {
  symlinkSync(deps, join(work, 'node_modules'), 'junction');
  write('package.json', JSON.stringify({private:true}));
  write('babel.config.cjs', "module.exports={presets:['babel-preset-expo']};\n");
  const projectRequire = createRequire(join(work, 'package.json'));
  const expo = projectRequire('jest-expo/package.json').version;
  assert.ok(['57.0.5', '57.0.6'].includes(expo));
  assert.equal(projectRequire('jest/package.json').version, '29.7.0');
  const sourceNames = ['body', 'cleanup', 'cold', 'before', 'static', 'other', 'late', 'absent'];
  const candidates = sourceNames.map(name => stable(join(work, `${name}.ts`))).sort();
  write('sources.json', JSON.stringify(candidates));
  for (const name of sourceNames) write(`${name}.ts`, 'export function value() { return 1; }\n');
  write('a.test.tsx', `
import {value} from './body'; import {value as cleanup} from './cleanup';
import {value as cold} from './cold'; import {value as before} from './before';
import {value as loaded} from './static'; loaded();
beforeAll(() => before()); afterAll(() => cleanup());
describe('suite', () => {
  test('duplicate', () => expect(value()).toBe(1));
  test('duplicate', () => expect(typeof cold).toBe('function'));
});
describe('a b', () => test('c', () => {value();}));
describe('a', () => test('b c', () => {value();}));
`);
  write('b.test.tsx', "import {value} from './other'; test('other', () => expect(value()).toBe(1));\n");
  let sequence = 0;
  function run({files = ['a.test.tsx', 'b.test.tsx'], coverage = true, provider = 'babel', workers = false,
    environment = join(here, 'jest-expo-environment.cjs'), reporter = join(here, 'jest-reporter.cjs'),
    selection = '1', projects = false, extraConfig = {}} = {}) {
    const receipt = join(work, `receipt-${++sequence}.json`);
    const common = {preset:'jest-expo', rootDir:work, testMatch:files.map(file => join(work, file)),
      testEnvironment:environment};
    write('jest.config.cjs', `module.exports=${JSON.stringify({
      ...(projects ? {projects:files.map(file => ({...common, testMatch:[join(work, file)]}))} : common),
      reporters:[reporter], coverageProvider:provider, coverageReporters:['json'],
      coverageDirectory:join(work, `coverage-${sequence}`),
      collectCoverageFrom:['*.ts'],
      ...extraConfig,
    })};\n`);
    const env = {...process.env, SESHAT_EXECUTION_ID:`run-${sequence}`, SESHAT_RECEIPT:receipt,
      SESHAT_SOURCES:join(work, 'sources.json'), SESHAT_TEST_SELECTION:selection};
    if (coverage) env.SESHAT_COVERAGE_REPORT = join(work, `coverage-${sequence}/coverage-final.json`);
    else delete env.SESHAT_COVERAGE_REPORT;
    const child = spawnSync(process.execPath, ['--experimental-vm-modules', join(deps, 'jest/bin/jest.js'),
      '--config', join(work, 'jest.config.cjs'), ...(workers ? ['--maxWorkers=2'] : ['--runInBand']),
      ...(coverage ? ['--coverage'] : [])], {cwd:work, env, encoding:'utf8', timeout:30000, maxBuffer:2e6});
    assert.equal(child.error, undefined, child.stderr);
    assert.ok(child.status === 0 || child.status === 1, child.stderr);
    const report = JSON.parse(readFileSync(receipt, 'utf8'));
    const events = readdirSync(work).filter(file => file.startsWith(`receipt-${sequence}.json.events-`) && !file.endsWith('-invalid'))
      .map(file => {
        const raw = readFileSync(join(work, file));
        assert.ok(raw.length <= 16384, `event receipt exceeds 16 KiB: ${raw.length}`);
        return JSON.parse(raw);
      });
    return {report, events, receipt, stderr:child.stderr};
  }
  const full = run();
  assert.equal(full.report.errors, 0, JSON.stringify(full));
  assert.equal(full.report.passed, 5);
  assert.equal(full.report.fileCoverage.complete, true, JSON.stringify(full));
  write('unrelated.test.tsx', "test('unrelated', () => expect(1).toBe(1));\n");
  const unrelated = run({files:['a.test.tsx', 'unrelated.test.tsx']});
  assert.equal(unrelated.report.fileCoverage.complete, true);
  assert.deepEqual(unrelated.report.fileCoverage.files.find(row => row.file.endsWith('/unrelated.test.tsx')).sources, []);
  assert.equal(full.report.tests.filter(test => test.id === '["suite","duplicate"]').length, 2);
  assert.ok(full.report.tests.some(test => test.id === '["a b","c"]'));
  assert.ok(full.report.tests.some(test => test.id === '["a","b c"]'));
  const fileA = full.report.fileCoverage.files.find(file => file.file.endsWith('/a.test.tsx'));
  const byName = Object.fromEntries(fileA.sources.map(source => [source.path.split('/').pop(), source]));
  assert.equal(byName['body.ts'].hit, true);
  assert.equal(byName['cleanup.ts'].hit, true, 'afterAll belongs to the file');
  assert.equal(byName['cold.ts'].hit, false);
  assert.equal(byName['cold.ts'].static, false);
  assert.equal(byName['static.ts'].static, true, 'module initialization forces conservative fallback');
  assert.equal(byName['before.ts'].static, true, 'early hooks are conservatively static');
  assert.equal('other.ts' in byName, false, 'isolated files must not leak coverage');
  assert.equal('absent.ts' in byName, false, 'missing instrumentation is an omission');
  const baseline = run({coverage:false});
  assert.deepEqual(baseline.report.tests, full.report.tests);
  assert.equal('fileCoverage' in baseline.report, false);
  assert.deepEqual(run({workers:true}).report.fileCoverage, full.report.fileCoverage);
  const selected = run({files:['a.test.tsx'], coverage:false});
  assert.equal(selected.report.passed, 4);
  assert.deepEqual(selected.report.tests, full.report.tests.filter(test => test.file.endsWith('/a.test.tsx')));
  assert.equal('fileCoverage' in run({selection:'0'}).report, false);
  assert.equal(run({provider:'v8'}).report.fileCoverage?.complete, false);
  assert.equal('testFiles' in run({projects:true}).report, false);
  write('transformer.cjs', "module.exports=require('babel-jest').createTransformer();\n");
  const customTransform = run({extraConfig:{transform:{'\\.[jt]sx?$':join(work, 'transformer.cjs')}}});
  assert.equal(customTransform.report.passed, 5);
  assert.equal(customTransform.report.errors, 0);
  assert.equal(customTransform.report.fileCoverage.complete, false);
  write('global-hook.cjs', 'module.exports=async()=>{};\n');
  for (const hook of ['globalSetup', 'globalTeardown']) {
    assert.equal('tests' in run({extraConfig:{[hook]:join(work, 'global-hook.cjs')}}).report, false);
  }
  console.log(`Expo ${expo}: inventories, workers, hooks and configuration fallbacks passed.`);

  write('case.test.tsx', "test('V8 has no Istanbul observer',()=>expect((globalThis as any).__coverage__).toBeUndefined());\n");
  const noV8Observer = run({files:['case.test.tsx'], provider:'v8'});
  assert.equal(noV8Observer.report.passed, 1);
  assert.equal(noV8Observer.report.errors, 0);
  assert.equal(noV8Observer.report.fileCoverage.complete, false);
  write('case.test.tsx', "import {value} from './body'; test('assertion', () => expect(value()).toBe(2));\n");
  const assertion = run({files:['case.test.tsx']});
  assert.equal(assertion.report.failed, 1);
  assert.equal(assertion.report.errors, 0);
  assert.equal(assertion.report.fileCoverage.complete, true);
  assert.deepEqual(assertion.report.tests.map(test => test.id), ['["assertion"]']);
  for (const hook of ['beforeAll', 'beforeEach']) {
    write('case.test.tsx', `${hook}(() => {throw new Error('setup');}); test('never entered', () => {});\n`);
    const failed = run({files:['case.test.tsx']});
    assert.equal(failed.report.failed, 1);
    assert.ok(failed.report.errors > 0);
    assert.deepEqual(failed.events[0].selection.entered, []);
    assert.deepEqual(failed.events[0].selection.completed, []);
    assert.equal('tests' in failed.report, false);
  }
  write('case.test.tsx', "test('timeout', () => new Promise(() => {}), 20);\n");
  const timeout = run({files:['case.test.tsx']});
  assert.equal(timeout.report.timeouts, 1);
  assert.equal(timeout.report.errors, 0);
  assert.equal('tests' in timeout.report, false);
  write('case.test.tsx', "import {value} from './body'; afterEach(()=>{throw new Error('cleanup');}); test('cleanup',()=>{value();});\n");
  const cleanupFailure = run({files:['case.test.tsx']});
  assert.equal(cleanupFailure.report.failed, 1);
  assert.equal(cleanupFailure.report.errors, 1);
  assert.equal(cleanupFailure.report.testHookErrors, 1);
  for (const code of ["test.skip('skip', () => {}); test.todo('todo');", '',
    "test.concurrent('parallel', async () => {});"]) {
    write('case.test.tsx', code);
    assert.equal('tests' in run({files:['case.test.tsx']}).report, false);
  }
  for (const operation of [
    `for(const counts of [source.s,source.f]) for(const key in counts) counts[key]=0; value(); value();`,
    `delete globalThis.__coverage__[require.resolve('./body')];`,
    `globalThis.__coverage__ = {};`,
    `delete globalThis.__coverage__;`,
    `source.s = {...source.s};`,
  ]) {
    write('case.test.tsx', `import {value} from './body'; test('integrity', () => {
      value(); const source=(globalThis as any).__coverage__[require.resolve('./body')]; ${operation}
    });\n`);
    const erased = run({files:['case.test.tsx']});
    assert.equal(erased.report.passed, 1, erased.stderr);
    assert.equal(erased.report.errors, 0);
    assert.equal(erased.report.fileCoverage.complete, false, operation);
  }
  write('case.test.tsx', `test('late', async () => {
    const {value}=await import('./late'); expect(value()).toBe(1);
  });\n`);
  const late = run({files:['case.test.tsx']});
  assert.equal(late.report.fileCoverage.complete, true);
  assert.deepEqual(late.report.fileCoverage.files[0].sources, [{path:stable(join(work, 'late.ts')), hit:true, static:false}]);
  write('case.test.tsx', `test('late delete', async () => {
    const {value}=await import('./late'); value(); delete (globalThis as any).__coverage__[require.resolve('./late')];
  });\n`);
  const lostLate = run({files:['case.test.tsx']});
  assert.equal(lostLate.report.passed, 1);
  assert.equal(lostLate.report.errors, 0);
  assert.equal(lostLate.report.fileCoverage.complete, false);
  console.log(`Expo ${expo}: body failures, timeouts and counter integrity passed.`);

  write('case.test.tsx', `import {value} from './body';
    (globalThis as any).probeTeardown=()=>value(); test('teardown',()=>{});\n`);
  write('environment.cjs', `const Base=require(${JSON.stringify(join(here, 'jest-expo-environment.cjs'))});
    module.exports=class extends Base {async teardown(){this.global.probeTeardown?.(); await super.teardown();}};\n`);
  const teardown = run({files:['case.test.tsx'], environment:join(work, 'environment.cjs')});
  assert.equal(teardown.report.passed, 1);
  assert.equal(teardown.report.errors, 0);
  assert.equal('tests' in teardown.report, false, 'custom environments fall back');
  const key = createHash('sha256').update(join(work, 'case.test.tsx')).digest('hex');
  assert.equal(readFileSync(`${teardown.receipt}.events-${key}-invalid`, 'utf8'), '');
  write('environment.cjs', `const Base=require(${JSON.stringify(join(here, 'jest-expo-environment.cjs'))});
    module.exports=class extends Base {async teardown(){delete this.global.__coverage__; await super.teardown();}};\n`);
  const deletedTeardown = run({files:['case.test.tsx'], environment:join(work, 'environment.cjs')});
  assert.equal(readFileSync(`${deletedTeardown.receipt}.events-${key}-invalid`, 'utf8'), '',
    'final teardown recheck detects deletion of the global watcher');
  write('environment.cjs', `const Base=require(${JSON.stringify(join(here, 'jest-expo-environment.cjs'))});
    module.exports=class extends Base {
      async handleTestEvent(event,state){await super.handleTestEvent(event,state);
        if(event.name==='run_finish')require('node:fs').mkdirSync(process.env.SESHAT_RECEIPT+'.events-'+this.key+'-invalid');}
      async teardown(){this.global.probeTeardown?.(); await super.teardown();}
    };\n`);
  const markerIoFailure = run({files:['case.test.tsx'], environment:join(work, 'environment.cjs')});
  assert.ok(markerIoFailure.report.errors > 0, 'late-marker IO failures remain infrastructure errors');
  assert.equal(markerIoFailure.report.failed, 0, 'late-marker IO failures must not become assertion kills');

  write('case.test.tsx', "import {value} from './body'; test('body', () => {value();});\n");
  write('reporter.cjs', `const fs=require('node:fs'),crypto=require('node:crypto');
    const Base=require(${JSON.stringify(join(here, 'jest-reporter.cjs'))});
    module.exports=class extends Base {onRunComplete(contexts,results){
      const key=crypto.createHash('sha256').update(results.testResults[0].testFilePath).digest('hex');
      fs.writeFileSync(process.env.SESHAT_RECEIPT+'.events-'+key+'-invalid','',{flag:'wx'});
      super.onRunComplete(contexts,results);
    }};\n`);
  assert.equal(run({files:['case.test.tsx'], reporter:join(work, 'reporter.cjs')}).report.fileCoverage.complete, false,
    'root checks late invalidation after workers finish');
  write('reporter.cjs', `const fs=require('node:fs'),crypto=require('node:crypto');
    const Base=require(${JSON.stringify(join(here, 'jest-reporter.cjs'))});
    module.exports=class extends Base {onRunComplete(contexts,results){
      const key=crypto.createHash('sha256').update(results.testResults[0].testFilePath).digest('hex');
      const path=process.env.SESHAT_RECEIPT+'.events-'+key;
      const event=JSON.parse(fs.readFileSync(path,'utf8')); event.selection.completed.push(event.selection.completed[0]);
      fs.writeFileSync(path,JSON.stringify(event)); super.onRunComplete(contexts,results);
    }};\n`);
  const changed = run({files:['case.test.tsx'], reporter:join(work, 'reporter.cjs')});
  assert.equal(changed.report.passed, 1);
  assert.equal(changed.report.errors, 0, 'selection-only corruption preserves ordinary verdicts');
  assert.equal('tests' in changed.report, false, 'duplicate identity multiplicity is reconciled');
  write('case.test.tsx', Array.from({length:4}, (_, i) => `test(${JSON.stringify(`${i}${'x'.repeat(4000)}`)}, () => {});`).join('\n'));
  const overflow = run({files:['case.test.tsx']});
  assert.equal(overflow.report.passed, 4);
  assert.equal(overflow.report.errors, 0);
  assert.equal('selection' in overflow.events[0], false);
  assert.equal('tests' in overflow.report, false);
  write('sources.json', JSON.stringify(Array.from({length:800}, (_, i) => stable(join(work, `unloaded-${i}.ts`)))));
  write('case.test.tsx', "test('short name',()=>{});\n");
  const sourceOverflow = run({files:['case.test.tsx']});
  assert.equal(sourceOverflow.report.passed, 1);
  assert.equal(sourceOverflow.report.errors, 0);
  assert.equal('selection' in sourceOverflow.events[0], false, 'final source payload is bounded too');
  console.log(`Jest 29.7 / Expo ${expo} selection checks passed: file ownership, bodies, hooks, integrity, late writes and bounded receipts.`);
} finally {
  rmSync(work, {recursive:true, force:true});
}
