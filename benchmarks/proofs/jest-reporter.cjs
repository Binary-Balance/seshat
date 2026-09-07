const {createRequire} = require('node:module');
const {basename, dirname, join} = require('node:path');
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

module.exports = class EvidenceReporter {
  onRunComplete(contexts, results) {
    const projectRequire = createRequire(join(process.cwd(), 'package.json'));
    const jest = projectRequire('jest/package.json').version;
    const expo = projectRequire('jest-expo/package.json').version;
    // Keep cwd-resolved fields for the existing assessment contract; diagnostics use actual.
    const actual = executingVersions(process.argv[1], contexts);
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
      jest, expo, actual, complete, passed:results.numPassedTests, failed, errors, timeouts}), {flag:'wx'});
  }
};

module.exports.executingVersions = executingVersions;
