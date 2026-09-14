import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classify, isPositive} from '../src/rules.ts';

test('classifies both boundaries', () => {
  assert.equal(classify(18), 'adult');
  assert.equal(classify(17), 'minor');
});

test('checks a positive value', () => {
  assert.equal(isPositive(1), true);
});
