import {writeFileSync} from 'node:fs';

export default class EvidenceReporter {
  onInit(context) { this.context = context; }
  onTestRunEnd(modules, unhandled, reason) {
    let passed = 0, failed = 0, errors = unhandled.length, timeouts = 0;
    const inspect = items => {
      // Verified Vitest 5 diagnostic. Unknown errors never become timeouts by exit code.
      timeouts += items.filter(e => /^(Test|Hook) timed out in \d+ms(?:\.| while waiting for )/.test(e.message ?? '')).length;
    };
    inspect(unhandled);
    for (const module of modules) {
      for (const suite of [module, ...module.children.allSuites()]) {
        errors += suite.errors().length;
        inspect(suite.errors());
      }
      for (const test of module.children.allTests()) {
        const result = test.result(), details = test.meta().seshat;
        const issues = result.errors ?? [];
        inspect(issues);
        if (!details || details.executionId !== process.env.SESHAT_EXECUTION_ID || details.unsupported
          || test.diagnostic()?.retryCount || test.diagnostic()?.repeatCount) { errors++; continue; }
        if (result.state === 'passed' && issues.length === 0 && details.entered) passed++;
        else if (result.state === 'failed' && details.entered && issues.length > 0
          && details.beforeCleanup === JSON.stringify(issues.map(e => [e.name,e.message,e.stack]))) failed++;
        else errors++;
      }
    }
    writeFileSync(process.env.SESHAT_RECEIPT, JSON.stringify({version:1,
      executionId:process.env.SESHAT_EXECUTION_ID, runner:'vitest', vitest:this.context.version,
      node:process.versions.node, complete:modules.length > 0 && reason !== 'interrupted',
      passed, failed, errors, timeouts}), {flag:'wx'});
  }
}
