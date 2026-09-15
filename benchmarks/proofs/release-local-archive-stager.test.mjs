import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSourceTreeEquivalence,
  validateSourceTrees,
} from './release-local-archive-stager.mjs';

const sourceTrees = {
  crates: '69eabd0b41f8d9ae7f708f37e93f1e8e92b13829',
  packages: '9fde34a86e1795b9be2dcb619e7fb9a8e9701e9d',
  packaging: '7cdef2cec782f7aa717790ca5ef2999688a0ec4d',
};

test('rejects a mismatch in every bound source tree', () => {
  for (const path of Object.keys(sourceTrees)) {
    const checkoutTrees = {...sourceTrees, [path]: 'f'.repeat(40)};
    assert.throws(() => assertSourceTreeEquivalence(sourceTrees, checkoutTrees),
      new RegExp(`candidate source trees differ from checkout: ${path}`));
  }
});

test('rejects malformed source-tree fields', () => {
  assert.throws(() => validateSourceTrees({...sourceTrees, crates: 'short'}),
    /candidate source trees\.crates must be a full Git tree SHA/);
  assert.throws(() => validateSourceTrees({...sourceTrees, extra: 'a'.repeat(40)}),
    /candidate source trees must contain exactly crates, packages, packaging/);
});

test('accepts matching trees from a later checkout', () => {
  assert.deepEqual(assertSourceTreeEquivalence(sourceTrees, {...sourceTrees}), []);
});
