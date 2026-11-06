const {createRequire} = require('node:module');
const {basename, dirname, isAbsolute, join} = require('node:path');
const {lstatSync, readFileSync, realpathSync, writeFileSync} = require('node:fs');
const {createHash} = require('node:crypto');

function packageVersion(root, name) {
  try {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return packageJson.name === name && typeof packageJson.version === 'string'
      ? packageJson.version : undefined;
  } catch { return undefined; }
}

function packageVersionAtPath(path, name) {
  let directory;
  try { directory = dirname(realpathSync(path)); } catch { return undefined; }
  for (;;) {
    const version = packageVersion(directory, name);
    if (version) return version;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function selectedPackageVersion(contexts, name) {
  const versions = new Set();
  for (const context of contexts ?? []) {
    const config = context?.config;
    const paths = [config?.preset, config?.testEnvironment,
      ...(config?.setupFiles ?? []), ...(config?.setupFilesAfterEnv ?? [])];
    for (const path of paths) {
      if (typeof path !== 'string') continue;
      const version = packageVersionAtPath(path, name);
      if (version) versions.add(version);
    }
  }
  return versions.size === 1 ? versions.values().next().value : undefined;
}

function executingVersions(executable, contexts) {
  if (typeof executable !== 'string') return {};
  let script;
  try { script = realpathSync(executable); } catch { return {}; }
  const root = dirname(dirname(script));
  if (basename(script) !== 'jest.js' || basename(dirname(script)) !== 'bin'
    || basename(root) !== 'jest') return {};
  const actual = {jest: packageVersion(root, 'jest')};
  actual['jest-expo'] = selectedPackageVersion(contexts, 'jest-expo');
  return Object.fromEntries(Object.entries(actual).filter(([, version]) => version));
}

const stable = path => path.replaceAll('\\', '/');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const same = (a, b) => JSON.stringify([...a].sort(compare)) === JSON.stringify([...b].sort(compare));

function coveragePaths(result) {
  if (result.v8Coverage) return undefined;
  // Jest omits the map when an isolated file imports no instrumented source.
  if (result.coverage === undefined) return [];
  if (!result.coverage || typeof result.coverage !== 'object') return undefined;
  const paths = [];
  for (const [path, source] of Object.entries(result.coverage)) {
    // The verified Babel route already maps to original sources. Other mapping routes need a separate proof.
    if (!isAbsolute(path) || !source || typeof source.path !== 'string'
      || stable(source.path) !== stable(path) || source.inputSourceMap) return undefined;
    for (const [counter, map] of [['s', 'statementMap'], ['f', 'fnMap']]) {
      if (!source[counter] || !source[map] || typeof source[counter] !== 'object' || typeof source[map] !== 'object'
        || !same(Object.keys(source[counter]), Object.keys(source[map]))
        || !Object.values(source[counter]).every(value => Number.isSafeInteger(value) && value >= 0)) return undefined;
    }
    paths.push(stable(path));
  }
  return new Set(paths).size === paths.length ? paths : undefined;
}

function controlledProject(contexts, globalConfig, actual) {
  if (contexts.size !== 1 || actual.jest !== '29.7.0' || !['57.0.5', '57.0.6'].includes(actual['jest-expo'])
    || globalConfig.projects?.length > 1 || globalConfig.bail || globalConfig.shard || globalConfig.randomize
    || globalConfig.testNamePattern || globalConfig.onlyChanged || globalConfig.onlyFailures
    || globalConfig.findRelatedTests || globalConfig.watch || globalConfig.watchAll || globalConfig.listTests
    || globalConfig.workerThreads) return false;
  const config = [...contexts][0]?.config;
  try {
    return realpathSync(config.testEnvironment) === realpathSync(join(__dirname, 'jest-expo-environment.cjs'))
      && !config.globalSetup && !config.globalTeardown
      && packageVersionAtPath(config.runner, 'jest-runner') === '29.7.0'
      && packageVersionAtPath(config.testRunner, 'jest-circus') === '29.7.0';
  } catch { return false; }
}

function selectionReport(contexts, results, events, actual, globalConfig, coverage) {
  if (process.env.SESHAT_TEST_SELECTION !== '1' || !controlledProject(contexts, globalConfig, actual)) return {};
  const testFiles = [], tests = [];
  for (const result of results.testResults) {
    const event = events.get(result.testFilePath), evidence = event?.selection;
    const file = stable(result.testFilePath), expected = [];
    if (!isAbsolute(file) || !evidence || evidence.version !== 1 || !Array.isArray(evidence.entered)
      || !Array.isArray(evidence.completed) || !Array.isArray(result.testResults)) return {};
    for (const test of result.testResults) {
      if (!['passed', 'failed'].includes(test.status) || test.invocations !== 1
        || !Array.isArray(test.ancestorTitles) || !test.ancestorTitles.every(name => typeof name === 'string')
        || typeof test.title !== 'string') return {};
      const names = [...test.ancestorTitles, test.title];
      if (test.fullName !== names.join(' ')) return {};
      expected.push(JSON.stringify(names));
    }
    if (expected.length !== event.passed + event.failed
      || !evidence.entered.every(id => typeof id === 'string') || !evidence.completed.every(id => typeof id === 'string')
      || !same(expected, evidence.entered) || !same(expected, evidence.completed)) return {};
    testFiles.push(file);
    tests.push(...expected.map(id => ({file, id})));
  }
  if (!tests.length) return {};
  const identities = {testFiles:testFiles.sort(compare),
    tests:tests.sort((a, b) => compare(a.file, b.file) || compare(a.id, b.id))};
  if (!process.env.SESHAT_COVERAGE_REPORT) return identities;
  const fallback = {...identities, fileCoverage:{version:1, complete:false, files:[]}};
  try {
    const candidates = JSON.parse(readFileSync(process.env.SESHAT_SOURCES, 'utf8'));
    if (globalConfig.collectCoverage !== true || globalConfig.coverageProvider !== 'babel'
      || !Array.isArray(candidates) || !candidates.every(path => typeof path === 'string' && isAbsolute(path))
      || new Set(candidates).size !== candidates.length) return fallback;
    candidates.sort(compare);
    const config = [...contexts][0].config;
    for (const path of candidates) {
      const transform = config.transform?.find(([pattern]) => new RegExp(pattern).test(path));
      if (!transform || packageVersionAtPath(transform[1], 'babel-jest') !== '29.7.0'
        || config.transformIgnorePatterns?.some(pattern => new RegExp(pattern).test(path))) return fallback;
    }
    const files = [];
    for (const result of results.testResults) {
      const evidence = events.get(result.testFilePath).selection;
      const key = createHash('sha256').update(result.testFilePath).digest('hex');
      try { lstatSync(`${process.env.SESHAT_RECEIPT}.events-${key}-invalid`); return fallback; }
      catch (error) { if (error.code !== 'ENOENT') return fallback; }
      const paths = coverage.get(result.testFilePath), observation = evidence.coverage;
      if (!paths || !observation || observation.complete !== true || !Array.isArray(observation.sources)
        || JSON.stringify(evidence.candidates) !== JSON.stringify(candidates)) return fallback;
      const seen = new Set();
      for (const source of observation.sources) {
        if (!candidates.includes(source.path) || seen.has(source.path) || typeof source.hit !== 'boolean'
          || typeof source.static !== 'boolean') return fallback;
        seen.add(source.path);
      }
      if (!same([...seen].map(stable), paths.filter(path => candidates.some(candidate => stable(candidate) === path)))) return fallback;
      files.push({file:stable(result.testFilePath), sources:observation.sources});
    }
    return {...identities, fileCoverage:{version:1, complete:true, files:files.sort((a, b) => compare(a.file, b.file))}};
  } catch { return fallback; }
}

module.exports = class EvidenceReporter {
  constructor(globalConfig = {}) {
    this.globalConfig = globalConfig;
    this.coverage = new Map();
  }
  onTestResult(test, result) {
    if (process.env.SESHAT_TEST_SELECTION !== '1' || !process.env.SESHAT_COVERAGE_REPORT) return;
    let paths;
    try { paths = coveragePaths(result); } catch { /* Optional selection evidence must not change the verdict. */ }
    this.coverage.set(result.testFilePath, this.coverage.has(result.testFilePath) ? undefined : paths);
  }
  onRunComplete(contexts, results) {
    const projectRequire = createRequire(join(process.cwd(), 'package.json'));
    const jest = projectRequire('jest/package.json').version;
    const expo = projectRequire('jest-expo/package.json').version;
    // Keep cwd-resolved fields for the existing assessment contract; diagnostics use actual.
    const actual = executingVersions(process.argv[1], contexts);
    let errors = results.numRuntimeErrorTestSuites + Number(results.wasInterrupted);
    let passed = 0, failed = 0, timeouts = 0, testHookErrors = 0;
    const files = new Set();
    const events = new Map();
    for (const result of results.testResults) {
      if (files.has(result.testFilePath)) errors++;
      files.add(result.testFilePath);
      try {
        const key = createHash('sha256').update(result.testFilePath).digest('hex');
        const path = `${process.env.SESHAT_RECEIPT}.events-${key}`;
        const info = lstatSync(path);
        if (!info.isFile() || info.nlink !== 1 || info.size > 16384) throw Error('unsafe event receipt');
        const event = JSON.parse(readFileSync(path, 'utf8'));
        if (event.version !== 2 || event.executionId !== process.env.SESHAT_EXECUTION_ID
          || event.file !== result.testFilePath
          || !['hookFailures','testHookErrors','passed','failed','unattributedErrors','timeouts','retries']
            .every(k => Number.isSafeInteger(event[k]) && event[k] >= 0)
          || event.testHookErrors > event.hookFailures
          || (event.testHookErrors > 0 && event.failed === 0)) throw Error('invalid event receipt');
        events.set(result.testFilePath, event);
        errors += event.hookFailures + event.retries + event.unattributedErrors + Number(Boolean(result.testExecError));
        testHookErrors += event.testHookErrors;
        passed += event.passed;
        failed += event.failed;
        timeouts += event.timeouts;
        if (event.passed !== result.numPassingTests || event.failed !== result.numFailingTests) errors++;
      } catch { errors++; }
    }
    if (passed !== results.numPassedTests || failed !== results.numFailedTests) errors++;
    const complete = contexts.size === 1 && files.size === results.numTotalTestSuites && files.size > 0;
    const selection = complete && errors === 0 && timeouts === 0
      ? selectionReport(contexts, results, events, actual, this.globalConfig, this.coverage) : {};
    writeFileSync(process.env.SESHAT_RECEIPT, JSON.stringify({version:1,
      executionId:process.env.SESHAT_EXECUTION_ID, runner:'jest', node:process.versions.node,
      jest, expo, actual, complete, passed, failed, errors, testHookErrors, timeouts, ...selection}), {flag:'wx'});
  }
};

module.exports.executingVersions = executingVersions;
