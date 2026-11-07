// Resolve the environment before Jest replaces it with Seshat's evidence adapter.
const {spawnSync} = require('node:child_process');
const {createRequire} = require('node:module');
const {join} = require('node:path');
const {realpathSync: realpath} = require('node:fs');
const {packageVersionAtPath, selectedPackageVersion} = require('./jest-reporter.cjs');

if (!process.env.SESHAT_JEST_ENVIRONMENT) {
  const started = performance.now();
  const adapter = realpath(join(__dirname, 'jest-expo-environment.cjs'));
  const args = process.argv.slice(1);
  let replaced = 0;
  const original = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    const match = /^(--env|--testEnvironment)(?:=(.*))?$/.exec(argument);
    if (match) {
      const value = match[2] ?? args[++index];
      if (realpath(value) !== adapter) throw Error('Seshat requires its Jest environment override');
      replaced++;
      // Keep the option boundary: --reporters can otherwise consume later test paths.
      original.push('--showConfig');
    } else original.push(argument);
  }
  if (replaced !== 1) throw Error('Seshat requires exactly one Jest environment override');
  const env = {...process.env};
  delete env.NODE_OPTIONS;
  const result = spawnSync(process.execPath, original, {
    cwd:process.cwd(), env, encoding:'utf8', timeout:15000, maxBuffer:1024 * 1024,
  });
  if (result.error || result.status !== 0) throw Error(`Seshat could not resolve Jest configuration: ${result.error?.message ?? result.stderr}`);
  let resolved;
  try { resolved = JSON.parse(result.stdout); }
  catch { throw Error('Seshat received invalid Jest configuration'); }
  if (resolved.version !== '29.7.0' || resolved.configs?.length !== 1) throw Error('Seshat supports one Jest 29.7.0 project');
  const config = resolved.configs[0];
  if (packageVersionAtPath(config.runner, 'jest-runner') !== '29.7.0'
    || packageVersionAtPath(config.testRunner, 'jest-circus') !== '29.7.0') throw Error('Seshat requires Jest runner and Circus 29.7.0');
  const expo = selectedPackageVersion([{config}], 'jest-expo');
  let environment;
  if (expo) {
    const projectRequire = createRequire(join(process.cwd(), 'package.json'));
    const preset = projectRequire('jest-expo/jest-preset');
    if (!['57.0.5', '57.0.6'].includes(expo)
      || realpath(config.testEnvironment) !== realpath(projectRequire.resolve(preset.testEnvironment))) throw Error('Seshat requires the verified Expo environment');
    environment = {kind:'expo', path:config.testEnvironment};
  } else {
    const name = ['jest-environment-node', 'jest-environment-jsdom']
      .find(name => packageVersionAtPath(config.testEnvironment, name) === '29.7.0');
    if (!name) throw Error('Seshat supports jest-environment-node or jest-environment-jsdom 29.7.0');
    if (resolved.globalConfig.coverageProvider !== 'babel') throw Error('Seshat plain Jest requires Babel coverage');
    if (!config.transform?.length || config.transform.some(([, path]) => packageVersionAtPath(path, 'babel-jest') !== '29.7.0')) throw Error('Seshat plain Jest requires babel-jest 29.7.0');
    environment = {kind:'plain', name, version:'29.7.0', path:config.testEnvironment};
  }
  process.env.SESHAT_JEST_ENVIRONMENT = JSON.stringify(environment);
  process.env.SESHAT_JEST_CONFIG_MS = String(performance.now() - started);
}
