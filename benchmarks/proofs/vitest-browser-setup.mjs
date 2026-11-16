// Vitest 5 browser mode: the page builds its runner from TestRunner and ignores
// `test.runner`, so wrap the live instance with vitest-runner.mjs's hooks. The
// global is undocumented, so check its shape and fail the baseline with the
// missing piece rather than a generic missing-evidence.
import {inject, TestRunner} from 'vitest';

function shapeProblem(runner) {
  if (!runner) return 'window.__vitest_browser_runner__.runner is missing';
  if (typeof runner.onBeforeRunTask !== 'function') return 'runner.onBeforeRunTask is not a function';
  if (typeof runner.onTaskFinished !== 'function') return 'runner.onTaskFinished is not a function';
  // Replacing a runTask of Vitest's own would drop whatever it does.
  if (runner.runTask !== undefined) return 'runner.runTask already exists';
  if (typeof TestRunner.getTestFn !== 'function') return 'TestRunner.getTestFn is not a function';
}

const version = inject('seshatBrowserVitest');
const runner = globalThis.__vitest_browser_runner__?.runner;
// In Node mode the runner adapter records evidence instead. A second run on the
// same runner would find its own runTask and stop.
if (version !== undefined && !runner?.seshatEvidence) {
  const problem = shapeProblem(runner);
  if (problem) throw new Error(`Seshat cannot record evidence in Vitest ${version} browser mode: ${problem}`);
  // Mark before the await below, so a second setup run cannot also wrap.
  runner.seshatEvidence = true;
  const executionId = inject('seshatExecutionId');
  // Recorded, not checked: the version a support report needs. Chromium's
  // reduced user agent may hide the full version; its User-Agent Client Hints
  // API (Chromium only) does not. Firefox's user agent gives major and minor only.
  const browserVersion = (await navigator.userAgentData?.getHighEntropyValues(['fullVersionList']))
    ?.fullVersionList.find(({brand}) => brand === 'Chromium')?.version
    ?? navigator.userAgent.match(/ Firefox\/(\d+(?:\.\d+)+)$/)?.[1] ?? null;
  const before = runner.onBeforeRunTask.bind(runner);
  runner.onBeforeRunTask = async test => {
    await before(test);
    test.meta.seshat = {executionId, entered:false, browserVersion,
      unsupported:Boolean(test.fails || test.concurrent || test.retry || test.repeats)};
  };
  runner.runTask = async test => {
    test.meta.seshat.entered = true;
    // This is Vitest's already-wrapped callback, including its timeout and fixtures.
    await TestRunner.getTestFn(test)();
  };
  const finished = runner.onTaskFinished.bind(runner);
  runner.onTaskFinished = async test => {
    await finished(test);
    test.meta.seshat.beforeCleanup = JSON.stringify((test.result?.errors ?? []).map(e => [e.name,e.message,e.stack]));
  };
}
