import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {after, test} from 'node:test';
import {linkSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import reporter from './node-reporter.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'seshat-node-file-coverage-'));
after(() => rmSync(work, {recursive:true, force:true}));
const write = (name, contents) => writeFileSync(join(work, name), contents);
const require = createRequire(import.meta.url);
const {createInstrumenter} = require('istanbul-lib-instrument');
const sources = ['body', 'cleanup', 'late', 'cold'].map(name => join(work, `${name}.mjs`));
write('package.json', JSON.stringify({private:true, type:'module'}));
write('sources.json', JSON.stringify(sources));
const prepared = {};
for (const path of sources) {
  const source = 'export function value() { return 1; }\n';
  writeFileSync(path, source);
  const tool = createInstrumenter({esModules:true});
  prepared[pathToFileURL(path).href] = tool.instrumentSync(source, path);
}
write('instrument.mjs', `import {registerHooks} from 'node:module';
const prepared=${JSON.stringify(prepared)};
registerHooks({load(url,context,next){return Object.hasOwn(prepared,url)
  ? {format:'module',shortCircuit:true,source:prepared[url]} : next(url,context);}});`);
write('plain.mjs', "console.log('plain only');\n");
let runNumber = 0;
function run(code, {other, options = [], helper = true, selection = '1', istanbul = true, loadSource} = {}) {
  const receipt = join(work, `receipt-${++runNumber}.json`);
  write('a.test.mjs', code);
  const files = ['a.test.mjs'];
  if (other !== undefined) { write('b.test.mjs', other); files.push('b.test.mjs'); }
  const env = {...process.env, SESHAT_RECEIPT:receipt, SESHAT_EXECUTION_ID:`node-${runNumber}`,
    SESHAT_TEST_SELECTION:selection, SESHAT_SOURCES:join(work, 'sources.json'),
    SESHAT_COVERAGE_REPORT:join(work, 'coverage.json'),
    SESHAT_NODE_ISTANBUL:istanbul ? '1' : '0',
    NODE_OPTIONS:[`--import=${pathToFileURL(join(here, 'node-load-observer.mjs')).href}`,
      ...(helper ? [`--import=${pathToFileURL(join(here, 'node-file-coverage.mjs')).href}`] : [])].join(' ')};
  delete env.SESHAT_NODE_TEST_PARENT;
  delete env.NODE_TEST_CONTEXT;
  delete env.SESHAT_LOAD_CONTEXT;
  if (loadSource) {
    env.SESHAT_LOAD_CONTEXT = join(work, `load-${runNumber}.json`);
    writeFileSync(env.SESHAT_LOAD_CONTEXT, JSON.stringify({executionId:env.SESHAT_EXECUTION_ID,
      sources:[{source:loadSource, sites:[[1, 0, 1, 200]]}]}));
  }
  const child = spawnSync(process.execPath, ['--import', pathToFileURL(join(work, 'instrument.mjs')).href,
    '--test', ...options, `--test-reporter=${pathToFileURL(join(here, 'node-reporter.mjs')).href}`, ...files],
    {cwd:work, env, encoding:'utf8', timeout:12000, maxBuffer:1024 * 1024});
  assert.ifError(child.error);
  assert.ok(child.status === 0 || child.status === 1, child.stdout + child.stderr);
  return {child, receipt, result:JSON.parse(readFileSync(receipt, 'utf8'))};
}
const prelude = "import {test} from 'node:test';import {value} from './body.mjs';\n";

test('unknown collectors retain their globals and fall back without attribution', () => {
  const {result} = run("import {test} from 'node:test';import assert from 'node:assert/strict';test('unmodified globals',()=>assert.equal(globalThis.__coverage__,undefined));",
    {istanbul:false});
  assert.deepEqual([result.passed,result.failed,result.errors],[1,0,0]);
  assert.equal(result.fileCoverage.complete,false);
});

test('a collector can revoke attribution after a noncanonical source load', () => {
  const {result}=run(prelude+"test('revoked',()=>{value();process.env.SESHAT_NODE_ISTANBUL='0';});");
  assert.deepEqual([result.passed,result.failed,result.errors],[1,0,0]);
  assert.equal(result.fileCoverage.complete,false);
});

test('real concurrent identities belong to entry files and retain duplicate ancestry', () => {
  write('shared.mjs', "import {test} from 'node:test';import {value} from './body.mjs';export function shared(){test('duplicate',()=>value());}");
  const {result, child} = run(`import {test,describe,after} from 'node:test';
import {shared} from './shared.mjs';import {value} from './body.mjs';import {value as cleanup} from './cleanup.mjs';
describe('outer',()=>{shared();test('duplicate',()=>value());});
test('parent',{concurrency:true},async t=>{await Promise.all([t.test('duplicate',()=>value()),t.test('duplicate',()=>value())]);});
after(()=>cleanup());`, {other:prelude + "test('other',()=>value());"});
  assert.equal(child.status, 0);
  assert.deepEqual([result.passed, result.failed, result.errors], [6, 0, 0]);
  assert.deepEqual(result.testFiles, ['a.test.mjs', 'b.test.mjs'].map(name => join(work, name)));
  assert.deepEqual(result.tests, [
    ...Array.from({length:2}, () => ({file:join(work, 'a.test.mjs'), id:'["outer","duplicate"]'})),
    ...Array.from({length:2}, () => ({file:join(work, 'a.test.mjs'), id:'["parent","duplicate"]'})),
    {file:join(work, 'a.test.mjs'), id:'["parent"]'},
    {file:join(work, 'b.test.mjs'), id:'["other"]'},
  ].sort((a, b) => a.file.localeCompare(b.file) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  assert.equal(result.fileCoverage.complete, true, JSON.stringify(result));
  assert.deepEqual(result.fileCoverage.files[0].sources, [sources[0], sources[1]].map(path => ({path, hit:true, static:false})));
  assert.deepEqual(result.fileCoverage.files[1].sources, [{path:sources[0], hit:true, static:false}]);
});

test('structured ancestry distinguishes names containing separators', () => {
  const {result} = run(`import {describe,test} from 'node:test';
describe('a > b',()=>test('c',()=>{}));describe('a',()=>test('b > c',()=>{}));`);
  assert.deepEqual(result.tests.map(test => test.id), ['["a > b","c"]', '["a","b > c"]']);
});

test('empty wrappers, suites, skipped and todo declarations are not executions', () => {
  const empty = run('// no tests').result;
  assert.deepEqual([empty.passed, empty.failed, empty.errors], [0, 0, 0]);
  assert.equal(empty.tests, undefined);
  const skipped = run("import {describe,test} from 'node:test';describe('suite',()=>{test.skip('skip',()=>{});test.todo('todo');});").result;
  assert.deepEqual([skipped.passed, skipped.failed, skipped.errors], [0, 0, 0]);
  assert.deepEqual(skipped.tests, []);
  assert.equal(skipped.fileCoverage.complete, false);
});

test('assertion failures retain identities while hook failures remain errors', () => {
  const assertion = run(prelude + "test('assertion',()=>{value();throw Error('assertion');});").result;
  assert.deepEqual([assertion.passed, assertion.failed, assertion.errors], [0, 1, 0]);
  assert.deepEqual(assertion.tests, [{file:join(work, 'a.test.mjs'), id:'["assertion"]'}]);
  const hook = run(prelude + "import {before} from 'node:test';before(()=>{throw Error('setup');});test('never entered',()=>value());").result;
  assert.equal(hook.failed, 0);
  assert.ok(hook.errors > 0);
  assert.equal(hook.tests, undefined);
  assert.equal(hook.fileCoverage.complete, false);
});

test('runner timeout errors keep the existing verdict and disable identities', () => {
  const {result, child} = run(prelude + "test('timeout',{timeout:10},()=>new Promise(resolve=>setTimeout(resolve,100)));");
  assert.equal(child.status, 1);
  assert.deepEqual([result.passed, result.failed, result.errors], [0, 0, 1]);
  assert.equal(result.tests, undefined);
  assert.equal(result.fileCoverage.complete, false);
});

test('fatal-import attribution composes with the helper without inventing a test', () => {
  const source = join(work, 'fatal.mjs');
  writeFileSync(source, "export function boom(){throw new Error('fatal import');}boom();\n");
  const {result, child} = run("import './fatal.mjs';", {loadSource:source});
  assert.equal(child.status, 1);
  assert.deepEqual([result.passed, result.failed, result.errors], [0, 1, 0]);
  assert.equal(result.moduleFailures.length, 1);
  assert.equal(result.moduleFailures[0].source, source);
  assert.equal(result.tests, undefined);
  assert.equal(result.fileCoverage.complete, false);
});

test('late imports and cleanup are included; early calls force static fallback', () => {
  const late = run("import {test} from 'node:test';test('late',async()=>{(await import('./late.mjs')).value();});").result;
  assert.deepEqual(late.fileCoverage.files[0].sources, [{path:sources[2], hit:true, static:false}]);
  const module = run(prelude + "value();test('module',()=>{});").result;
  assert.deepEqual(module.fileCoverage.files[0].sources, [{path:sources[0], hit:false, static:true}]);
  const exit = run(prelude + "process.on('exit',()=>value());test('exit cleanup',()=>{});").result;
  assert.deepEqual(exit.fileCoverage.files[0].sources, [{path:sources[0], hit:true, static:false}]);
});

for (const [name, code] of [
  ['reset then reincrement', `value();globalThis.__coverage__[${JSON.stringify(sources[0])}].f[0]=0;value();value();`],
  ['replace root', 'value();globalThis.__coverage__={};'],
  ['delete late source', `const late=await import('./late.mjs');late.value();delete globalThis.__coverage__[${JSON.stringify(sources[2])}];`],
  ['delete root at exit', "process.on('exit',()=>{delete globalThis.__coverage__;});value();"],
  ['source execution after an application exit wrapper', `const emit=process.emit;process.emit=function(event,...args){const result=Reflect.apply(emit,this,[event,...args]);if(event==='exit')value();return result;};`],
  ['delete root after an application exit wrapper', `const emit=process.emit;process.emit=function(event,...args){const result=Reflect.apply(emit,this,[event,...args]);if(event==='exit')delete globalThis.__coverage__;return result;};`],
]) {
  test(`${name} disables selection without changing a passing verdict`, () => {
    const {result, child} = run(prelude + `test('integrity',async()=>{${code}});`);
    assert.equal(child.status, 0);
    assert.deepEqual([result.passed, result.failed, result.errors], [1, 0, 0]);
    assert.deepEqual(result.fileCoverage, {version:1, complete:false, files:[]});
  });
}

test('missing helper and unsupported isolation fall back with ordinary verdicts', () => {
  const missing = run(prelude + "test('ok',()=>value());", {helper:false}).result;
  assert.equal(missing.passed, 1);
  assert.equal(missing.errors, 0);
  assert.deepEqual(missing.fileCoverage, {version:1, complete:false, files:[]});
  const isolation = run(prelude + "test('ok',()=>value());", {options:['--test-isolation=none']}).result;
  assert.deepEqual([isolation.passed, isolation.failed, isolation.errors], [1, 0, 0]);
  assert.equal(isolation.tests, undefined);
  assert.equal(isolation.fileCoverage.complete, false);
});

test('ordinary programs and test descendants do not start an extra harness', () => {
  const receipt = join(work, 'plain-receipt.json');
  const child = spawnSync(process.execPath, ['plain.mjs'], {cwd:work, encoding:'utf8', timeout:12000,
    env:{...process.env, NODE_TEST_CONTEXT:'child-v8', SESHAT_EXECUTION_ID:'plain', SESHAT_RECEIPT:receipt,
      SESHAT_SOURCES:join(work, 'sources.json'), SESHAT_COVERAGE_REPORT:join(work, 'coverage.json'),
      SESHAT_TEST_SELECTION:'1', SESHAT_NODE_TEST_PARENT:JSON.stringify({pid:1, executionId:'plain'}),
      NODE_OPTIONS:`--import=${pathToFileURL(join(here, 'node-file-coverage.mjs')).href}`}});
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'plain only\n');
  assert.equal(readdirSync(work).some(name => name.startsWith('plain-receipt.json.events-')), false);
  const nested = run(`import {test} from 'node:test';import {spawnSync} from 'node:child_process';
test('descendant',()=>{const r=spawnSync(process.execPath,['plain.mjs'],{encoding:'utf8'});
if(r.status!==0||r.stdout!=='plain only\\n')throw Error(r.stdout+r.stderr);});`).result;
  assert.deepEqual([nested.passed, nested.failed, nested.errors], [1, 0, 0]);
  assert.equal(nested.fileCoverage.complete, true);
});

test('baseline and selection-disabled jobs preserve real identities without coverage data', () => {
  const {result} = run(prelude + "test('baseline',()=>value());", {selection:'0'});
  assert.deepEqual(result.tests, [{file:join(work, 'a.test.mjs'), id:'["baseline"]'}]);
  assert.equal(result.fileCoverage, undefined);
});

test('required child evidence write failures remain infrastructure errors', () => {
  const {result, child} = run(`import {test} from 'node:test';import {mkdirSync} from 'node:fs';
test('blocked evidence',()=>mkdirSync(process.env.SESHAT_RECEIPT+'.events-node-'+process.pid+'.json'));`);
  assert.equal(child.status, 1);
  assert.equal(result.failed, 0);
  assert.ok(result.errors > 0);
  assert.equal(result.fileCoverage.complete, false);
});

test('oversized optional identities preserve bounded ordinary counts', () => {
  const {result, receipt} = run(`import {test} from 'node:test';for(let i=0;i<100;i++)test('long '+i+'x'.repeat(200),()=>{});`);
  assert.equal(result.passed, 100);
  assert.equal(result.errors, 0);
  assert.equal(result.tests, undefined);
  assert.ok(Buffer.byteLength(readFileSync(receipt)) <= 16384);
});

test('unsafe, stale, duplicate, malformed and late-invalid child records cause fallback', async () => {
  const file = join(work, 'unit.test.mjs');
  const oldEnv = {...process.env};
  try {
    for (const kind of ['valid', 'stale', 'duplicate', 'symlink', 'hardlink', 'oversized', 'malformed', 'late-invalid']) {
      const receipt = join(work, `unit-${kind}.json`), proof = `${receipt}.events-node-111.json`;
      Object.assign(process.env, {SESHAT_RECEIPT:receipt, SESHAT_EXECUTION_ID:'unit', SESHAT_SOURCES:join(work, 'sources.json'),
        SESHAT_TEST_SELECTION:'1', SESHAT_COVERAGE_REPORT:join(work, 'coverage.json')});
      const value = {version:1, executionId:kind === 'stale' ? 'old' : 'unit', file, pid:111, parentPid:process.pid,
        coverage:{complete:true, sources:[]}};
      const contents = kind === 'malformed' ? '{' : kind === 'oversized' ? 'x'.repeat(16385) : JSON.stringify(value);
      const target = join(work, `target-${kind}.json`);
      if (kind === 'symlink' || kind === 'hardlink') {
        writeFileSync(target, contents);
        if (kind === 'symlink') symlinkSync(target, proof);
        else linkSync(target, proof);
      } else writeFileSync(proof, contents);
      if (kind === 'duplicate') writeFileSync(`${receipt}.events-node-112.json`, JSON.stringify({...value, pid:112}));
      if (kind === 'late-invalid') writeFileSync(`${receipt}.events-node-111.invalid`, 'unit');
      const events = [
        {type:'test:pass', data:{entryFile:file, file, name:'ok', testId:1, parentId:0, nesting:0, details:{type:'test'}}},
        {type:'test:summary', data:{entryFile:file, file, success:true,
          counts:{tests:1, passed:1, failed:0, cancelled:0, skipped:0, todo:0, suites:0}}},
        {type:'test:summary', data:{success:true}},
      ];
      for await (const _ of reporter(events)) {}
      const result = JSON.parse(readFileSync(receipt, 'utf8'));
      assert.deepEqual([result.passed, result.failed, result.errors], [1, 0, 0], kind);
      assert.equal(result.fileCoverage.complete, kind === 'valid', kind);
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  }
});
