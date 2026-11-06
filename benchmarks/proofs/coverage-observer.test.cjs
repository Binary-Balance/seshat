const {test} = require('node:test');
const assert = require('node:assert/strict');
const {resolve} = require('node:path');
const {observeCoverage} = require('./coverage-observer.cjs');
const source = resolve('src/calc.ts');
const entry = () => ({path:source, hash:'hash', statementMap:{0:{start:{line:1,column:0},end:{line:1,column:1}}},
  fnMap:{0:{name:'calc'}}, s:{0:0}, f:{0:0}});
function fixture() {
  const sandbox = {}, late = [];
  const observer = observeCoverage(sandbox, [source], () => late.push(true));
  const load = () => { sandbox.__coverage__[source] = entry(); return sandbox.__coverage__[source]; };
  return {sandbox, observer, late, load};
}

test('records static calls and runtime/cleanup hits, including late imports', () => {
  const {observer, load} = fixture();
  const coverage = load();
  coverage.s[0]++;
  coverage.f[0]++;
  observer.start();
  coverage.s[0]++;
  assert.deepEqual(observer.finish(), {complete:true,sources:[{path:source,hit:true,static:true}]});
  const other = fixture();
  other.observer.start();
  other.load().f[0]++;
  assert.deepEqual(other.observer.finish().sources, [{path:source,hit:true,static:false}]);
});

test('unimported sources remain omissions, imported zero counts remain zero', () => {
  const empty = fixture();
  empty.observer.start();
  assert.deepEqual(empty.observer.finish(), {complete:true,sources:[]});
  const zero = fixture(); zero.load(); zero.observer.start();
  assert.deepEqual(zero.observer.finish().sources, [{path:source,hit:false,static:false}]);
});

test('the first Istanbul import cannot retain an unobserved root assignment', () => {
  const {sandbox, observer} = fixture();
  const coverage = sandbox.__coverage__ || (sandbox.__coverage__ = {});
  coverage[source] = entry();
  observer.start();
  coverage[source].f[0]++;
  coverage[source].f[0] = 0;
  assert.equal(observer.finish().complete, false);
});

test('normalized candidates retain their actual Istanbul key', () => {
  const {sandbox, observer} = fixture();
  const key = process.platform === 'win32' ? source.replaceAll('\\', '/') : source.replace('/src/', '/src/./');
  const value = entry(); value.path = key;
  sandbox.__coverage__[key] = value;
  observer.start(); sandbox.__coverage__[key].f[0]++;
  assert.deepEqual(observer.finish(), {complete:true,sources:[{path:source,hit:true,static:false}]});
});

test('resets, deletion and replacement cannot erase runtime history', () => {
  const attacks = [
    ({coverage}) => { coverage.f[0] = 0; coverage.f[0]++; },
    ({coverage}) => { delete coverage.s[0]; coverage.s[0] = 1; },
    ({coverage}) => { coverage.s = {0:1}; },
    ({sandbox}) => { delete sandbox.__coverage__[source]; },
    ({sandbox}) => { sandbox.__coverage__[source] = entry(); },
    ({sandbox}) => { sandbox.__coverage__ = {}; },
    ({sandbox}) => { delete sandbox.__coverage__; sandbox.__coverage__ = {}; },
    ({coverage}) => { coverage.fnMap[0].name = 'changed'; },
    ({coverage}) => { Object.defineProperty(coverage.s, '0', {value:0}); },
  ];
  for (const attack of attacks) {
    const state = fixture(); const coverage = state.load(); state.observer.start(); coverage.f[0]++;
    assert.doesNotThrow(() => attack({...state, coverage}), attack.toString());
    assert.deepEqual(state.observer.finish(), {complete:false,sources:[]}, attack.toString());
  }
});

test('sealing detects later writes and final checks detect a removed global watcher', () => {
  const state = fixture(); const coverage = state.load(); state.observer.start(); state.observer.finish();
  coverage.s[0]++;
  assert.ok(state.late.length > 0);
  delete state.sandbox.__coverage__;
  assert.equal(state.observer.finish().complete, false);
  const failure = new Error('marker IO failed');
  const sandbox = {}; const observer = observeCoverage(sandbox, [source], () => { throw failure; });
  sandbox.__coverage__[source] = entry(); observer.finish();
  assert.throws(() => sandbox.__coverage__[source].s[0]++, error => error === failure);
});

test('malformed counters, ambiguous identities and late installation cannot supply evidence', () => {
  for (const mutate of [value => { value.s[0] = -1; }, value => { value.f.extra = 0; }, value => { value.path += '?raw'; }]) {
    const state = fixture(); const value = entry(); mutate(value); state.sandbox.__coverage__[source] = value;
    assert.equal(state.observer.finish().complete, false);
  }
  const state = fixture(); state.sandbox.__coverage__[source + '?raw'] = entry();
  assert.equal(state.observer.finish().complete, false);
  assert.equal(observeCoverage({__coverage__:{}}, [source], () => {}).finish().complete, false);
  assert.equal(observeCoverage({}, [source, source], () => {}).finish().complete, false);
});

test('malformed coverage getters disable attribution without running application code', () => {
  for (const select of [value=>[value,'path'],value=>[value,'s'],value=>[value.s,'0'],value=>[value.fnMap[0],'name']]) {
    const state=fixture(), value=entry(); let calls=0;
    const [target,key]=select(value);
    Object.defineProperty(target,key,{enumerable:true,configurable:true,get(){calls++;throw Error('application getter');}});
    assert.doesNotThrow(()=>{state.sandbox.__coverage__[source]=value;});
    assert.equal(state.observer.finish().complete,false);
    assert.equal(calls,0);
  }
  const state=fixture(); let calls=0;
  const root={}; Object.defineProperty(root,source,{enumerable:true,get(){calls++;throw Error('root getter');}});
  assert.doesNotThrow(()=>{state.sandbox.__coverage__=root;});
  assert.equal(state.observer.finish().complete,false);
  assert.equal(calls,0);
  const existing={get __coverage__(){calls++;throw Error('existing getter');}};
  assert.equal(observeCoverage(existing,[source],()=>{}).finish().complete,false);
  assert.equal(calls,0);
});
