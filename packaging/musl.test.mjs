import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {muslRuntimeInputs, portableMuslLinkMap, sha256} from './musl.mjs';

test('portable maps ignore Cargo CLI output IDs while preserving link evidence', () => {
  const map = (work, id) => [
    'LOAD /rust/lib/self-contained/libc.a',
    ` .text 0x1234 0x20 ${work}/target/release/deps/seshat-${id}.seshat.ed58a359-cgu.0.rcgu.o`,
    `OUTPUT(${work}/target/release/deps/seshat-${id} elf64-x86-64)`,
  ].join('\n');
  const options = {libraryDirectory:'/rust/lib', repo:'/source'};
  const first = portableMuslLinkMap(map('/pack/one', '011874c86f0e29a7'), {...options, work:'/pack/one'});
  const second = portableMuslLinkMap(map('/pack/two', '9cbe9a2298eb026b'), {...options, work:'/pack/two'});
  assert.equal(sha256(first), sha256(second));
  for (const [before, after] of [['libc.a','libgcc.a'], ['0x20','0x28'], ['ed58a359','01234567']]) {
    const changed = portableMuslLinkMap(map('/pack/one', '011874c86f0e29a7').replace(before, after),
      {...options, work:'/pack/one'});
    assert.notEqual(sha256(first), sha256(changed));
  }
});

test('link maps require audited self-contained inputs and reject additional native runtimes', () => {
  const root = mkdtempSync(join(tmpdir(), 'seshat-musl-map-'));
  try {
    mkdirSync(join(root, 'self-contained'));
    const names = ['rcrt1.o','crti.o','crtbeginS.o','libc.a','libunwind.a','crtendS.o','crtn.o'];
    const hashes = {};
    for (const name of names) {
      writeFileSync(join(root, 'self-contained', name), name);
      hashes['self-contained/' + name] = sha256(name);
    }
    const map = names.map(name => 'LOAD ' + join(root, 'self-contained', name)).join('\n');
    assert.equal(muslRuntimeInputs(map, root, hashes).length, 7);
    for (const extra of ['libgcc.a', 'crtbegin.o']) {
      assert.throws(() => muslRuntimeInputs(map + '\nLOAD /usr/lib/' + extra, root, hashes), /unexpected/);
    }
    assert.throws(() => muslRuntimeInputs(map.replace('/self-contained/libc.a', '/libc.a'), root, hashes), /outside/);
    assert.throws(() => muslRuntimeInputs(map, root, {...hashes, 'self-contained/libc.a':'0'.repeat(64)}), /differs from audited/);
    assert.throws(() => muslRuntimeInputs(map.replace(/LOAD .*\/libc\.a\n/, ''), root, hashes), /unexpected/);
  } finally { rmSync(root, {recursive:true, force:true}); }
});
