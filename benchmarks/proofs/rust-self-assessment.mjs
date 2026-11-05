// Validate and retain portable measurement evidence; this does not set quality gates.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const run = resolve(process.argv[2]);
const output = join(run, 'evidence');
const read = path => readFileSync(join(run, path), 'utf8');
const json = path => JSON.parse(read(path));
const portable = text => text.replaceAll(run, '<run>').replaceAll(repo, '<repo>')
  .replaceAll(homedir(), '<home>').replaceAll(tmpdir(), '<tmp>');
const save = (path, text) => writeFileSync(join(output, path), portable(text).trimEnd() + '\n');
const saveJson = (path, value) => save(path, JSON.stringify(value, null, 2) + '\n');
const command = (name, args) => execFileSync(name, args, {cwd: repo, encoding: 'utf8'}).trim();
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const reports = {unit: json('unit-crap.json'), combined: json('crap.json')};
const scope = {};
mkdirSync(output); // Refuse to overwrite a retained result.
for (const [name, report] of Object.entries(reports)) {
  assert.equal(report.version, '0.9.0');
  assert.ok(report.entries.length > 0);
  const unmeasured = report.entries.filter(row => row.coverage === null)
    .map(({file, function: fn, line, cyclomatic}) => ({file, function: fn, line, cyclomatic}));
  const measured = report.entries.filter(row => row.coverage !== null);
  for (const row of measured) {
    assert.ok(row.coverage >= 0 && row.coverage <= 100);
    const expected = row.cyclomatic ** 2 * (1 - row.coverage / 100) ** 3 + row.cyclomatic;
    assert.ok(Math.abs(row.crap - expected) < 1e-8, `CRAP formula: ${row.function}`);
  }
  // Unknown coverage has no measured score; retain every omitted identity here.
  scope[name] = {analyzed: report.entries.length, measured: measured.length, unmeasured,
    above30: measured.filter(row => row.crap > 30).length};
  saveJson(`${name}-crap.json`, {...report, entries: measured});
}
const reference = reports.combined.entries.find(row => row.function === 'score'
  && row.file === 'crates/seshat/src/assessment.rs');
assert.equal(reference?.cyclomatic, 4, 'hand-checked assessment::score complexity');
assert.equal(reference.coverage, 100, 'assessment::score coverage');
assert.equal(reference.crap, 4);
const mutation = json('mutants.out/outcomes.json');
assert.equal(mutation.outcomes[0].scenario, 'Baseline');
assert.equal(mutation.outcomes[0].summary, 'Success');
const outcomes = mutation.outcomes.slice(1);
assert.ok(outcomes.length > 0);
assert.equal(outcomes.length, json('mutants.out/mutants.json').length);
assert.ok(outcomes.every(row => ['CaughtMutant', 'MissedMutant', 'Unviable'].includes(row.summary)));
assert.equal(sha256(join(run, 'policy/src/lib.rs')), sha256(join(repo, 'crates/seshat/src/assessment.rs')));
const rustTests = [...read('rust-tests.log').matchAll(/test result: ok\. (\d+) passed;/g)]
  .reduce((sum, match) => sum + Number(match[1]), 0);
assert.ok(rustTests > 0);
const cli = json('cli.json');
const vitest = json('vitest.json');
const jest = json('jest.json');
const selection = json('selection.json');
assert.equal(vitest.checks.completed, vitest.checks.requested);
assert.equal(jest.checks.completed, jest.checks.requested);
const sourceFiles = command('git', ['ls-files', 'crates/seshat']).split('\n')
  .filter(path => /\.(rs|toml|lock)$/.test(path));
saveJson('summary.json', {
  sourceRevision: command('git', ['rev-parse', 'HEAD']),
  sourceChanges: command('git', ['status', '--porcelain', '--', 'crates/seshat']),
  sources: Object.fromEntries(sourceFiles.map(path => [path, sha256(join(repo, path))])),
  environment: {platform: process.platform, arch: process.arch, node: process.version,
    rust: command('rustc', ['--version']), llvmCov: command('cargo', ['llvm-cov', '--version']),
    crap: command('cargo', ['crap', '--version']), mutants: command('cargo', ['mutants', '--version'])},
  binaries: Object.fromEntries(['seshat', 'seshat-proofs'].map(name =>
    [name, sha256(join(run, 'target/debug', name))])),
  coverageBasis: 'line', scope, rustTests,
  proofs: {cli: Object.keys(cli).length,
    vitest: {...vitest.checks, cases: vitest.requestedCases, environment: vitest.environment},
    jest: {...jest.checks, cases: jest.requestedCases, environment: jest.environment}, selection: selection.checks},
  mutation: {scope: 'assessment.rs and its own unit tests; other crate callers excluded',
    source: 'crates/seshat/src/assessment.rs', generated: outcomes.length,
    counts: Object.fromEntries(['CaughtMutant', 'MissedMutant', 'Unviable']
      .map(summary => [summary, outcomes.filter(row => row.summary === summary).length]))},
});
saveJson('mutation-outcomes.json', mutation);
for (const file of ['unit.lcov', 'combined.lcov', 'rust-tests.log', 'build.log', 'cli.log',
  'vitest.log', 'jest.log', 'selection.log', 'mutation.log']) {
  const text = read(file);
  save(file, file.endsWith('.lcov') ? text.replaceAll(`${repo}/`, '') : text);
}
console.log(`Validated ${rustTests} Rust tests; ${scope.combined.measured} measured functions; ${outcomes.length} pilot mutants.`);
