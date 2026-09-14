import assert from 'node:assert/strict';
import {test} from 'node:test';
import {adult, workspaceAnswer} from '../src/compare.ts';

test('uses the captured workspace package link', () => {
  assert.deepEqual([adult(17), adult(18), adult(19)], [false, true, true]);
  assert.equal(workspaceAnswer(), 42);
});
