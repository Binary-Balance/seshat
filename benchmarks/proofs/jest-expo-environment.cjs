// Bounded adapter for the verified Expo preset, not arbitrary custom environments.
const {createRequire} = require('node:module');
const {join} = require('node:path');
const {writeFileSync} = require('node:fs');
const {createHash} = require('node:crypto');
const projectRequire = createRequire(join(process.cwd(), 'package.json'));
const Base = projectRequire(projectRequire('jest-expo/jest-preset').testEnvironment);

module.exports = class EvidenceEnvironment extends Base {
  constructor(config, context) {
    super(config, context);
    this.failures = new WeakMap();
    this.suiteErrors = new Set();
    this.evidence = {version:2, executionId:process.env.SESHAT_EXECUTION_ID,
      file:context.testPath, hookFailures:0, testHookErrors:0, passed:0, failed:0,
      unattributedErrors:0, timeouts:0, retries:0};
  }
  async handleTestEvent(event, state) {
    await super.handleTestEvent?.(event, state);
    if (event.name === 'test_retry') this.evidence.retries++;
    if (event.name === 'hook_failure' || event.name === 'test_fn_failure') {
      // Jest 29 reports its own timeout as a string, rather than an Error.
      const message = typeof event.error === 'string' ? event.error : event.error?.message;
      const timeout = message?.startsWith('Exceeded timeout of');
      if (timeout) this.evidence.timeouts++;
      else if (event.name === 'hook_failure') this.evidence.hookFailures++;
      const testHook = event.name === 'hook_failure'
        && ['beforeEach', 'afterEach'].includes(event.hook.type);
      // Jest copies a beforeAll error onto each test below it, without an event.
      // It is counted once above, so a timeout there leaves errors at zero, as before #182.
      if (event.name === 'hook_failure' && event.hook.type === 'beforeAll') this.suiteErrors.add(event.error);
      if (event.test && (testHook || event.name === 'test_fn_failure')) {
        const failures = this.failures.get(event.test) ?? [];
        failures.push({testHook:testHook && !timeout});
        this.failures.set(event.test, failures);
      }
    }
    if (event.name === 'test_done') {
      const test = event.test;
      this.evidence[test.errors.length ? 'failed' : 'passed']++;
      // Circus adds each failure event's error to this test before we see the event,
      // and only a retry clears them, so counting events attributes them. Matching
      // error objects fails: Jest replaces node:assert and chai errors at test_done.
      const failures = this.failures.get(test) ?? [];
      this.evidence.testHookErrors += failures.filter(failure => failure.testHook).length;
      // Jest adds expect.assertions, suppressed and uncaught errors to the running
      // test without a failure event. They join a failure the test already owns,
      // as before #182; on their own they prove nothing.
      if (!failures.length) this.evidence.unattributedErrors += test.errors
        .filter(entry => !this.suiteErrors.has(Array.isArray(entry) ? entry[0] : entry)).length;
      this.failures.delete(test);
    }
    if (event.name === 'run_finish') {
      const key = createHash('sha256').update(this.evidence.file).digest('hex');
      writeFileSync(`${process.env.SESHAT_RECEIPT}.events-${key}`, JSON.stringify(this.evidence), {flag:'wx'});
    }
  }
};
