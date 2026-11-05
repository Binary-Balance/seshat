// One-off report comparison for #226. The saved reports retain their actual timings.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const evidence = new URL('../../outputs/collection-phases/', import.meta.url);
const read = (phase, example) => JSON.parse(readFileSync(new URL(`${phase}/${example}.json`, evidence), 'utf8'));
const durations = new Set([
  'ms', 'executionMs', 'captureMs', 'wallMs', 'analysisMs', 'preparationMs',
  'compilerStrictnessMs', 'typecheckMs', 'baselineMs', 'coverageMs', 'attributionMs',
  'cleanupMs', 'workerPreparationMs', 'mutationWallMs', 'workerCleanupMs',
  'workerTimeMs', 'preparedBaselineMs', 'switchPreparationMs',
  'completedMutantsPerSecond', 'jobsPerSecond',
]);

function diagnostic(text) {
  return text
    .replace(/^(\s+[✓✕].*?) \(\d+(?:\.\d+)? ms\)$/gm, '$1')
    .replace(/^Time:.*$/gm, 'Time: <timing>')
    .replace(/\b\d{2}:\d{2}:\d{2}\b/g, '<clock>')
    .replace(/\b\d+(?:\.\d+)?ms\b/g, '<ms>')
    .replace(/^(\s+Duration\s+<ms>) \(([^)]+)\)$/gm, (_, prefix, components) =>
      `${prefix} (${components.split(', ').map(component => component.replace(/\d+%$/, '<percent>')).sort().join(', ')})`);
}

function normalized(value, key = '') {
  if (durations.has(key)) return value === null ? null : '<timing>';
  if (typeof value === 'string') {
    if (key === 'executionId') value = value.replace(/^capture-\d+(?=-)/, '<evidence>');
    value = value.replace(/(<scratch>\/|\.\.\/)capture-\d+(?=[/\s]|$)/g, '$1<capture>');
    return key === 'diagnostic' ? diagnostic(value) : value;
  }
  if (Array.isArray(value)) return value.map(item => normalized(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, normalized(item, name)]));
  }
  return value;
}

function validateDiagnostics(report) {
  let jobs = report.result.setups.flatMap(setup => [setup.compilerStrictness.job, setup.typecheck, setup.baseline, setup.coverage])
    .filter(job => job && 'exit' in job).length;
  for (const name of ['mutation', 'pseudoTesting']) {
    const phase = report.result[name];
    assert.equal(phase.workerBaselineJobs, phase.workerBaselines.length);
    assert.equal(phase.jobsAttempted, phase.outcomes.flatMap(row => row.setups)
      .reduce((sum, setup) => sum + (setup.jobsAttempted ?? 0), 0));
    if ('preparedBaselineJobs' in phase) assert.equal(phase.preparedBaselineJobs, phase.preparedBaselines.length);
    jobs += phase.jobsAttempted + phase.workerBaselineJobs + (phase.preparedBaselineJobs ?? 0);
    const completed = phase.outcomes.filter(row => 'executionMs' in row);
    const expected = completed.toSorted((left, right) => right.executionMs - left.executionMs)
      .slice(0, 5).map(({id, path, executionMs, verdict}) => ({id, path, executionMs, verdict}));
    assert.deepEqual(phase.diagnostics.slowestExecutions, expected);
    assert.equal(phase.diagnostics.workerTimeMs, completed.reduce((sum, row) => sum + row.executionMs, 0));
    assert.equal(phase.diagnostics.throughput.completedMutantsPerSecond, completed.length / (phase.mutationWallMs / 1000));
    assert.equal(phase.diagnostics.throughput.jobsPerSecond, phase.jobsAttempted / (phase.mutationWallMs / 1000));
  }
  assert.equal(report.result.jobsAttempted, jobs);
}

function compare(before, after, path = '', notes = [], rawBefore = before, rawAfter = after) {
  if (path.endsWith('/slowestExecutions')) {
    // Ranking and membership come from timings; each list was checked against its own outcomes.
    notes.push(`${path}: validated timing-derived top-five ranking in both reports`);
    return;
  }
  if (path.endsWith('/diagnostic') && before !== after) {
    // A longer duration shifts the existing 1,000-character stream cutoff.
    assert.equal([...rawBefore].length, 1000, `${path}: original diagnostic was not capped`);
    assert.equal([...rawAfter].length, 1000, `${path}: updated diagnostic was not capped`);
    const shorter = before.length <= after.length ? before : after;
    const longer = before.length > after.length ? before : after;
    assert.ok(longer.startsWith(shorter), `${path}: diagnostic text differs before its cutoff`);
    assert.ok(longer.length - shorter.length <= 10, `${path}: unexpected cutoff difference`);
    notes.push(`${path}: timing text shifted the diagnostic cutoff by ${longer.length - shorter.length} characters`);
    return;
  }
  if (Array.isArray(before)) {
    assert.equal(after.length, before.length, path);
    before.forEach((value, index) => compare(value, after[index], `${path}/${index}`, notes, rawBefore[index], rawAfter[index]));
  } else if (before && typeof before === 'object') {
    assert.deepEqual(Object.keys(after), Object.keys(before), path);
    for (const key of Object.keys(before)) compare(before[key], after[key], `${path}/${key}`, notes, rawBefore[key], rawAfter[key]);
  } else {
    assert.equal(after, before, path);
  }
  return notes;
}

// Ensure time normalization leaves counts, deadlines and assertion values intact.
assert.equal(diagnostic('AssertionError: expected 404 to be 200'), 'AssertionError: expected 404 to be 200');
assert.equal(normalized('Expected: capture-1'), 'Expected: capture-1');
assert.deepEqual(normalized({jobsAttempted: 3, mutantTimeoutMs: 30000, ms: 12}),
  {jobsAttempted: 3, mutantTimeoutMs: 30000, ms: '<timing>'});
assert.throws(() => compare('Expected: 404', 'Expected: 200', '/diagnostic'));

for (const example of ['node', 'vitest', 'jest-expo', 'node-workers-2', 'node-workers-2-switch']) {
  const before = read('before', example), after = read('after', example);
  validateDiagnostics(before);
  validateDiagnostics(after);
  const notes = compare(normalized(before), normalized(after), '', [], before, after);
  console.log(JSON.stringify({example, parity: 'passed', timingDerivedDifferences: notes}));
}
