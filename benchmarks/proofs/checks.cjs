const assert = require('node:assert/strict');
exports.coverage = (subject) => {
  assert.equal(subject.covered(18), 'adult'); assert.equal(subject.covered(1), 'minor');
  assert.equal(subject.partial(1), 'positive'); subject.empty();
  assert.equal(subject.defaults(), 0); assert.equal(subject.defaults({n: 2}), 2);
  assert.equal(subject.outer(true), 'one'); assert.equal(subject.outer(false), 'off');
  assert.equal(subject.first(1), true); assert.equal(subject.second(1), false);
  assert.equal(subject.view(18), 'adult'); assert.equal(subject.containingClass(true), 1);
};
exports.mutation = async (subject) => {
  if (process.env.SESHAT_PROOF_SCENARIO === 'timeout' && Number(process.env.SESHAT_MUTANT_ID) >= 0) {
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  assert.equal(subject.inclusive(18), true); assert.equal(subject.exclusive(18), false);
  assert.equal(subject.below(18), false); assert.equal(subject.atMost(18), true);
  assert.equal(subject.equal(18), true); assert.equal(subject.different(18), false);
  assert.equal(subject.loose('18'), true); assert.equal(subject.notLoose('18'), false);
  assert.equal(subject.missedBoundary(20), true); assert.equal(subject.initialised, true);
  assert.equal(subject.nested(18), true);
  let calls = 0;
  assert.equal(subject.sideEffects(() => ++calls), true); assert.equal(calls, 2);
  assert.equal(subject.sideEffects(() => NaN), false);
  assert.equal(subject.narrow('abc'), 3); assert.equal(subject.narrow(undefined), 0);
};
