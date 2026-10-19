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
    this.evidence = {version:2, executionId:process.env.SESHAT_EXECUTION_ID,
      file:context.testPath, hookFailures:0, testHookErrors:0, passed:0, failed:0,
      unattributedErrors:0, timeouts:0, retries:0};
  }
  async handleTestEvent(event, state) {
    await super.handleTestEvent?.(event, state);
    if (event.name === 'test_retry') {
      this.evidence.retries++;
      this.failures.delete(event.test);
    }
    if (event.name === 'hook_failure' || event.name === 'test_fn_failure') {
      // Jest 29 reports its own timeout as a string, rather than an Error.
      const message = typeof event.error === 'string' ? event.error : event.error?.message;
      const timeout = message?.startsWith('Exceeded timeout of');
      if (timeout) this.evidence.timeouts++;
      else if (event.name === 'hook_failure') this.evidence.hookFailures++;
      const testHook = event.name === 'hook_failure'
        && ['beforeEach', 'afterEach'].includes(event.hook.type);
      if (event.test && (testHook || event.name === 'test_fn_failure')) {
        const failures = this.failures.get(event.test) ?? [];
        failures.push({error:event.error, testHook:testHook && !timeout});
        this.failures.set(event.test, failures);
      }
    }
    if (event.name === 'test_done') {
      const test = event.test;
      this.evidence[test.errors.length ? 'failed' : 'passed']++;
      const failures = this.failures.get(test) ?? [];
      let matched = 0, unmatched = 0;
      // Match error objects before serialization; totals or stack text cannot prove attribution.
      for (const entry of test.errors) {
        const error = Array.isArray(entry) ? entry[0] : entry;
        const index = failures.findIndex(failure => failure.error === error);
        if (index < 0) { unmatched++; continue; }
        matched++;
        if (failures.splice(index, 1)[0].testHook) this.evidence.testHookErrors++;
      }
      // Jest adds expect.assertions, suppressed and uncaught errors to the running
      // test without a failure event. They join a failure the test already owns,
      // as before #182; on their own they prove nothing.
      if (!matched) this.evidence.unattributedErrors += unmatched;
      this.evidence.unattributedErrors += failures.length;
      this.failures.delete(test);
    }
    if (event.name === 'run_finish') {
      const key = createHash('sha256').update(this.evidence.file).digest('hex');
      writeFileSync(`${process.env.SESHAT_RECEIPT}.events-${key}`, JSON.stringify(this.evidence), {flag:'wx'});
    }
  }
};
