// Prototype only (#159). Browser mode ignores `test.runner`, so this setup file
// wraps the live browser runner instance with the hooks the Node adapter uses.
import {inject, TestRunner} from 'vitest';
type Task = {fails?: boolean, concurrent?: boolean, retry?: number, repeats?: number,
  meta: Record<string, any>, result?: {errors?: {name?: string, message?: string, stack?: string}[]}};
type Runner = {seshatEvidence?: boolean, onBeforeRunTask?: (test: Task) => unknown,
  runTask?: (test: Task) => Promise<void>, onTaskFinished?: (test: Task) => unknown};
const runner: Runner | undefined = (window as any).__vitest_browser_runner__?.runner;
// The Node config supplies the job's identity; the page has no process.env.
const executionId = inject('seshatExecutionId' as never);
// Experimental switching reads globalThis.process.env, which the page also
// lacks. Expose only the mutant ID, and only when the config forwards one.
const mutantId: string | undefined = inject('seshatMutantId' as never);
if (mutantId !== undefined) (globalThis as any).process ??= {env: {SESHAT_MUTANT_ID: mutantId}};
if (runner && !runner.seshatEvidence) {
  runner.seshatEvidence = true;
  const before = runner.onBeforeRunTask?.bind(runner);
  runner.onBeforeRunTask = async test => {
    await before?.(test);
    test.meta.seshat = {executionId, entered: false,
      unsupported: Boolean(test.fails || test.concurrent || test.retry || test.repeats)};
  };
  runner.runTask = async test => {
    test.meta.seshat!.entered = true;
    await (TestRunner as any).getTestFn(test)();
  };
  const finished = runner.onTaskFinished?.bind(runner);
  runner.onTaskFinished = async test => {
    await finished?.(test);
    test.meta.seshat!.beforeCleanup = JSON.stringify((test.result?.errors ?? []).map(e => [e.name, e.message, e.stack]));
  };
}
