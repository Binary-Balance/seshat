const {createRequire} = require('node:module');
const {join} = require('node:path');
const {lstatSync, readFileSync, writeFileSync} = require('node:fs');
const {createHash} = require('node:crypto');

module.exports = class EvidenceReporter {
  onRunComplete(contexts, results) {
    const projectRequire = createRequire(join(process.cwd(), 'package.json'));
    const jest = projectRequire('jest/package.json').version;
    const expo = projectRequire('jest-expo/package.json').version;
    let errors = results.numRuntimeErrorTestSuites + Number(results.wasInterrupted);
    let failed = 0, timeouts = 0;
    const files = new Set();
    for (const result of results.testResults) {
      if (files.has(result.testFilePath)) errors++;
      files.add(result.testFilePath);
      try {
        const key = createHash('sha256').update(result.testFilePath).digest('hex');
        const path = `${process.env.SESHAT_RECEIPT}.events-${key}`;
        const info = lstatSync(path);
        if (!info.isFile() || info.nlink !== 1 || info.size > 16384) throw Error('unsafe event receipt');
        const event = JSON.parse(readFileSync(path, 'utf8'));
        if (event.version !== 1 || event.executionId !== process.env.SESHAT_EXECUTION_ID
          || event.file !== result.testFilePath
          || !['hookFailures','testFailures','timeouts','retries'].every(k => Number.isSafeInteger(event[k]) && event[k] >= 0)) throw Error('invalid event receipt');
        errors += event.hookFailures + event.retries + Number(Boolean(result.testExecError));
        failed += event.testFailures;
        timeouts += event.timeouts;
      } catch { errors++; }
    }
    // Hook failures can appear as failed tests. Do not infer their origin from totals.
    if (!timeouts && failed !== results.numFailedTests) errors++;
    const complete = contexts.size === 1 && files.size === results.numTotalTestSuites && files.size > 0;
    writeFileSync(process.env.SESHAT_RECEIPT, JSON.stringify({version:1,
      executionId:process.env.SESHAT_EXECUTION_ID, runner:'jest', node:process.versions.node,
      jest, expo, complete, passed:results.numPassedTests, failed, errors, timeouts}), {flag:'wx'});
  }
};
