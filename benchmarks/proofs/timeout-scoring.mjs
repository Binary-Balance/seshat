// Real runner timeouts from awaited work that never settles; no mutant retries.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
assert.ok(process.env.SESHAT_CLI_BINARY, 'Set SESHAT_CLI_BINARY to the binary under test');
const binary = resolve(process.env.SESHAT_CLI_BINARY);
mkdirSync(join(repo, 'work/assurance-proofs'), {recursive:true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/timeout-scoring-'));
const runs = {};
const dependencies = [];
const save = () => {
  let json = JSON.stringify({node:process.version, runs}, null, 2);
  for (const [path, replacement] of [[work, '<work>'], ...dependencies.map(path => [path, '<dependencies>']), [repo, '<repo>']]) {
    json = json.replaceAll(path, replacement);
  }
  writeFileSync(join(work, 'result.json'), json + '\n');
};

const {values} = parseArgs({options:{runner:{type:'string'}}});
assert.ok(!values.runner || ['vitest', 'jest'].includes(values.runner), '--runner must be vitest or jest');
for (const runner of values.runner ? [values.runner] : ['vitest', 'jest']) {
  const root = join(work, runner);
  const input = join(root, 'input');
  const scratch = join(root, 'scratch');
  mkdirSync(input, {recursive:true});
  mkdirSync(scratch);
  const modules = realpathSync(join(here, runner === 'vitest' ? 'node_modules' : 'fixtures/jest-expo/node_modules'));
  dependencies.push(modules);
  // Resolve installed tools from a shared ancestor without copying them into captures.
  symlinkSync(modules, join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(join(input, 'package.json'), JSON.stringify({private:true, type:runner === 'vitest' ? 'module' : 'commonjs'}));
  const testFile = runner === 'vitest' ? 'subject.test.ts' : 'subject.test.tsx';
  const prefix = runner === 'vitest' ? "import {test,expect,afterEach,beforeAll} from 'vitest';\n" : '';
  const testTimeout = 200;
  const test = runner === 'vitest'
    ? [process.execPath, join(modules, 'vitest/vitest.mjs'), 'run', '--config', 'vitest.config.mjs', '--maxWorkers=1', '--no-file-parallelism', '--reporter={seshatReporter}']
    : [process.execPath, join(modules, 'jest/bin/jest.js'), '--config', 'jest.config.cjs', '--runInBand', '--runTestsByPath', testFile, '--reporters={seshatReporter}', '--env={seshatEnvironment}'];
  const runnerFiles = runner === 'vitest' ? ['vitest.config.mjs'] : ['jest.config.cjs', 'babel.config.cjs'];
  if (runner === 'vitest') {
    writeFileSync(join(input, 'vitest.config.mjs'), `export default {cacheDir:'.vite',test:{runner:process.env.SESHAT_VITEST_RUNNER,include:['*.test.ts'],coverage:{provider:'istanbul',include:['subject.ts'],reporter:['json'],reportsDirectory:'coverage'}}};\n`);
  } else {
    writeFileSync(join(input, 'jest.config.cjs'), "module.exports={preset:'jest-expo',rootDir:__dirname,testMatch:['<rootDir>/*.test.tsx'],maxWorkers:1};\n");
    writeFileSync(join(input, 'babel.config.cjs'), "module.exports={presets:['babel-preset-expo']};\n");
  }
  const setup = {
    name:runner, runner, cwd:'.', timeoutMs:runner === 'jest' ? 60000 : 15000,
    typecheck:[process.execPath, resolve(here, '../node_modules/typescript/bin/tsc'), '--ignoreConfig', '--strict', '--noEmit', '--skipLibCheck', '--target', 'es2022', 'subject.ts'],
    test,
    coverage:{command:runner === 'vitest' ? [...test, '--coverage'] : [...test, '--coverage', '--coverageProvider=babel', '--coverageReporters=json', '--coverageDirectory=coverage', '--collectCoverageFrom', 'subject.ts'], report:'coverage/coverage-final.json'},
  };
  const config = {workers:1, testSelection:false, source:{include:['subject.ts']},
    capture:['package.json', 'subject.ts', testFile, ...runnerFiles], setups:[setup], thresholds:{minMutationScore:100}};
  let source;
  function fixture(text, body) {
    source = text;
    writeFileSync(join(input, 'subject.ts'), source);
    writeFileSync(join(input, testFile), prefix + body + '\n');
  }
  function run(name, change = () => {}, {command = 'check', flags = []} = {}) {
    const value = structuredClone(config);
    change(value);
    const path = join(input, 'seshat.json');
    writeFileSync(path, JSON.stringify(value));
    const child = spawnSync(binary, [command, '--config', path, '--scratch', scratch, '--json', ...flags], {encoding:'utf8', timeout:180000, maxBuffer:4 * 1024 * 1024});
    assert.ifError(child.error);
    const report = JSON.parse(child.stdout);
    runs[`${runner}-${name}`] = {status:child.status, report, stderr:child.stderr};
    save();
    assert.equal(child.status, report.complete ? report.quality.state === 'failed' ? 1 : 0 : 2, child.stdout + child.stderr);
    assert.deepEqual(readdirSync(scratch), [], 'scratch cleanup');
    assert.equal(readFileSync(join(input, 'subject.ts'), 'utf8'), source, 'source restoration');
    for (const phase of [report.result.mutation, report.result.pseudoTesting]) {
      for (const row of phase?.outcomes ?? []) {
        assert.ok(row.setups.every(setup => (setup.jobsAttempted ?? 0) <= 1), 'mutant must not be retried');
      }
    }
    console.log(`${runner}-${name}: complete=${report.complete}, score=${report.result.mutation?.score}, counted=${report.result.mutation?.countedTimeouts}`);
    return report;
  }
  fixture(`export function complete(done: () => void) { done(); }
export function checked(value: number) { return value === 1; }
`, `import {complete,checked} from './subject';
test('await completion', async()=>{await new Promise<void>(complete);},${testTimeout});
test('comparison',()=>expect(checked(1)).toBe(true));`);
  for (const policy of ['omitted', false, true, 'switch']) {
    const enabled = policy === true || policy === 'switch';
    const report = run(String(policy), value => {
      if (policy !== 'omitted') value.countTimeoutsAsKilled = enabled;
    }, {command:policy === false || policy === 'switch' ? 'mutate' : 'check', flags:policy === 'switch' ? ['--experimental-switching'] : []});
    assert.equal(report.complete, enabled);
    assert.equal(report.quality.state, enabled ? 'passed' : 'incomplete');
    assert.equal(report.result.mutation.score, enabled ? 100 : null);
    for (const phase of [report.result.mutation, report.result.pseudoTesting]) {
      assert.equal(phase.countedTimeouts, enabled ? 1 : 0);
      assert.equal(phase.killed, 1);
      assert.equal(phase.unresolved, enabled ? 0 : 1);
      assert.equal(phase.notRun, 0);
      assert.equal(phase.diagnostics.unresolvedBreakdown.timedOut, 1);
      assert.equal(phase.diagnostics.unresolvedBreakdown.testTimedOut, 1);
      assert.equal(phase.diagnostics.unresolvedBreakdown.countedTimeouts, enabled ? 1 : 0);
      const timeout = phase.outcomes.find(row => row.verdict === 'timed-out');
      assert.equal(timeout.countedAsKilled, enabled);
      assert.equal(timeout.setups[0].testTimedOut, true);
      assert.equal(timeout.setups[0].timedOut, false);
      assert.equal(timeout.setups[0].exit, 1);
      assert.equal(timeout.setups[0].report.errors, 0);
    }
    assert.equal(report.result.pseudoTesting.outcomes[0].pseudoTested, enabled ? false : null);
    assert.equal(report.result.pseudoTesting.checked, enabled ? 2 : 1);
  }
  fixture('export const ready = 1 === 1;\n', `import {ready} from './subject';
afterEach(()=>{if(!ready)throw Error('cleanup failed');});
test('await completion',async()=>{await new Promise<void>(resolve=>{if(ready)resolve();});},${testTimeout});`);
  const errors = run('timeout-with-errors', value => {value.countTimeoutsAsKilled = true; value.mutationOperators = ['comparison'];});
  const errorOutcome = errors.result.mutation.outcomes[0];
  assert.equal(errorOutcome.verdict, 'timed-out');
  assert.equal(errorOutcome.countedAsKilled, false);
  assert.ok(errorOutcome.setups[0].report.errors > 0);
  if (runner === 'jest') assert.ok(errorOutcome.setups[0].report.testHookErrors > 0);
  assert.equal(errors.result.mutation.countedTimeouts, 0);
  assert.equal(errors.complete, false);

  if (runner === 'vitest') {
    fixture('export const ready = 1 === 1;\n', `import {ready} from './subject';
test('await completion',async()=>{await new Promise<void>(resolve=>{if(ready)resolve();});},${testTimeout});`);
    // A second test file gives each setup a distinct workload without environment tricks.
    const secondFile = 'second.test.ts';
    for (const [name, body, resolved] of [
      ['passed', "test('second',()=>expect(typeof ready).toBe('boolean'));", true],
      ['failed', "test('second',()=>expect(ready).toBe(true));", true],
      ['error', "beforeAll(()=>{if(!ready)throw Error('setup failed');});test('second',()=>{});", false],
    ]) {
      writeFileSync(join(input, secondFile), prefix + "import {ready} from './subject';\n" + body);
      const report = run(`multi-${name}`, value => {
        value.countTimeoutsAsKilled = true;
        value.mutationOperators = ['comparison'];
        value.capture.push(secondFile);
        value.setups[0].test = [...test, testFile];
        value.setups[0].coverage.command = [...test, testFile, '--coverage'];
        value.setups.push({...structuredClone(value.setups[0]), name:'second', test:[...test, secondFile],
          coverage:{command:[...test, secondFile, '--coverage', '--coverage.reportsDirectory=coverage-second'], report:'coverage-second/coverage-final.json'}});
      });
      assert.equal(report.complete, resolved);
      assert.equal(report.result.mutation.countedTimeouts, resolved ? 1 : 0);
      assert.equal(report.result.mutation.outcomes[0].verdict, resolved ? 'timed-out' : 'execution-error');
      assert.deepEqual(report.result.mutation.outcomes[0].setups.map(row => row.state), ['timed-out', name === 'failed' ? 'failed' : name === 'passed' ? 'passed' : 'execution-error']);
    }
    rmSync(join(input, secondFile));
    fixture('export const ready = 1 === 1;\nexport const later = 2 === 2;\n', `import {ready,later} from './subject';
test('blocked event loop',()=>{if(!ready)while(true){};expect(later).toBe(true);});`);
    // timeoutMs 5000 cuts the job short of the 30000 mutant limit, so it does not count.
    const deadline = run('job-deadline', value => {value.countTimeoutsAsKilled = true; value.mutationOperators = ['comparison']; value.setups[0].timeoutMs = 5000;});
    assert.equal(deadline.complete, false);
    assert.equal(deadline.result.mutation.score, null);
    assert.equal(deadline.result.mutation.countedTimeouts, 0);
    assert.equal(deadline.result.mutation.outcomes[0].verdict, 'timed-out');
    assert.equal(deadline.result.mutation.outcomes[0].countedAsKilled, false);
    assert.equal(deadline.result.mutation.outcomes[0].setups[0].timedOut, true);
    assert.equal(deadline.result.setups[0].mutantTimeoutMs, 5000);
    assert.ok(deadline.result.setups[0].uncappedMutantTimeoutMs >= 30000);
    const counted = run('job-deadline-counted', value => {
      value.countTimeoutsAsKilled = true;
      value.mutationOperators = ['comparison'];
      Object.assign(value.setups[0], {timeoutMs:60000, mutantTimeoutMinMs:1000});
    });
    assert.equal(counted.complete, true);
    assert.equal(counted.quality.state, 'passed');
    assert.equal(counted.result.mutation.score, 100);
    assert.equal(counted.result.mutation.countedTimeouts, 1);
    assert.equal(counted.result.mutation.outcomes[0].countedAsKilled, true);
    assert.equal(counted.result.mutation.outcomes[0].setups[0].timedOut, true);
    assert.ok(counted.result.setups[0].mutantTimeoutMs < 60000, 'the derived limit applies');
    assert.equal(counted.result.setups[0].uncappedMutantTimeoutMs, null);
    fixture('export const ready = 1 === 1;\n', `test('baseline never settles',async()=>{await new Promise(()=>{});},${testTimeout});`);
    const baseline = run('baseline-timeout', value => {value.countTimeoutsAsKilled = true; value.mutationOperators = ['comparison'];});
    assert.equal(baseline.complete, false);
    assert.equal(baseline.result.setups[0].baseline.state, 'timed-out');
    assert.equal(baseline.result.mutation.countedTimeouts, 0);
    assert.ok(baseline.result.mutation.outcomes.every(row => row.verdict === 'unassessed' && !row.countedAsKilled));
  }
  rmSync(join(root, 'node_modules'));
}
save();
console.log(`Timeout scoring proof passed; reports: ${relative(repo, join(work, 'result.json'))}`);
