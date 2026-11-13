// Vitest 5 browser mode: the page builds its runner from TestRunner and ignores
// `test.runner`, so wrap the live instance with vitest-runner.mjs's hooks. The
// global is undocumented; if it moves, no evidence is recorded and the
// baseline fails (missing-evidence).
import {inject, TestRunner} from 'vitest';

const runner = globalThis.__vitest_browser_runner__?.runner;
const executionId = inject('seshatExecutionId');
if (runner && !runner.seshatEvidence) {
  runner.seshatEvidence = true;
  const before = runner.onBeforeRunTask?.bind(runner);
  runner.onBeforeRunTask = async test => {
    await before?.(test);
    test.meta.seshat = {executionId, entered:false,
      unsupported:Boolean(test.fails || test.concurrent || test.retry || test.repeats)};
  };
  runner.runTask = async test => {
    test.meta.seshat.entered = true;
    // This is Vitest's already-wrapped callback, including its timeout and fixtures.
    await TestRunner.getTestFn(test)();
  };
  const finished = runner.onTaskFinished?.bind(runner);
  runner.onTaskFinished = async test => {
    await finished?.(test);
    test.meta.seshat.beforeCleanup = JSON.stringify((test.result?.errors ?? []).map(e => [e.name,e.message,e.stack]));
  };
}
