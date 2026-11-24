import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {muslRuntimeInputs, sha256} from './musl.mjs';

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
