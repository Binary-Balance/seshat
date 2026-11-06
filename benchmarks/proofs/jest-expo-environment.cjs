// Bounded adapter for the verified Expo preset, not arbitrary custom environments.
const {createRequire} = require('node:module');
const {isAbsolute, join} = require('node:path');
const {readFileSync, writeFileSync} = require('node:fs');
const {createHash} = require('node:crypto');
const projectRequire = createRequire(join(process.cwd(), 'package.json'));
const Base = projectRequire(projectRequire('jest-expo/jest-preset').testEnvironment);
const EVENT_LIMIT = 16384;

function testIdentity(test) {
  const names = [];
  for (let item = test; item?.parent; item = item.parent) {
    if (typeof item.name !== 'string') return undefined;
    names.unshift(item.name);
  }
  return names.length ? JSON.stringify(names) : undefined;
}

module.exports = class EvidenceEnvironment extends Base {
  constructor(config, context) {
    super(config, context);
    this.failures = new WeakMap();
    this.suiteErrors = new Set();
    this.evidence = {version:2, executionId:process.env.SESHAT_EXECUTION_ID,
      file:context.testPath, hookFailures:0, testHookErrors:0, passed:0, failed:0,
      unattributedErrors:0, timeouts:0, retries:0};
    this.key = createHash('sha256').update(this.evidence.file).digest('hex');
    this.entered = new WeakMap();
    this.selectionBytes = 0;
    if (process.env.SESHAT_TEST_SELECTION === '1') {
      this.selection = {version:1, entered:[], completed:[]};
      if (process.env.SESHAT_COVERAGE_REPORT && config.globalConfig?.collectCoverage === true
        && config.globalConfig.coverageProvider === 'babel') {
        try {
          const candidates = JSON.parse(readFileSync(process.env.SESHAT_SOURCES, 'utf8'));
          if (!Array.isArray(candidates) || !candidates.every(path => typeof path === 'string' && isAbsolute(path))
            || new Set(candidates).size !== candidates.length) throw Error('invalid sources');
          this.selection.candidates = candidates.sort();
          const {observeCoverage} = require('./coverage-observer.cjs');
          this.observer = observeCoverage(this.global, candidates, () => this.invalidateCoverage());
        } catch { this.selection = undefined; }
      }
    }
  }
  invalidateCoverage() {
    if (this.invalidated) return;
    writeFileSync(`${process.env.SESHAT_RECEIPT}.events-${this.key}-invalid`, '', {flag:'wx'});
    this.invalidated = true;
  }
  recordIdentity(field, id) {
    if (!this.selection) return;
    this.selectionBytes += Buffer.byteLength(id ?? '', 'utf8') + 4;
    if (!id || this.selectionBytes > EVENT_LIMIT) this.selection = undefined;
    else this.selection[field].push(id);
  }
  async teardown() {
    try { await super.teardown(); }
    finally {
      // A deleted global property cannot be trapped, so recheck after teardown too.
      if (this.observer && !this.observer.finish().complete) this.invalidateCoverage();
    }
  }
  async handleTestEvent(event, state) {
    await super.handleTestEvent?.(event, state);
    if (event.name === 'test_skip' || event.name === 'test_todo' || event.name === 'test_retry'
      || state?.hasFocusedTests || event.test?.concurrent || event.test?.failing) this.selection = undefined;
    if (event.name === 'test_fn_start' && (this.selection || this.observer)
      && event.test.errors.length === 0 && typeof event.test.fn === 'function') {
      if (!this.bodyStarted) { this.observer?.start(); this.bodyStarted = true; }
      if (this.selection) {
        const id = testIdentity(event.test);
        this.recordIdentity('entered', id);
        if (this.selection) this.entered.set(event.test, id);
      }
    }
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
      if (this.entered.has(test)) this.recordIdentity('completed', this.entered.get(test));
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
      const coverage = this.observer?.finish();
      const evidence = {...this.evidence, ...(this.selection ? {selection:{...this.selection,
        ...(coverage ? {coverage} : {})}} : {})};
      let serialized = JSON.stringify(evidence);
      if (Buffer.byteLength(serialized, 'utf8') > EVENT_LIMIT) {
        delete evidence.selection;
        serialized = JSON.stringify(evidence);
      }
      writeFileSync(`${process.env.SESHAT_RECEIPT}.events-${this.key}`, serialized, {flag:'wx'});
    }
  }
};
