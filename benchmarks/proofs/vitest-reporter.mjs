import {writeFileSync} from 'node:fs';

function resolvedMaxWorkers(modules) {
  const projects = [...new Set(modules.map(module => module.project).filter(Boolean))];
  const values = projects.map(project => project.config?.maxWorkers);
  if (!values.length || values.some(value => !Number.isSafeInteger(value) || value < 1)) return undefined;
  return values.every(value => value === values[0]) ? values[0] : undefined;
}

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
    const maxWorkers = resolvedMaxWorkers(modules);
    writeFileSync(process.env.SESHAT_RECEIPT, JSON.stringify({version:1,
      executionId:process.env.SESHAT_EXECUTION_ID, runner:'vitest', vitest:this.context.version,
      actual:{vitest:this.context.version}, maxWorkers,
      node:process.versions.node, complete:modules.length > 0 && reason !== 'interrupted',
      passed, failed, errors, timeouts}), {flag:'wx'});
  }
}
