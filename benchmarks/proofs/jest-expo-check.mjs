// Installed-command proof for the checked-in Jest/Expo fixture.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {nodeCommand, noRustProof, npmArgs, npmCommand, runProcess} from './process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const fixture = join(here, 'fixtures/jest-expo');
const baseFiles = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'babel.config.cjs',
  'jest.config.cjs',
  'src/status.tsx',
  'tests/status.test.tsx',
];
const fixtureBytes = Object.fromEntries(baseFiles.map(path => [path, readFileSync(join(fixture, path))]));

const {values} = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: false,
  options: {
    cli: {type: 'string'},
    deps: {type: 'string'},
    tarball: {type: 'string'},
    cases: {type: 'string'},
  },
});
const tarballArg = values.tarball ?? process.env.SESHAT_CLI_TARBALL;
const cliArg = values.cli ?? process.env.SESHAT_CLI_BINARY;
assert.ok(Boolean(tarballArg) !== Boolean(cliArg),
  'usage: node benchmarks/proofs/jest-expo-check.mjs (--tarball PATH | --cli PATH) [--deps PATH] [--cases LIST]');

const defaultCases = [
  'normal-1',
  'normal-repeat',
  'normal-2',
  'assertion-kill',
  'survivor',
  'before-all',
  'before-each',
  'after-each',
  'mixed-assertion-hook',
  'import-failure',
  'test-timeout',
  'hook-timeout',
  'missing-events',
  'missing-receipt',
  'retry-eventually-passes',
  'retry-baseline',
];
const requestedCases = (values.cases ?? defaultCases.join(','))
  .split(',').map(name => name.trim());
assert.ok(requestedCases.length > 0 && requestedCases.every(name => name.length > 0),
  '--cases must contain at least one non-empty case name');
assert.ok(requestedCases.every(name => defaultCases.includes(name)),
  `unknown --cases name (expected one of: ${defaultCases.join(', ')})`);
const wanted = new Set(requestedCases);

