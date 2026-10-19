// Exercise the private adapters with real error identities and malformed sidecars.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const require = createRequire(import.meta.url);
const Reporter = require('./jest-reporter.cjs');
const work = mkdtempSync(join(tmpdir(), 'seshat-jest-hooks-'));
const previousCwd = process.cwd();
const previousReceipt = process.env.SESHAT_RECEIPT;
const previousId = process.env.SESHAT_EXECUTION_ID;
const base = join(work, 'base.cjs');
writeFileSync(base, 'module.exports = class {};');
for (const [name, version] of [['jest', '29.7.0'], ['jest-expo', '57.0.5']]) {
  const directory = join(work, 'node_modules', name);
  mkdirSync(directory, {recursive:true});
  writeFileSync(join(directory, 'package.json'), JSON.stringify({name, version}));
}
writeFileSync(join(work, 'node_modules/jest-expo/jest-preset.js'),
  `module.exports = {testEnvironment:${JSON.stringify(base)}};`);
process.chdir(work);
process.env.SESHAT_EXECUTION_ID = 'current';

try {
  const Environment = require('./jest-expo-environment.cjs');
  let sequence = 0;
  async function receipt(failures, {passed = 0, failed = 1, modifyEvent, modifyResult} = {}) {
    process.env.SESHAT_RECEIPT = join(work, `receipt-${sequence++}.json`);
    const file = join(work, 'test.js');
    const environment = new Environment({}, {testPath:file});
    const state = {unhandledErrors:[]};
    const test = {errors:[]};
    for (const {kind, hook = 'afterEach', attached = true, observed = true} of failures) {
      const error = new Error(kind);
      if (attached) test.errors.push([error, new Error('registration')]);
      if (kind === 'unhandled') state.unhandledErrors.push(error);
      else if (observed) await environment.handleTestEvent(kind === 'assertion'
        ? {name:'test_fn_failure', test, error}
        : {name:'hook_failure', hook:{type:hook}, test:hook.endsWith('Each') ? test : undefined, error}, state);
    }
    await environment.handleTestEvent({name:'test_done', test}, state);
    await environment.handleTestEvent({name:'run_finish'}, state);
    const key = createHash('sha256').update(file).digest('hex');
    const sidecar = `${process.env.SESHAT_RECEIPT}.events-${key}`;
    if (modifyEvent) {
      const event = JSON.parse(readFileSync(sidecar, 'utf8'));
      modifyEvent(event);
      writeFileSync(sidecar, JSON.stringify(event));
    }
    const result = {numRuntimeErrorTestSuites:0, wasInterrupted:false,
      numTotalTestSuites:1, numPassedTests:passed, numFailedTests:failed,
      testResults:[{testFilePath:file, numPassingTests:passed, numFailingTests:failed}]};
    modifyResult?.(result);
    new Reporter().onRunComplete(new Set([{}]), result);
    return JSON.parse(readFileSync(process.env.SESHAT_RECEIPT, 'utf8'));
  }

  const mixed = await receipt([{kind:'assertion'}, {kind:'cleanup'}, {kind:'cleanup'}]);
  assert.equal(mixed.complete, true);
  assert.equal(mixed.failed, 1, 'count failed tests, not failure events');
  assert.equal(mixed.errors, 2);
  assert.equal(mixed.testHookErrors, 2);
  for (const hook of ['beforeEach', 'afterEach']) {
    const report = await receipt([{kind:'hook', hook}]);
    assert.equal(report.failed, 1);
    assert.equal(report.errors, 1);
    assert.equal(report.testHookErrors, 1);
  }
  for (const failures of [
    [{kind:'suite', hook:'beforeAll'}],
    [{kind:'suite', hook:'afterAll', attached:false}],
    [{kind:'cleanup', attached:false}],
    [{kind:'assertion'}, {kind:'cleanup'}, {kind:'unknown', observed:false}],
    [{kind:'assertion'}, {kind:'cleanup'}, {kind:'unhandled', attached:false}],
  ]) {
    const report = await receipt(failures);
    assert.ok(report.errors > report.testHookErrors, JSON.stringify(report));
  }
  for (const modifyEvent of [
    event => { event.version = 1; },
    event => { event.executionId = 'stale'; },
    event => { event.file = 'another-test.js'; },
    event => { delete event.testHookErrors; },
    event => { event.testHookErrors = '1'; },
    event => { event.testHookErrors = 1.5; },
    event => { event.testHookErrors = Number.MAX_SAFE_INTEGER + 1; },
    event => { event.testHookErrors = -1; },
    event => { event.testHookErrors = 2; },
    event => { event.failed = 0; },
    event => { event.retries = 1; },
    event => { event.unattributedErrors = '0'; },
    event => { event.passed = 1; },
  ]) {
    const report = await receipt([{kind:'cleanup'}], {modifyEvent});
    assert.ok(report.errors > report.testHookErrors, JSON.stringify(report));
  }
  for (const modifyResult of [
    result => { result.numRuntimeErrorTestSuites = 1; },
    result => { result.wasInterrupted = true; },
    result => { result.testResults[0].testExecError = {message:'load failed'}; },
    result => { result.numFailedTests = 2; },
    result => { result.testResults[0].numFailingTests = 2; },
    result => { result.testResults.push(result.testResults[0]); },
  ]) {
    const report = await receipt([{kind:'cleanup'}], {modifyResult});
    assert.ok(report.errors > report.testHookErrors, JSON.stringify(report));
  }
  console.log('Jest hook evidence checks passed: only matched per-test hook errors are attributable.');
} finally {
  process.chdir(previousCwd);
  if (previousReceipt === undefined) delete process.env.SESHAT_RECEIPT;
  else process.env.SESHAT_RECEIPT = previousReceipt;
  if (previousId === undefined) delete process.env.SESHAT_EXECUTION_ID;
  else process.env.SESHAT_EXECUTION_ID = previousId;
  rmSync(work, {recursive:true, force:true});
}
