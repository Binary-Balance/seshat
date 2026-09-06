// Vitest 5.0.0: observe the existing callback and its result before cleanup.
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const require = createRequire(join(process.cwd(), 'package.json'));
// require.resolve('vitest') selects its deliberately failing CommonJS entry.
const {TestRunner} = await import(new URL('./dist/index.js', pathToFileURL(require.resolve('vitest/package.json'))).href);

export default class EvidenceRunner extends TestRunner {
  async onBeforeRunTask(test) {
    await super.onBeforeRunTask(test);
    test.meta.seshat = {executionId:process.env.SESHAT_EXECUTION_ID, entered:false,
      unsupported:Boolean(test.fails || test.concurrent || test.retry || test.repeats)};
  }
  async runTask(test) {
    test.meta.seshat.entered = true;
    // This is Vitest's already-wrapped callback, including its timeout and fixtures.
    await TestRunner.getTestFn(test)();
  }
  async onTaskFinished(test) {
    await super.onTaskFinished?.(test);
    test.meta.seshat.beforeCleanup = JSON.stringify((test.result.errors ?? []).map(e => [e.name,e.message,e.stack]));
  }
}