mkdirSync(join(repo, 'work/assurance-proofs'), {recursive: true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/jest-expo-check-'));
const project = join(work, 'input 🎸');
const scratch = join(work, 'scratch');
mkdirSync(project);
mkdirSync(scratch);
const npmEnv = {
  npm_config_cache: join(work, 'npm-cache'),
  npm_config_userconfig: join(work, 'user.npmrc'),
  npm_config_globalconfig: join(work, 'global.npmrc'),
  npm_config_update_notifier: 'false',
};
const rustProof = await noRustProof(repo);
const portable = path => relative(repo, path) || '.';
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

async function runCommand(command, args, cwd, expected = 0, extraEnv = {}) {
  const child = await runProcess(command, args, cwd, extraEnv, 180000);
  assert.equal(child.timedOut, false, `${command} timed out`);
  assert.equal(child.overflow, false, `${command} overflowed output`);
  assert.equal(child.status, expected, `${command} ${args.join(' ')}\n${child.stdout}\n${child.stderr}`);
  return child;
}

function sanitize(value) {
  return JSON.parse(JSON.stringify(value)
    .replaceAll(work, '<work>')
    .replaceAll(project, '<project>'));
}

function copyBaseProject(dependencyRoot) {
  mkdirSync(join(project, 'src'), {recursive: true});
  mkdirSync(join(project, 'tests'), {recursive: true});
  for (const path of baseFiles) writeFileSync(join(project, path), fixtureBytes[path]);
  if (!existsSync(join(project, 'node_modules'))) {
    cpSync(join(dependencyRoot, 'node_modules'), join(project, 'node_modules'), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
}

function removeIfPresent(path) {
  if (existsSync(path)) unlinkSync(path);
}

function resetProject(dependencyRoot) {
  removeIfPresent(join(project, 'src/control.ts'));
  removeIfPresent(join(project, 'tests/control.test.tsx'));
  removeIfPresent(join(project, 'conditional-environment.cjs'));
  copyBaseProject(dependencyRoot);
}

function fixtureVersions(root) {
  const names = [
    'jest',
    'jest-expo',
    'expo',
    'react-native',
    '@react-native/jest-preset',
    'babel-preset-expo',
    'react',
    'typescript',
  ];
  return Object.fromEntries(names.map(name => [
    name,
    JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version,
  ]));
}

function jestArgs(testPath, {reporter = true, environment = true} = {}) {
  const args = [
    nodeCommand,
    'node_modules/jest/bin/jest.js',
    '--config',
    'jest.config.cjs',
    '--runInBand',
    '--runTestsByPath',
    testPath,
    '--reporters=default',
  ];
  if (reporter) args.push('--reporters={seshatReporter}');
  if (environment) args.push('--env={seshatEnvironment}');
  return args;
}

function configFor({source, test, workers = 1, testArgs = jestArgs(test), timeoutMs = 60000, extraCapture = []}) {
  const coverageArgs = [
    ...testArgs,
    '--coverage',
    '--coverageProvider=babel',
    '--coverageReporters=json',
    '--coverageDirectory=coverage',
    '--collectCoverageFrom',
    source,
  ];
  return {
    source: {include: [source]},
    capture: [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'babel.config.cjs',
      'jest.config.cjs',
      'src',
      'tests',
      'node_modules',
      ...extraCapture,
    ],
    workers,
    setups: [{
      name: 'jest-expo',
      runner: 'jest',
      cwd: '.',
      timeoutMs,
      typecheck: [nodeCommand, 'node_modules/typescript/bin/tsc', '--project', 'tsconfig.json'],
      test: testArgs,
      coverage: {command: coverageArgs, report: 'coverage/coverage-final.json'},
    }],
  };
}

function writeControl(body, extraFiles = {}) {
  const source = 'export const ready = 1 === 1;\n';
  const test = `import {ready} from '../src/control';\n${body}\n`;
  writeFileSync(join(project, 'src/control.ts'), source);
  writeFileSync(join(project, 'tests/control.test.tsx'), test);
  for (const [path, content] of Object.entries(extraFiles)) writeFileSync(join(project, path), content);
  return {source, test, extraFiles};
}

function assertUnchanged(expectedControl = null) {
  for (const [path, bytes] of Object.entries(fixtureBytes)) {
    assert.deepEqual(readFileSync(join(fixture, path)), bytes, `fixture changed: ${path}`);
  }
  for (const [path, bytes] of Object.entries(fixtureBytes)) {
    assert.deepEqual(readFileSync(join(project, path)), bytes, `project changed: ${path}`);
  }
  if (expectedControl) {
    assert.equal(readFileSync(join(project, 'src/control.ts'), 'utf8'), expectedControl.source);
    assert.equal(readFileSync(join(project, 'tests/control.test.tsx'), 'utf8'), expectedControl.test);
    for (const [path, content] of Object.entries(expectedControl.extraFiles ?? {})) {
      assert.equal(readFileSync(join(project, path), 'utf8'), content, `project changed: ${path}`);
    }
  }
  assert.deepEqual(readdirSync(scratch), [], 'Seshat scratch was not cleaned');
}

function stableMutation(result) {
  const mutation = result.mutation ?? result;
  return mutation.outcomes.map(({id, path, localId, offset, original, replacement, verdict}) =>
    ({id, path, localId, offset, original, replacement, verdict}));
}

function assertNormal(result, workers) {
  assert.equal(result.complete, true, JSON.stringify(result));
  const setup = result.setups[0];
  assert.equal(setup.typecheck.state, 'passed');
  assert.equal(setup.baseline.state, 'passed');
  assert.equal(setup.baseline.report.passed, 3);
  assert.equal(setup.baseline.report.failed, 0);
  assert.equal(setup.baseline.report.errors, 0);
  assert.equal(setup.baseline.report.timeouts, 0);
  assert.equal(setup.coverage.state, 'passed');
  assert.equal(setup.coverage.report.passed, 3);
  assert.equal(setup.coverage.report.errors, 0);
  assert.equal(setup.coverage.report.timeouts, 0);
  assert.deepEqual(result.sources.map(source => ({path: source.path, complete: source.result.complete,
    functions: source.result.functions.map(({name, complexity, coverage, covered, total, crap, status}) =>
      ({name, complexity, coverage, covered, total, crap, status})), problems: source.result.problems})),
  [{path: 'src/status.tsx', complete: true, functions: [
    {complexity: 2, coverage: 1, covered: 3, total: 3, crap: 2, name: 'classify', status: 'measured'},
    {complexity: 1, coverage: 1, covered: 1, total: 1, crap: 1, name: 'isPositive', status: 'measured'},
    {complexity: 1, coverage: 1, covered: 1, total: 1, crap: 1, name: 'statusCard', status: 'measured'},
  ], problems: []}]);
  assert.equal(result.mutation.complete, true);
  assert.equal(result.mutation.planned, 4);
  assert.equal(result.mutation.killed, 3);
  assert.equal(result.mutation.survived, 1);
  assert.equal(result.mutation.score, 75);
  assert.deepEqual(result.mutation.outcomes.map(outcome => outcome.verdict),
    ['killed', 'killed', 'survived', 'killed']);
  assert.equal(result.mutation.workersUsed, workers);
  assert.equal(result.mutation.workerBaselineJobs, workers - 1);
  assert.equal(result.mutation.workerBaselines.length, workers - 1);
  assert.ok(result.mutation.workerBaselines.every(row => row.state === 'passed' && row.report.passed === 3));
  assert.equal(result.jobsAttempted, workers === 1 ? 7 : 8);
}

function assertControl(result, expected) {
  const setup = result.setups[0];
  assert.equal(setup.typecheck.state, expected.typecheck ?? 'passed');
  if (expected.baseline === 'passed') {
    assert.equal(setup.baseline.state, 'passed');
    assert.equal(setup.baseline.report.passed, 1);
    assert.equal(setup.coverage.state, 'passed');
    assert.equal(setup.coverage.report.passed, 1);
  } else {
    assert.equal(setup.baseline.state, expected.baseline);
    assert.equal(setup.coverage.state, 'not-run');
  }
  assert.equal(result.mutation.planned, 1);
  const complete = expected.verdict === 'killed' || expected.verdict === 'survived';
  assert.equal(result.complete, complete);
  assert.equal(result.mutation.score, complete ? (expected.verdict === 'killed' ? 100 : 0) : null);
  assert.equal(result.mutation.unresolved, complete ? 0 : 1);
  assert.equal(result.mutation.outcomes[0].verdict, expected.verdict);
  if (expected.mutantState) {
    const mutant = result.mutation.outcomes[0].setups[0];
    assert.equal(mutant.state, expected.mutantState);
  }
}

const dependencyRoot = values.deps ? resolve(values.deps) : join(work, 'fixture-install');
if (!values.deps) {
  mkdirSync(dependencyRoot);
  for (const path of ['package.json', 'package-lock.json']) writeFileSync(join(dependencyRoot, path), fixtureBytes[path]);
  await runCommand(npmCommand, [...npmArgs, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], dependencyRoot, 0,
    {...rustProof.env, ...npmEnv});
}
assert.ok(statSync(join(dependencyRoot, 'node_modules')).isDirectory(), 'fixture dependencies are missing');
const environment = {node: process.version, tools: fixtureVersions(dependencyRoot)};
assert.deepEqual(environment.tools, {
  jest: '29.7.0',
  'jest-expo': '57.0.5',
  expo: '57.0.20',
  'react-native': '0.86.3',
  '@react-native/jest-preset': '0.86.3',
  'babel-preset-expo': '57.0.10',
  react: '19.2.3',
  typescript: '6.0.3',
});

let cli;
let cliEvidence;
if (tarballArg) {
  const tarball = realpathSync(resolve(tarballArg));
  assert.ok(statSync(tarball).isFile(), 'CLI tarball is missing');
  const consumer = join(work, 'cli-consumer');
  mkdirSync(consumer);
  writeJson(join(consumer, 'package.json'), {name: 'seshat-jest-expo-consumer', private: true});
  await runCommand(npmCommand, [...npmArgs,
    'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    '--save-dev', '--save-exact', '--cache', npmEnv.npm_config_cache,
    '--userconfig', npmEnv.npm_config_userconfig,
    '--globalconfig', npmEnv.npm_config_globalconfig, tarball,
  ], consumer, 0, {...rustProof.env, ...npmEnv});
  const executable = process.platform === 'win32' ? 'seshat.cmd' : 'seshat';
  const native = join(consumer, 'node_modules/@binary-balance/seshat/bin/seshat');
  cli = realpathSync(existsSync(native) ? native : join(consumer, 'node_modules/.bin', executable));
  cliEvidence = {source: 'tarball', tarballSha256: sha256(tarball)};
} else {
  cli = realpathSync(resolve(cliArg));
  assert.ok(statSync(cli).isFile(), 'CLI executable is missing');
  cliEvidence = {source: 'executable'};
}
const version = (await runCommand(cli, ['--version'], repo, 0, rustProof.env)).stdout.trim();
assert.match(version, /^seshat 0\.0\.0 \(candidate\)$/);
cliEvidence = {...cliEvidence, version, binarySha256: sha256(cli)};

copyBaseProject(dependencyRoot);
const configPath = join(project, 'seshat.json');
const results = {
  version: 1,
  environment,
  cli: cliEvidence,
  dependencies: {versions: environment.tools},
  noConsumingRust: rustProof.evidence,
  work: portable(work),
  runs: {},
};
const resultPath = process.env.SESHAT_PROOF_OUTPUT;
const save = () => {
  const output = sanitize(results);
  writeJson(join(work, 'result.json'), output);
  if (resultPath) writeJson(resultPath, output);
};
const shouldRun = name => wanted.has(name);

async function check(name, config, expected, control = null) {
  resetProject(dependencyRoot);
  const expectedControl = control ? writeControl(control.body, control.extraFiles ?? {}) : null;
  writeJson(configPath, config);
  const execution = await runProcess(cli, [
    'check', '--config', configPath, '--scratch', scratch, '--json', '--no-progress',
  ], project, rustProof.env, 600000);
  assert.equal(execution.timedOut, false, `${name} timed out running Seshat`);
  assert.equal(execution.overflow, false, `${name} overflowed Seshat output`);
  const report = JSON.parse(execution.stdout);
  const expectedStatus = expected.status ?? (report.complete ? 0 : 2);
  assert.equal(execution.status, expectedStatus, `${name}: ${execution.stdout}\n${execution.stderr}`);
  results.runs[name] = {
    config,
    execution: {status: execution.status, signal: execution.signal, stderr: execution.stderr},
    report: sanitize(report),
  };
  save();
  if (expected.assert) expected.assert(report.result, report);
  assertUnchanged(expectedControl);
  console.log(`${name}: exit ${execution.status}, complete=${report.complete}, score=${report.result?.mutation?.score ?? null}`);
  return report;
}

const normal = configFor({source: 'src/status.tsx', test: 'tests/status.test.tsx', workers: 1});
// The repeat and worker-2 checks compare against the first run. Include that
// prerequisite for a focused invocation so each accepted case is standalone.
if (shouldRun('normal-1') || shouldRun('normal-repeat') || shouldRun('normal-2')) {
  const report = await check('normal-1', normal, {assert: value => assertNormal(value, 1)});
  results.normalDefinition = stableMutation(report.result.mutation);
}
if (shouldRun('normal-repeat')) {
  const report = await check('normal-repeat', normal, {assert: value => assertNormal(value, 1)});
  assert.deepEqual(report.result.sources, results.runs['normal-1'].report.result.sources);
  assert.deepEqual(stableMutation(report.result.mutation), results.normalDefinition);
}
if (shouldRun('normal-2')) {
  const parallel = configFor({source: 'src/status.tsx', test: 'tests/status.test.tsx', workers: 2});
  const report = await check('normal-2', parallel, {assert: value => assertNormal(value, 2)});
  assert.deepEqual(stableMutation(report.result.mutation), results.normalDefinition);
}

const controls = [
  ['assertion-kill', "test('assertion',()=>expect(ready).toBe(true));", 'killed'],
  ['survivor', "test('survivor',()=>expect(typeof ready).toBe('boolean'));", 'survived'],
  ['before-all', "beforeAll(()=>{if(!ready)throw Error('setup');});test('blocked',()=>{});", 'execution-error'],
  ['before-each', "beforeEach(()=>{if(!ready)throw Error('setup');});test('blocked',()=>{});", 'execution-error'],
  ['after-each', "afterEach(()=>{if(!ready)throw Error('cleanup');});test('passes',()=>{});", 'execution-error'],
  ['mixed-assertion-hook', "afterEach(()=>{if(!ready)throw Error('cleanup');});test('assertion',()=>expect(ready).toBe(true));", 'execution-error'],
  ['import-failure', "if(!ready)throw Error('load');test('blocked',()=>{});", 'execution-error'],
  ['test-timeout', "test('timeout',()=>ready?Promise.resolve():new Promise(()=>{}),25);", 'timed-out'],
  ['hook-timeout', "beforeEach(()=>ready?Promise.resolve():new Promise(()=>{}),25);test('blocked',()=>{});", 'timed-out'],
];
for (const [name, body, verdict] of controls) {
  if (!shouldRun(name)) continue;
  const config = configFor({source: 'src/control.ts', test: 'tests/control.test.tsx', workers: 1});
  const report = await check(name, config, {
    assert: value => assertControl(value, {
      baseline: 'passed',
      verdict,
      mutantState: name === 'assertion-kill' ? 'failed' : name === 'survivor' ? 'passed'
        : verdict === 'timed-out' ? 'timed-out' : 'execution-error',
    }),
  }, {body});
  if (name === 'assertion-kill') assert.equal(report.result.mutation.score, 100);
  if (name === 'survivor') assert.equal(report.result.mutation.score, 0);
}

const missingEvents = configFor({
  source: 'src/control.ts',
  test: 'tests/control.test.tsx',
  testArgs: [...jestArgs('tests/control.test.tsx', {environment: false}), '--env=./conditional-environment.cjs'],
  extraCapture: ['conditional-environment.cjs'],
});
const conditionalEnvironment = `const {createRequire}=require('node:module');
const {join}=require('node:path');
const {writeFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const projectRequire=createRequire(join(process.cwd(),'package.json'));
const Base=projectRequire(projectRequire('jest-expo/jest-preset').testEnvironment);
module.exports=class ConditionalEnvironment extends Base {
  constructor(config,context){super(config,context);this.file=context.testPath;this.omit=process.env.SESHAT_EXECUTION_ID.includes('-mutant-');this.evidence={version:1,executionId:process.env.SESHAT_EXECUTION_ID,file:this.file,hookFailures:0,testFailures:0,timeouts:0,retries:0};}
  async handleTestEvent(event,state){await super.handleTestEvent?.(event,state);if(event.name==='test_retry')this.evidence.retries++;if(event.name==='hook_failure'||event.name==='test_fn_failure'){const message=typeof event.error==='string'?event.error:event.error?.message;if(message?.startsWith('Exceeded timeout of'))this.evidence.timeouts++;else if(event.name==='hook_failure')this.evidence.hookFailures++;else this.evidence.testFailures++;}if(event.name==='run_finish'&&!this.omit){const key=createHash('sha256').update(this.file).digest('hex');writeFileSync(process.env.SESHAT_RECEIPT+'.events-'+key,JSON.stringify(this.evidence),{flag:'wx'});}}
};\n`;
if (shouldRun('missing-events')) {
  await check('missing-events', missingEvents, {
    assert: value => assertControl(value, {baseline: 'passed', verdict: 'execution-error', mutantState: 'execution-error'}),
  }, {
    body: "test('passes',()=>expect(ready).toBe(true));",
    extraFiles: {'conditional-environment.cjs': conditionalEnvironment},
  });
}

const missingReceipt = configFor({
  source: 'src/control.ts',
  test: 'tests/control.test.tsx',
  testArgs: jestArgs('tests/control.test.tsx'),
});
if (shouldRun('missing-receipt')) {
  await check('missing-receipt', missingReceipt, {
    assert: value => assertControl(value, {baseline: 'passed', verdict: 'execution-error', mutantState: 'execution-error'}),
  }, {body: "const proc=(globalThis as {process?:{env?:Record<string,string|undefined>,exit?:(code:number)=>void}}).process;if(proc?.env?.SESHAT_EXECUTION_ID?.includes('-mutant-'))proc.exit?.(0);test('passes',()=>expect(ready).toBe(true));"});
}

if (shouldRun('retry-eventually-passes')) {
  const config = configFor({source: 'src/control.ts', test: 'tests/control.test.tsx', workers: 1});
  const report = await check('retry-eventually-passes', config, {
    assert: value => assertControl(value, {baseline: 'passed', verdict: 'execution-error', mutantState: 'execution-error'}),
  }, {body: "jest.retryTimes(1);let attempts=0;test('retry',()=>{attempts++;if(!ready&&attempts===1)throw Error('retry once');expect(true).toBe(true);});"});
  assert.equal(report.result.mutation.outcomes[0].setups[0].report.passed, 1);
  assert.equal(report.result.mutation.outcomes[0].setups[0].report.errors, 2);
}

if (shouldRun('retry-baseline')) {
  const config = configFor({source: 'src/control.ts', test: 'tests/control.test.tsx', workers: 1});
  await check('retry-baseline', config, {
    assert: value => assertControl(value, {baseline: 'execution-error', verdict: 'unassessed'}),
  }, {body: "jest.retryTimes(1);let attempts=0;test('retry',()=>{attempts++;if(attempts===1)throw Error('retry once');expect(ready).toBe(true);});"});
}

delete results.normalDefinition;
results.checks = {requested: requestedCases.length, completed: Object.keys(results.runs).length};
results.originalsPreserved = true;
save();
console.log(`Jest/Expo installed-command evidence: ${results.checks.completed} checks; ${join(work, 'result.json')}`);
