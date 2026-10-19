import {readFileSync, writeFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';

function fileCoverage(modules, context, identitiesComplete, reason) {
  const fallback = {version:1, complete:false, files:[]};
  try {
    const paths = JSON.parse(readFileSync(process.env.SESHAT_SOURCES, 'utf8'));
    const coverage = context.config.coverage;
    if (!identitiesComplete || !modules.length || reason === 'interrupted' || context.version.split('.')[0] !== '5'
      || new Set(modules.map(module => module.project)).size !== 1
      || !Array.isArray(paths) || !paths.every(path => typeof path === 'string' && isAbsolute(path))
      || new Set(paths).size !== paths.length || coverage?.enabled !== true || coverage.provider !== 'istanbul'
      || coverage.instrumenter || coverage.customProviderModule || coverage.autoAttachSubprocess
      || coverage.ignoreClassMethods?.length) return fallback;
    paths.sort();
    const files = [];
    for (const module of modules) {
      const config = module.project.config, evidence = module.meta().seshatFileCoverage;
      if (config.isolate !== true || !['forks', 'threads'].includes(config.pool) || config.browser?.enabled
        || config.coverage?.instrumenter || config.coverage?.ignoreClassMethods?.length
        || !evidence || evidence.executionId !== process.env.SESHAT_EXECUTION_ID
        || evidence.file !== module.moduleId || evidence.complete !== true
        || JSON.stringify(evidence.candidates) !== JSON.stringify(paths) || !Array.isArray(evidence.sources)) return fallback;
      const seen = new Set();
      for (const source of evidence.sources) {
        if (!paths.includes(source.path) || seen.has(source.path)
          || typeof source.hit !== 'boolean' || typeof source.static !== 'boolean') return fallback;
        seen.add(source.path);
      }
      files.push({file:module.moduleId, sources:evidence.sources.slice().sort((a, b) => compare(a.path, b.path))});
    }
    return {version:1, complete:true, files:files.sort((a, b) => compare(a.file, b.file))};
  } catch { return fallback; }
}

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

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
    const testFiles = [], tests = [];
    let identitiesComplete = true;
    const inspect = items => {
      // Verified Vitest 5 diagnostic. Unknown errors never become timeouts by exit code.
      timeouts += items.filter(e => /^(Test|Hook) timed out in \d+ms(?:\.| while waiting for )/.test(e.message ?? '')).length;
    };
    inspect(unhandled);
    for (const module of modules) {
      const file = module.moduleId;
      const validFile = typeof file === 'string' && isAbsolute(file);
      if (!validFile || testFiles.includes(file)) identitiesComplete = false;
      else testFiles.push(file);
      for (const suite of [module, ...module.children.allSuites()]) {
        errors += suite.errors().length;
        inspect(suite.errors());
      }
      for (const test of module.children.allTests()) {
        const result = test.result(), details = test.meta().seshat;
        const issues = result.errors ?? [];
        inspect(issues);
        if (details?.executionId === process.env.SESHAT_EXECUTION_ID && details.entered
          && ['passed', 'failed'].includes(result.state)) {
          const id = test.fullName;
          if (!validFile || typeof id !== 'string' || !id.length || test.module.moduleId !== file) identitiesComplete = false;
          else tests.push({file, id});
        }
        if (!details || details.executionId !== process.env.SESHAT_EXECUTION_ID || details.unsupported
          || test.diagnostic()?.retryCount || test.diagnostic()?.repeatCount) { errors++; continue; }
        if (result.state === 'passed' && issues.length === 0 && details.entered) passed++;
        else if (result.state === 'failed' && details.entered && issues.length > 0
          && details.beforeCleanup === JSON.stringify(issues.map(e => [e.name,e.message,e.stack]))) failed++;
        else errors++;
      }
    }
    const maxWorkers = resolvedMaxWorkers(modules);
    const selection = Boolean(process.env.SESHAT_COVERAGE_REPORT) && process.env.SESHAT_TEST_SELECTION === '1';
    writeFileSync(process.env.SESHAT_RECEIPT, JSON.stringify({version:1,
      executionId:process.env.SESHAT_EXECUTION_ID, runner:'vitest', vitest:this.context.version,
      actual:{vitest:this.context.version}, maxWorkers,
      node:process.versions.node, complete:modules.length > 0 && reason !== 'interrupted',
      passed, failed, errors, timeouts, testFiles:testFiles.sort(),
      tests:tests.sort((a, b) => compare(a.file, b.file) || compare(a.id, b.id)),
      ...(selection ? {fileCoverage:fileCoverage(modules, this.context,
        identitiesComplete && errors === 0 && timeouts === 0, reason)} : {})}), {flag:'wx'});
  }
}
