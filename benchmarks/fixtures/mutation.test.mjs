import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
const subject = await import(pathToFileURL(process.env.SESHAT_MUTANT_TARGET));
test('boundary comparisons', () => {
  assert.equal(subject.inclusive(18), true);
  assert.equal(subject.exclusive(18), false);
  assert.equal(subject.below(18), false);
  assert.equal(subject.atMost(18), true);
  assert.equal(subject.equal(18), true);
  assert.equal(subject.different(18), false);
  assert.equal(subject.loose('18'), true);
  assert.equal(subject.notLoose('18'), false);
  assert.equal(subject.missedBoundary(20), true);
  assert.equal(subject.missedUpper(16), true);
});
