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
    this.evidence = {version:1, executionId:process.env.SESHAT_EXECUTION_ID,
      file:context.testPath, hookFailures:0, testFailures:0, timeouts:0, retries:0};
  }
  async handleTestEvent(event, state) {
    await super.handleTestEvent?.(event, state);
    if (event.name === 'test_retry') this.evidence.retries++;
    if (event.name === 'hook_failure' || event.name === 'test_fn_failure') {
      // Jest 29 reports its own timeout as a string, rather than an Error.
      const message = typeof event.error === 'string' ? event.error : event.error?.message;
      if (message?.startsWith('Exceeded timeout of')) this.evidence.timeouts++;
      else if (event.name === 'hook_failure') this.evidence.hookFailures++;
      else this.evidence.testFailures++;
    }
    if (event.name === 'run_finish') {
      const key = createHash('sha256').update(this.evidence.file).digest('hex');
      writeFileSync(`${process.env.SESHAT_RECEIPT}.events-${key}`, JSON.stringify(this.evidence), {flag:'wx'});
    }
  }
};
