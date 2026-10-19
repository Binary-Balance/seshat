// Vitest 5: observe the existing callback and its result before cleanup.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {isAbsolute, join} from 'node:path';
import {pathToFileURL} from 'node:url';
const require = createRequire(join(process.cwd(), 'package.json'));
// require.resolve('vitest') selects its deliberately failing CommonJS entry.
const {TestRunner} = await import(new URL('./dist/index.js', pathToFileURL(require.resolve('vitest/package.json'))).href);

function configuredSources() {
  try {
    const paths = JSON.parse(readFileSync(process.env.SESHAT_SOURCES, 'utf8'));
    if (Array.isArray(paths) && paths.every(path => typeof path === 'string' && isAbsolute(path))
      && new Set(paths).size === paths.length) return paths.sort();
  } catch {}
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validCount = value => Number.isSafeInteger(value) && value >= 0;

// Keep the original counter objects: replacement or a reset invalidates the delta.
export function beginFileCoverage(paths, coverage = globalThis.__VITEST_COVERAGE__, allowEmpty = false) {
  const snapshots = new Map(), restores = [];
  let complete = record(coverage) || allowEmpty && coverage === undefined;
  try {
    if (!complete) throw new Error('Coverage is unavailable');
    for (const [path, entry] of Object.entries(coverage ?? {})) {
      // Other raw IDs, including ?query imports, can map back to a selected source.
      if (!paths.includes(path) || !isAbsolute(path) || !record(entry) || entry.path !== path) throw new Error('Coverage identity conflict');
    }
    for (const path of paths) {
      // Omission is unknown, never a zero. The merged report must resolve it.
      if (!Object.hasOwn(coverage ?? {}, path)) continue;
      const entry = coverage[path];
      const snapshot = {entry, shape:JSON.stringify([entry.hash, entry.fnMap, entry.statementMap]), metrics:[]};
      if (typeof entry.hash !== 'string') throw new Error('Coverage identity is unavailable');
      for (const [metric, map] of [['f', 'fnMap'], ['s', 'statementMap']]) {
        const counters = entry[metric];
        if (!record(counters) || !record(entry[map])
          || JSON.stringify(Object.keys(counters).sort()) !== JSON.stringify(Object.keys(entry[map]).sort())) {
          throw new Error('Coverage counters are incomplete');
        }
        const counts = {...counters};
        snapshot.metrics.push({metric, counters, counts});
        for (const key of Object.keys(counts)) {
          let count = counts[key];
          const descriptor = Object.getOwnPropertyDescriptor(counters, key);
          if (!validCount(count) || !descriptor?.configurable || !descriptor.writable || !('value' in descriptor)) {
            throw new Error('Coverage counters cannot be observed');
          }
          const get = () => count;
          // A reset followed by more calls can hide behind a larger final count.
          Object.defineProperty(counters, key, {configurable:descriptor.configurable, enumerable:descriptor.enumerable,
            get, set(value) {
              if (!validCount(value) || value < count) complete = false;
              count = value;
            }});
          restores.push(() => {
            if (Object.getOwnPropertyDescriptor(counters, key)?.get !== get) complete = false;
            else Object.defineProperty(counters, key, {...descriptor, value:count});
          });
        }
      }
      snapshots.set(path, snapshot);
    }
  } catch { complete = false; }
  return {
    finish(current = globalThis.__VITEST_COVERAGE__) {
      const sources = [];
      try {
        if (current !== coverage) complete = false;
        for (const [path, entry] of Object.entries(current ?? {})) {
          if (!paths.includes(path) || !isAbsolute(path) || !record(entry) || entry.path !== path) complete = false;
        }
        for (const path of paths) {
          const snapshot = snapshots.get(path), entry = current?.[path];
          // Late imports cannot be monitored throughout the suite, so fall back.
          if (!snapshot) { if (entry !== undefined) complete = false; continue; }
          if (entry !== snapshot.entry || entry.path !== path
            || JSON.stringify([entry.hash, entry.fnMap, entry.statementMap]) !== snapshot.shape) {
            complete = false; continue;
          }
          let hit = false, staticHit = false;
          for (const {metric, counters, counts} of snapshot.metrics) {
            if (entry[metric] !== counters
              || JSON.stringify(Object.keys(counters).sort()) !== JSON.stringify(Object.keys(counts).sort())) {
              complete = false; continue;
            }
            for (const [key, before] of Object.entries(counts)) {
              const after = counters[key];
              if (!validCount(after) || after < before) complete = false;
              if (after > before) hit = true;
              if (metric === 'f' && before > 0) staticHit = true;
            }
          }
          sources.push({path, hit, static:staticHit});
        }
      } catch { complete = false; }
      for (const restore of restores) {
        try { restore(); } catch { complete = false; }
      }
      return {complete, sources:complete ? sources : []};
    },
  };
}

export default class EvidenceRunner extends TestRunner {
  selection = Boolean(process.env.SESHAT_COVERAGE_REPORT) && process.env.SESHAT_TEST_SELECTION === '1';
  sources = this.selection ? configuredSources() : undefined;
  fileBatches = 0;
  coverageSupported() {
    const coverage = this.config.coverage;
    return this.config.isolate === true && ['forks', 'threads'].includes(this.pool)
      && this.workerState.environment.name === 'node' && this.workerState.ctx.environment.name === 'node'
      && coverage?.enabled === true
      && coverage.provider === 'istanbul' && !coverage.customProviderModule && !coverage.autoAttachSubprocess;
  }
  async onBeforeRunFiles(files) {
    await super.onBeforeRunFiles?.(files);
    this.fileBatchSafe = ++this.fileBatches === 1 && files.length === 1;
  }
  async onBeforeRunSuite(suite) {
    await super.onBeforeRunSuite(suite);
    if (!this.selection || suite.file !== suite) return;
    const overlapping = Boolean(this.activeCoverage);
    this.activeCoverage?.finish();
    this.activeCoverage = undefined;
    suite.meta.seshatFileCoverage = {executionId:process.env.SESHAT_EXECUTION_ID, file:suite.filepath,
      candidates:this.sources, complete:false, sources:[]};
    // Skipped and collection-failed roots do not receive onAfterRunSuite.
    if (overlapping || !this.fileBatchSafe || !this.sources || !this.coverageSupported()
      || !isAbsolute(suite.filepath) || !['run', 'queued'].includes(suite.mode) || suite.result?.state === 'fail') return;
    this.coverageRoot = suite;
    // Unrelated files may load no instrumented module. Rust resolves omissions
    // against the complete mapped coverage report before selecting any files.
    this.activeCoverage = beginFileCoverage(this.sources, globalThis.__VITEST_COVERAGE__, true);
  }
  async onAfterRunSuite(suite) {
    await super.onAfterRunSuite(suite);
    if (suite.file !== suite || !this.activeCoverage) return;
    // Vitest calls this after aroundAll, afterAll and file fixture cleanup.
    const evidence = this.activeCoverage.finish();
    this.activeCoverage = undefined;
    if (this.coverageRoot === suite && this.coverageSupported() && !this.cancelRun) {
      Object.assign(suite.meta.seshatFileCoverage, evidence);
    }
  }
  async onAfterRunFiles(files) {
    this.activeCoverage?.finish();
    this.activeCoverage = undefined;
    await super.onAfterRunFiles(files);
  }
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
