#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import os from 'node:os';
import {parseArgs} from 'node:util';
import {
  NODE_COMPARE_SOURCE,
  NODE_RULES_SOURCE,
  NODE_WORKSPACE_EXPECTED,
  NODE_WORKSPACE_INPUT_PATHS,
  NODE_WORKSPACE_INPUT_SHA256,
  nodeWorkspaceSeshatConfig,
  writeNodeWorkspace,
} from './node-workspace-fixture.mjs';

const cli = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: false,
  options: {
    baseline: {type: 'string'},
    candidate: {type: 'string'},
    repo: {type: 'string', default: process.cwd()},
    output: {type: 'string'},
    samples: {type: 'string', default: '3'},
    'timeout-ms': {type: 'string', default: '900000'},
    'jest-deps': {type: 'string'},
    'baseline-commit': {type: 'string'},
    'candidate-commit': {type: 'string'},
    'harness-commit': {type: 'string'},
    release: {type: 'boolean', default: false},
    switching: {type: 'boolean', default: false},
    'switching-fixture': {type: 'string'},
    'self-check': {type: 'boolean', default: false},
    'build-evidence': {type: 'string'},
    report: {type: 'string'},
    'prepare-only': {type: 'boolean', default: false},
    'preflight-only': {type: 'boolean', default: false},
  },
}).values;
const repo = resolve(cli.repo);
const samples = Number(cli.samples);
const timeoutMs = Number(cli['timeout-ms']);
const releaseMode = Boolean(cli.release);
const switchingMode = Boolean(cli.switching);
const switchingFixtureName = cli['switching-fixture'] ?? 'node';
const selfCheck = Boolean(cli['self-check']);
const preflightOnly = Boolean(cli['preflight-only']);
assert.ok(['node', 'vitest'].includes(switchingFixtureName),
  '--switching-fixture must be node or vitest');
assert.ok(switchingMode || cli['switching-fixture'] === undefined,
  '--switching-fixture requires --switching');
if (!selfCheck) {
  assert.ok(!releaseMode || !switchingMode, '--release and --switching are mutually exclusive');
  assert.ok(switchingMode
    ? !cli.baseline && cli.candidate
    : releaseMode ? !cli.baseline && cli.candidate :
      cli.baseline && (cli.candidate || cli['prepare-only'] || preflightOnly),
  switchingMode
    ? 'usage: node diagnostics-overhead.mjs --switching --candidate CANDIDATE.tgz [--repo ROOT]'
    : releaseMode
      ? 'usage: node diagnostics-overhead.mjs --release --candidate CANDIDATE.tgz --jest-deps PATH [--repo ROOT]'
      : 'usage: node diagnostics-overhead.mjs --baseline BASE.tgz --candidate CANDIDATE.tgz --jest-deps PATH [--repo ROOT]');
  assert.ok(!releaseMode || (!cli['prepare-only'] && !preflightOnly),
    '--release cannot be combined with --prepare-only or --preflight-only');
  assert.ok(!switchingMode || (!cli['prepare-only'] && !preflightOnly),
    '--switching cannot be combined with --prepare-only or --preflight-only');
  assert.ok(switchingMode || cli['jest-deps'], '--jest-deps must point at the prepared Jest/Expo dependency fixture');
  if (switchingMode) assert.equal(samples, 5, '--samples is fixed at 5 by the switching protocol');
}
assert.ok(Number.isSafeInteger(samples) && samples >= 3 && samples <= 9 && samples % 2 === 1,
  '--samples must be an odd integer from 3 to 9');
assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, '--timeoutMs must be positive');
assert.ok(existsSync(repo), `repository does not exist: ${repo}`);
const jestDeps = selfCheck || switchingMode ? null : realpathSync(resolve(cli['jest-deps']));
if (!selfCheck && !switchingMode) {
  assert.ok(statSync(jestDeps).isDirectory(), `Jest/Expo dependencies do not exist: ${jestDeps}`);
}

const baselineTarball = selfCheck || !cli.baseline ? null : realpathSync(resolve(cli.baseline));
const candidateTarball = selfCheck || !cli.candidate ? null : realpathSync(resolve(cli.candidate));
for (const path of [baselineTarball, candidateTarball].filter(Boolean)) assert.ok(statSync(path).isFile(), path);

const switchingWorkPrefix = switchingFixtureName === 'vitest' ? 'installed-vitest-switching' : 'installed-switching';
const switchingOutputStem = switchingFixtureName === 'vitest'
  ? 'installed-vitest-switching-comparison'
  : 'installed-switching-comparison';
const work = selfCheck ? null : mkdtempSync(join(repo, `work/${switchingMode ? switchingWorkPrefix : releaseMode ? 'release-benchmark' : 'diagnostics-overhead'}-`));
const output = selfCheck ? null : resolve(cli.output ?? join(work, switchingMode && switchingFixtureName === 'vitest' ? `${switchingOutputStem}.json` : 'result.json'));
const reportOutput = selfCheck ? null : resolve(cli.report ?? (cli.output
  ? cli.output.replace(/\.json$/i, '.md')
  : join(work, switchingMode && switchingFixtureName === 'vitest' ? `${switchingOutputStem}.md` : 'report.md')));
const proofHere = join(repo, 'benchmarks/proofs');
const proofModules = join(proofHere, 'node_modules');
const compiler = join(repo, 'benchmarks/node_modules/typescript/bin/tsc');
const collector = join(proofHere, 'collect-node.mjs');
const nodeCommand = process.execPath;
const baselineCommit = cli['baseline-commit'] ?? null;
const candidateCommit = cli['candidate-commit'] ?? null;

const EXPECTED = {
  nodeWorkspace: NODE_WORKSPACE_EXPECTED,
  vitest: {
    name: 'vitest',
    sourceMetrics: {
      'tempo.ts': [[3, 5, 5, 3]],
      'view.tsx': [[1, 1, 1, 1]],
      'server.ts': [[1, 3, 3, 1], [1, 1, 1, 1]],
    },
    mutants: [
      {id: 0, localId: 0, offset: 60, path: 'tempo.ts', original: '<', replacement: '<=', verdict: 'killed'},
      {id: 1, localId: 1, offset: 60, path: 'tempo.ts', original: '<', replacement: '>=', verdict: 'killed'},
      {id: 2, localId: 2, offset: 91, path: 'tempo.ts', original: '>', replacement: '>=', verdict: 'killed'},
      {id: 3, localId: 3, offset: 91, path: 'tempo.ts', original: '>', replacement: '<=', verdict: 'killed'},
    ],
    score: 100,
    tests: 3,
  },
  jestExpo: {
    name: 'jest-expo',
    sourceMetrics: {
      'src/status.tsx': [[2, 3, 3, 2], [1, 1, 1, 1], [1, 1, 1, 1]],
    },
    mutants: [
      {id: 0, localId: 0, offset: 113, path: 'src/status.tsx', original: '>=', replacement: '>', verdict: 'killed'},
      {id: 1, localId: 1, offset: 113, path: 'src/status.tsx', original: '>=', replacement: '<', verdict: 'killed'},
      {id: 2, localId: 2, offset: 216, path: 'src/status.tsx', original: '>', replacement: '>=', verdict: 'survived'},
      {id: 3, localId: 3, offset: 216, original: '>', replacement: '<=', path: 'src/status.tsx', verdict: 'killed'},
    ],
    score: 75,
    tests: 3,
  },
};

const VITEST_INPUT_SHA256 = 'a031b45a18aebad086e832f8c73972fdcbc129e9837c8d63f20c0fb8a4c6f455';

function json(path, value) {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashFile(path) {
  return hashBytes(readFileSync(path));
}

function canonical(value) {
  return JSON.stringify(value, (_, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
  });
}

function hashJson(value) {
  return hashBytes(Buffer.from(canonical(value)));
}

function portable(value) {
  if (typeof value === 'string') {
    return value
      .replaceAll(work ?? '<no-work>', '<work>')
      .replaceAll(repo, '<repo>')
      .replaceAll(jestDeps ?? '<no-jest-deps>', '<jest-deps>');
  }
  if (Array.isArray(value)) return value.map(portable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, portable(item)]));
  }
  return value;
}

function run(command, args, cwd, extraEnv = {}, limit = timeoutMs) {
  const start = performance.now();
  const environment = {...process.env, ...extraEnv};
  const child = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    timeout: limit,
    maxBuffer: 128 * 1024 * 1024,
  });
  const wallMs = performance.now() - start;
  assert.ifError(child.error);
  return {
    status: child.status,
    signal: child.signal,
    stdout: child.stdout ?? '',
    stderr: child.stderr ?? '',
    wallMs,
  };
}

function assertCommand(result, label, status = 0) {
  assert.equal(result.status, status,
    `${label} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

function walkInputs(root, paths) {
  const rows = [];
  const visit = (relativePath) => {
    const path = join(root, relativePath);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) {
      rows.push({path: relativePath, kind: 'symlink', target: readlinkSync(path)});
      return;
    }
    if (info.isDirectory()) {
      for (const entry of readdirSync(path).sort()) visit(join(relativePath, entry));
      return;
    }
    rows.push({path: relativePath, kind: 'file', bytes: info.size, sha256: hashFile(path)});
  };
  for (const path of paths) visit(path);
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

function snapshotInputs(project, paths) {
  return {files: walkInputs(project, paths), sha256: hashJson(walkInputs(project, paths))};
}

function assertInputs(project, paths, snapshot) {
  assert.deepEqual(snapshotInputs(project, paths), snapshot, `${project} inputs changed`);
}

function makeNpmEnv(root) {
  const env = {
    npm_config_cache: join(root, 'npm-cache'),
    npm_config_userconfig: join(root, 'user.npmrc'),
    npm_config_globalconfig: join(root, 'global.npmrc'),
    npm_config_update_notifier: 'false',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  };
  mkdirSync(root, {recursive: true});
  return env;
}

function packageVersion(root, name) {
  return JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
}

function installTarball(label, tarball) {
  const root = join(work, 'install', label);
  const consumer = join(root, 'consumer');
  mkdirSync(consumer, {recursive: true});
  const npmEnv = makeNpmEnv(root);
  json(join(consumer, 'package.json'), {name: `seshat-diagnostics-${label}`, version: '0.0.0', private: true});
  const installed = run('npm', [
    'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    '--save-dev', '--save-exact', '--cache', npmEnv.npm_config_cache,
    '--userconfig', npmEnv.npm_config_userconfig,
    '--globalconfig', npmEnv.npm_config_globalconfig, tarball,
  ], consumer, npmEnv, 180000);
  assertCommand(installed, `${label} offline npm install`);
  const executable = realpathSync(join(consumer, 'node_modules/.bin/seshat'));
  assert.ok(statSync(executable).isFile(), `${label} installed executable missing`);
  const version = assertCommand(run(executable, ['--version'], consumer), `${label} --version`).stdout.trim();
  const packageRoot = join(consumer, 'node_modules/@binary-balance/seshat');
  const packageFiles = walkInputs(consumer, ['node_modules/@binary-balance/seshat']);
  const buildMetadataPath = join(packageRoot, 'BUILD.json');
  const buildMetadata = JSON.parse(readFileSync(buildMetadataPath, 'utf8'));
  const packageBytes = packageFiles.reduce((total, file) => total + (file.bytes ?? 0), 0);
  const artifact = {
    source: label,
    tarball: {path: portable(tarball), bytes: statSync(tarball).size, sha256: hashFile(tarball)},
    installedBinary: {path: portable(executable), bytes: statSync(executable).size, sha256: hashFile(executable)},
    installedPackage: {bytes: packageBytes, files: packageFiles.length, sha256: hashJson(packageFiles)},
    buildMetadata: {
      path: portable(buildMetadataPath),
      bytes: statSync(buildMetadataPath).size,
      sha256: hashFile(buildMetadataPath),
      cargoDependencies: {
        count: Array.isArray(buildMetadata.dependencies) ? buildMetadata.dependencies.length : null,
        type: 'locked package entries listed by package BUILD.json',
      },
      metadata: buildMetadata,
    },
    installWallMs: installed.wallMs,
    version,
    package: JSON.parse(readFileSync(join(consumer, 'node_modules/@binary-balance/seshat/package.json'), 'utf8')),
  };
  return {label, executable, root, env: npmEnv, artifact};
}

function copyDirectory(source, destination) {
  mkdirSync(destination, {recursive: true});
  cpSync(source, destination, {recursive: true, verbatimSymlinks: true, force: true});
}

function makeNodeFixture() {
  const project = join(work, 'fixtures/node-workspace');
  const scratch = join(work, 'scratch/node-workspace');
  mkdirSync(scratch, {recursive: true});
  writeNodeWorkspace(project);
  return {
    id: 'nodeWorkspace',
    project,
    scratch,
    configPath: join(project, 'seshat.json'),
    inputPaths: NODE_WORKSPACE_INPUT_PATHS,
    expected: EXPECTED.nodeWorkspace,
    config: workers => nodeWorkspaceSeshatConfig({collector, compiler, nodeCommand, workers}),
  };
}

function vitestConfig(project, workers) {
  const test = [nodeCommand, 'node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.mjs',
    '--maxWorkers=1', '--no-file-parallelism', '--maxConcurrency=1', '--reporter=default', '--reporter={seshatReporter}'];
  return {
    workers,
    source: {include: ['tempo.ts', 'view.tsx', 'server.ts']},
    capture: ['package.json', 'tsconfig.json', 'tempo.ts', 'view.tsx', 'server.ts', 'stack.test.tsx', 'vitest.config.mjs', 'node_modules'],
    setups: [{
      name: 'stack', runner: 'vitest', cwd: '.', timeoutMs: 120000,
      typecheck: [nodeCommand, 'node_modules/typescript/bin/tsc', '--project', 'tsconfig.json'],
      test,
      coverage: {command: [...test, '--coverage'], report: 'coverage/coverage-final.json'},
    }],
  };
}

function makeVitestFixture() {
  const project = join(work, 'fixtures/vitest');
  const scratch = join(work, 'scratch/vitest');
  mkdirSync(scratch, {recursive: true});
  copyDirectory(join(proofHere, 'fixtures/vitest'), project);
  copyDirectory(proofModules, join(project, 'node_modules'));
  if (!existsSync(join(project, 'node_modules/typescript'))) {
    copyDirectory(join(repo, 'benchmarks/node_modules/typescript'), join(project, 'node_modules/typescript'));
  }
  writeFileSync(join(project, 'vitest.config.mjs'), "export default {cacheDir:'.vite',test:{runner:process.env.SESHAT_VITEST_RUNNER,include:['stack.test.tsx'],coverage:{provider:'istanbul',include:['tempo.ts','view.tsx','server.ts'],reporter:['json'],reportsDirectory:'coverage'}}};\n");
  return {
    id: 'vitest',
    project,
    scratch,
    configPath: join(project, 'seshat.json'),
    inputPaths: ['package.json', 'tsconfig.json', 'tempo.ts', 'view.tsx', 'server.ts', 'stack.test.tsx', 'vitest.config.mjs'],
    expected: EXPECTED.vitest,
    config: workers => vitestConfig(project, workers),
    dependencies: ['vitest', '@vitest/coverage-istanbul', 'fastify', '@sinclair/typebox', 'react', 'react-dom', 'typescript'],
  };
}

function jestConfig(project, workers) {
  const test = [nodeCommand, 'node_modules/jest/bin/jest.js', '--config', 'jest.config.cjs', '--runInBand',
    '--runTestsByPath', 'tests/status.test.tsx', '--reporters=default', '--reporters={seshatReporter}', '--env={seshatEnvironment}'];
  return {
    workers,
    source: {include: ['src/status.tsx']},
    capture: ['package.json', 'package-lock.json', 'tsconfig.json', 'babel.config.cjs', 'jest.config.cjs', 'src', 'tests', 'node_modules'],
    setups: [{
      name: 'jest-expo', runner: 'jest', cwd: '.', timeoutMs: 180000,
      typecheck: [nodeCommand, 'node_modules/typescript/bin/tsc', '--project', 'tsconfig.json'],
      test,
      coverage: {command: [...test, '--coverage', '--coverageProvider=babel', '--coverageReporters=json', '--coverageDirectory=coverage', '--collectCoverageFrom', 'src/status.tsx'], report: 'coverage/coverage-final.json'},
    }],
  };
}

function makeJestFixture() {
  const project = join(work, 'fixtures/jest-expo');
  const scratch = join(work, 'scratch/jest-expo');
  mkdirSync(scratch, {recursive: true});
  copyDirectory(join(proofHere, 'fixtures/jest-expo'), project);
  copyDirectory(join(jestDeps, 'node_modules'), join(project, 'node_modules'));
  return {
    id: 'jestExpo',
    project,
    scratch,
    configPath: join(project, 'seshat.json'),
    inputPaths: ['package.json', 'package-lock.json', 'tsconfig.json', 'babel.config.cjs', 'jest.config.cjs', 'src', 'tests'],
    expected: EXPECTED.jestExpo,
    config: workers => jestConfig(project, workers),
    dependencies: ['jest', 'jest-expo', 'expo', 'react-native', '@react-native/jest-preset', 'babel-preset-expo', 'react', 'typescript'],
  };
}

function expectedJobs(fixture, workers, strategy = 'replace') {
  return 3 + fixture.expected.mutants.length + (workers - 1) + (strategy === 'switch' ? 1 : 0);
}

function reportResult(report) {
  return report.result ?? report;
}

function counter(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(['passed', 'failed', 'errors', 'timeouts'].map(key => [key, value[key] ?? null]));
}

function setupProjection(setup) {
  const row = {name: setup.name, runner: setup.runner, cwd: setup.cwd};
  for (const key of ['typecheck', 'baseline', 'coverage']) {
    row[key] = {state: setup[key]?.state ?? null, report: counter(setup[key]?.report)};
  }
  return row;
}

function sourceProjection(source) {
  return {
    path: source.path,
    complete: source.result?.complete ?? null,
    problems: source.result?.problems ?? null,
    functions: (source.result?.functions ?? []).map(({name, start, complexity, coverage, covered, total, crap, status}) =>
      ({name, start, complexity, coverage, covered, total, crap, status})),
  };
}

function outcomeProjection(outcome) {
  return {
    id: outcome.id,
    localId: outcome.localId,
    offset: outcome.offset,
    path: outcome.path,
    original: outcome.original,
    replacement: outcome.replacement,
    verdict: outcome.verdict,
    setups: (outcome.setups ?? []).map(setup => ({state: setup.state, report: counter(setup.report)})),
  };
}

function semanticProjection(report) {
  const result = reportResult(report);
  const scope = report.scope ? {
    include: report.scope.include,
    exclude: report.scope.exclude,
    files: report.scope.files,
    setups: report.scope.setups?.map(({name, runner, cwd}) => ({name, runner, cwd})),
  } : null;
  const mutation = result.mutation;
  return {
    command: report.command ?? null,
    complete: report.complete ?? result.complete,
    scope,
    result: {
      complete: result.complete,
      jobsAttempted: result.jobsAttempted,
      sources: (result.sources ?? []).map(sourceProjection),
      setups: (result.setups ?? []).map(setupProjection),
      mutation: mutation ? {
        complete: mutation.complete,
        planned: mutation.planned,
        killed: mutation.killed,
        survived: mutation.survived,
        score: mutation.score,
        workersRequested: mutation.workersRequested,
        workersUsed: mutation.workersUsed,
        workerBaselineJobs: mutation.workerBaselineJobs,
        completed: mutation.completed,
        notRun: mutation.notRun,
        unresolved: mutation.unresolved,
        workerBaselines: (mutation.workerBaselines ?? []).map(setup => ({state: setup.state, report: counter(setup.report)})),
        outcomes: (mutation.outcomes ?? []).map(outcomeProjection),
      } : null,
    },
  };
}

function workerIndependentProjection(report) {
  const semantic = semanticProjection(report);
  return {
    ...semantic,
    result: {
      ...semantic.result,
      jobsAttempted: null,
      mutation: semantic.result.mutation
        ? {
          ...semantic.result.mutation,
          workersRequested: null,
          workersUsed: null,
          workerBaselineJobs: null,
          workerBaselines: null,
        }
        : null,
    },
  };
}

function metricsFor(result) {
  const metrics = {};
  for (const source of result.sources ?? []) {
    metrics[source.path] = source.result.functions.map(({complexity, covered, total, crap}) =>
      [complexity, covered, total, crap]);
  }
  return metrics;
}

function assertExpected(fixture, result, workers, strategy = 'replace', includeStrategy = switchingMode) {
  const {expected} = fixture;
  assert.equal(result.complete, true, `${fixture.id} report incomplete`);
  assert.equal(result.jobsAttempted, expectedJobs(fixture, workers, strategy));
  assert.equal(result.setups.length, 1);
  const setup = result.setups[0];
  assert.equal(setup.typecheck.state, 'passed');
  assert.equal(setup.baseline.state, 'passed');
  assert.equal(setup.coverage.state, 'passed');
  assert.deepEqual(metricsFor(result), expected.sourceMetrics);
  const definitions = (result.mutation.outcomes ?? []).map(outcome => ({
    id: outcome.id,
    localId: outcome.localId,
    offset: outcome.offset,
    path: outcome.path,
    original: outcome.original,
    replacement: outcome.replacement,
    verdict: outcome.verdict,
    setupStates: (outcome.setups ?? []).map(setup => setup.state),
  }));
  const expectedDefinitions = expected.mutants.map(item => ({
    ...item,
    setupStates: [item.verdict === 'survived' ? 'passed' : 'failed'],
  }));
  assert.deepEqual(definitions, expectedDefinitions, `${fixture.id} mutants changed`);
  assert.equal(result.mutation.planned, expected.mutants.length);
  if (includeStrategy) {
    assert.equal(result.mutation.strategy, strategy);
    assert.equal(result.mutation.jobsAttempted, expected.mutants.length);
  }
  assert.equal(result.mutation.killed, expected.mutants.filter(item => item.verdict === 'killed').length);
  assert.equal(result.mutation.survived, expected.mutants.filter(item => item.verdict === 'survived').length);
  assert.equal(result.mutation.score, expected.score);
  assert.equal(result.mutation.workersRequested, workers);
  assert.equal(result.mutation.workersUsed, workers);
  assert.equal(result.mutation.workerBaselineJobs, workers - 1);
  assert.equal(result.mutation.workerBaselines.length, workers - 1);
  assert.ok(result.mutation.workerBaselines.every(setup => setup.state === 'passed'));
  assert.equal(result.mutation.completed, expected.mutants.length);
  assert.equal(result.mutation.notRun, 0);
  assert.equal(result.mutation.unresolved, 0);
  const receiptRows = [
    setup.baseline,
    setup.coverage,
    ...result.mutation.workerBaselines,
    ...(result.mutation.preparedBaselines ?? []),
    ...result.mutation.outcomes.flatMap(outcome => outcome.setups ?? []),
  ];
  const receiptIds = receiptRows.map(row => row.report?.executionId);
  assert.ok(receiptIds.every(id => typeof id === 'string' && id.length > 0),
    `${fixture.id} receipt identity missing`);
  assert.equal(new Set(receiptIds).size, receiptIds.length,
    `${fixture.id} receipt identity reused`);
  assert.ok(receiptRows.every(row => row.report.version === 1 && row.report.complete === true),
    `${fixture.id} receipt is incomplete`);
  if (includeStrategy) {
    assert.equal(result.mutation.error, null);
    assert.equal(result.mutation.restorationError, null);
    assert.ok(result.mutation.outcomes.every(outcome => Number.isFinite(outcome.executionMs)),
      `${fixture.id} mutation timing missing`);
  }
  assert.equal(result.setups[0].baseline.report.passed, expected.tests);
  assert.equal(result.setups[0].coverage.report.passed, expected.tests);
  assert.ok(result.mutation.workerBaselines.every(row => row.report.passed === expected.tests));
  if (includeStrategy) {
    if (strategy === 'switch') {
      assert.equal(result.mutation.preparedBaselineJobs, 1);
      assert.equal(result.mutation.preparedBaselines.length, 1);
      assert.equal(result.mutation.preparedBaselines[0].phase, 'prepared-baseline');
      assert.equal(result.mutation.preparedBaselines[0].state, 'passed');
      assert.equal(result.mutation.preparedBaselines[0].report.passed, expected.tests);
      assert.ok(Number.isFinite(result.mutation.switchPreparationMs));
      assert.ok(Number.isFinite(result.mutation.preparedBaselineMs));
      assert.ok(result.mutation.workerBaselines.every(row => row.phase === 'prepared-baseline'));
    } else {
      assert.equal(result.mutation.preparedBaselineJobs ?? 0, 0);
      assert.equal(result.mutation.preparedBaselines?.length ?? 0, 0);
      assert.equal(result.mutation.switchPreparationMs ?? null, null);
      assert.equal(result.mutation.preparedBaselineMs ?? null, null);
      assert.ok(result.mutation.workerBaselines.every(row => row.phase === undefined));
    }
  }
}

function diagnosticsSnapshot(report) {
  const result = reportResult(report);
  return portable({
    report: result.diagnostics ?? report.diagnostics ?? null,
    mutation: result.mutation?.diagnostics ?? null,
  });
}

function progressEnabled(result) {
  return /analysis:|baseline|coverage|mutation/.test(result.stderr);
}

function runCheck(binary, fixture, workers, progress, label, phase, pair, sample, expectedSnapshot, {
  retainDetails = false,
  strategy = 'replace',
} = {}) {
  const args = ['check', '--config', fixture.configPath, '--scratch', fixture.scratch, '--json'];
  if (!progress) args.push('--no-progress');
  if (strategy === 'switch') args.push('--experimental-switching');
  const execution = run(binary.executable, args, fixture.project);
  assert.equal(execution.status, 0, `${label} ${fixture.id} check failed\n${execution.stdout}\n${execution.stderr}`);
  let report;
  assert.doesNotThrow(() => { report = JSON.parse(execution.stdout); }, `${label} did not emit JSON`);
  assert.equal(report.complete, true);
  assert.equal(report.result?.complete, true);
  assertInputs(fixture.project, fixture.inputPaths, expectedSnapshot.inputs);
  assert.equal(hashJson(portable(JSON.parse(readFileSync(fixture.configPath, 'utf8')))), fixture.configs[workers].sha256,
    `${fixture.id} configuration changed`);
  assert.equal(readdirSync(fixture.scratch).length, 0, `${fixture.id} scratch was not cleaned`);
  assertExpected(fixture, report.result, workers, strategy);
  const semantic = portable(semanticProjection(report));
  const semanticHash = hashJson(semantic);
  if (expectedSnapshot.semanticHash) {
    assert.equal(semanticHash, expectedSnapshot.semanticHash, `${fixture.id} semantic result changed`);
  }
  if (progress) assert.ok(progressEnabled(execution), `${fixture.id} progress was not emitted`);
  else assert.equal(execution.stderr, '', `${fixture.id} quiet run wrote stderr`);
  const record = {
    binary: label,
    fixture: fixture.id,
    workers,
    progress,
    phase,
    pair,
    sample,
    wallMs: execution.wallMs,
    stdoutBytes: Buffer.byteLength(execution.stdout),
    stderrBytes: Buffer.byteLength(execution.stderr),
    semanticHash,
    workerParityHash: switchingMode
      ? hashJson(portable(workerIndependentProjection(report)))
      : hashJson(workerIndependentProjection(report)),
    diagnosticsHash: hashJson(diagnosticsSnapshot(report)),
    diagnostics: retainDetails || label === 'candidate' && (phase === 'warmup' || sample === 1)
      ? diagnosticsSnapshot(report)
      : null,
    reportTimings: retainDetails || label === 'candidate' && (phase === 'warmup' || sample === 1)
      ? portable(report.timings ?? null)
      : null,
  };
  if (switchingMode) {
    record.strategy = strategy;
    record.report = portable(report);
    record.stdout = portable(execution.stdout);
    record.stderr = portable(execution.stderr);
  }
  return {record, report, semantic};
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function range(values) {
  return {minMs: Math.min(...values), maxMs: Math.max(...values), rangeMs: Math.max(...values) - Math.min(...values)};
}

function comparison(left, right) {
  const leftRange = range(left);
  const rightRange = range(right);
  return {
    leftSamples: left.map(value => Number(value.toFixed(3))),
    rightSamples: right.map(value => Number(value.toFixed(3))),
    leftMedianMs: median(left),
    rightMedianMs: median(right),
    leftMinMs: leftRange.minMs,
    leftMaxMs: leftRange.maxMs,
    leftRangeMs: leftRange.rangeMs,
    rightMinMs: rightRange.minMs,
    rightMaxMs: rightRange.maxMs,
    rightRangeMs: rightRange.rangeMs,
    deltaMedianMs: median(right) - median(left),
    deltaMedianPercent: median(left) === 0 ? null : (median(right) - median(left)) / median(left) * 100,
  };
}

function aggregate(records, keyFields) {
  const groups = new Map();
  for (const record of records.filter(item => item.phase === 'measured')) {
    const key = keyFields.map(field => record[field]).join('|');
    const group = groups.get(key) ?? {...Object.fromEntries(keyFields.map(field => [field, record[field]])), samples: []};
    group.samples.push(record.wallMs);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({
    ...group,
    samples: group.samples.map(value => Number(value.toFixed(3))),
    medianMs: Number(median(group.samples).toFixed(3)),
    ...range(group.samples),
  }));
}

function pairComparisons(records) {
  const map = new Map();
  for (const record of records.filter(item => item.phase === 'measured')) {
    const key = [record.fixture, record.workers, record.progress, record.pair].join('|');
    const pair = map.get(key) ?? {fixture: record.fixture, workers: record.workers, progress: record.progress, pair: record.pair, values: {}, order: []};
    pair.values[record.binary] = record.wallMs;
    pair.order.push(record.binary);
    map.set(key, pair);
  }
  return [...map.values()].map(pair => ({
    ...pair,
    baselineMs: pair.values.baseline,
    candidateMs: pair.values.candidate,
    deltaMs: pair.values.candidate - pair.values.baseline,
  }));
}

function assertReleaseSummary(records, aggregateRows, fixtures) {
  const measured = records.filter(record => record.phase === 'measured');
  assert.equal(measured.length, fixtures.length * 2 * samples,
    'release measured run count changed');
  assert.equal(aggregateRows.length, fixtures.length * 2,
    'release condition count changed');
  for (const row of aggregateRows) {
    assert.equal(row.binary, 'candidate');
    assert.equal(row.progress, true);
    assert.equal(row.samples.length, samples);
  }

  const parity = {};
  for (const fixture of fixtures) {
    const rows = records.filter(record => record.fixture === fixture.id);
    assert.equal(rows.length, 2 * (samples + 1), `${fixture.id} run count changed`);
    const parityHashes = new Set(rows.map(record => record.workerParityHash));
    assert.equal(parityHashes.size, 1, `${fixture.id} worker semantic parity changed`);
    parity[fixture.id] = {
      workerIndependentHash: rows[0].workerParityHash,
      workers: {},
    };
    for (const workers of [1, 2]) {
      const workerRows = rows.filter(record => record.workers === workers);
      assert.equal(workerRows.length, samples + 1, `${fixture.id} worker ${workers} run count changed`);
      assert.equal(new Set(workerRows.map(record => record.semanticHash)).size, 1,
        `${fixture.id} worker ${workers} semantic result changed`);
      parity[fixture.id].workers[workers] = {
        semanticHash: workerRows[0].semanticHash,
        workerIndependentHash: workerRows[0].workerParityHash,
      };
    }
  }
  return parity;
}

function switchingFixture() {
  if (switchingFixtureName === 'vitest') {
    return {
      id: 'vitest',
      expected: EXPECTED.vitest,
      inputSha256: VITEST_INPUT_SHA256,
      protocol: 'installed-vitest-switching-comparison.md',
    };
  }
  return {
    id: 'nodeWorkspace',
    expected: EXPECTED.nodeWorkspace,
    inputSha256: NODE_WORKSPACE_INPUT_SHA256,
    protocol: 'installed-switching-comparison.md',
  };
}

function makeSwitchingFixture() {
  return switchingFixtureName === 'vitest' ? makeVitestFixture() : makeNodeFixture();
}

function switchingConditions() {
  return [
    {strategy: 'replace', workers: 1},
    {strategy: 'switch', workers: 1},
    {strategy: 'switch', workers: 2},
    {strategy: 'replace', workers: 2},
  ];
}

function assertSwitchingSummary(records, aggregateRows, fixture, sampleCount = samples) {
  assert.equal(records.length, 4 * (sampleCount + 1),
    `switching matrix must contain ${4 * (sampleCount + 1)} runs`);
  assert.equal(records.filter(record => record.phase === 'warmup').length, 4,
    'switching matrix must contain four warmups');
  assert.equal(records.filter(record => record.phase === 'measured').length, 4 * sampleCount,
    `switching matrix must contain ${4 * sampleCount} measured runs`);
  const conditions = switchingConditions();
  assert.equal(aggregateRows.length, conditions.length, 'switching condition count changed');
  for (const condition of conditions) {
    const matches = records.filter(record => record.strategy === condition.strategy && record.workers === condition.workers);
    assert.equal(matches.length, sampleCount + 1,
      `${condition.strategy} workers=${condition.workers} run count changed`);
    assert.equal(matches.filter(record => record.phase === 'warmup').length, 1,
      `${condition.strategy} workers=${condition.workers} warmup count changed`);
    assert.equal(matches.filter(record => record.phase === 'measured').length, sampleCount,
      `${condition.strategy} workers=${condition.workers} sample count changed`);
    const semanticHashes = new Set(matches.map(record => record.semanticHash));
    assert.equal(semanticHashes.size, 1,
      `${condition.strategy} workers=${condition.workers} semantic result changed`);
    const row = aggregateRows.find(item => item.strategy === condition.strategy && item.workers === condition.workers);
    assert.ok(row, `${condition.strategy} workers=${condition.workers} aggregate missing`);
    assert.equal(row.samples.length, sampleCount);
  }
  const parityHashes = new Set(records.map(record => record.workerParityHash));
  assert.equal(parityHashes.size, 1, 'strategy or worker semantic parity changed');
  const semanticHash = records.find(record => record.strategy === 'replace' && record.workers === 1).workerParityHash;
  assert.equal(semanticHash, hashJson(portable(workerIndependentProjection(records.find(record => record.strategy === 'replace' && record.workers === 1).report))),
    'worker parity hash does not match the retained report');
  assert.equal(records.every(record => record.fixture === fixture.id), true, 'switching fixture changed');
  return {workerIndependentHash: semanticHash, conditions};
}

function switchingComparisons(aggregateRows) {
  return [1, 2].map(workers => {
    const replace = aggregateRows.find(row => row.strategy === 'replace' && row.workers === workers);
    const switching = aggregateRows.find(row => row.strategy === 'switch' && row.workers === workers);
    return {workers, ...comparison(replace.samples, switching.samples)};
  });
}

function switchingPhaseSummary(records) {
  const fields = [
    ['wallMs', record => record.wallMs],
    ['captureMs', record => record.reportTimings?.captureMs],
    ['executionMs', record => record.reportTimings?.executionMs],
    ['analysisMs', record => record.report?.result?.phaseTimings?.analysisMs],
    ['preparationMs', record => record.report?.result?.phaseTimings?.preparationMs],
    ['typecheckMs', record => record.report?.result?.phaseTimings?.typecheckMs],
    ['baselineMs', record => record.report?.result?.phaseTimings?.baselineMs],
    ['coverageMs', record => record.report?.result?.phaseTimings?.coverageMs],
    ['attributionMs', record => record.report?.result?.phaseTimings?.attributionMs],
    ['preparedBaselineMs', record => record.report?.result?.mutation?.preparedBaselineMs],
    ['switchPreparationMs', record => record.report?.result?.mutation?.switchPreparationMs],
    ['workerPreparationMs', record => record.report?.result?.mutation?.workerPreparationMs],
    ['mutationMs', record => record.report?.result?.mutation?.mutationWallMs],
    ['workerCleanupMs', record => record.report?.result?.mutation?.workerCleanupMs],
    ['cleanupMs', record => record.report?.result?.phaseTimings?.cleanupMs],
  ];
  return switchingConditions().map(({strategy, workers}) => {
    const rows = records.filter(record => record.phase === 'measured'
      && record.strategy === strategy && record.workers === workers);
    return {
      strategy,
      workers,
      timings: Object.fromEntries(fields.map(([name, read]) => {
        const values = rows.map(read).filter(value => Number.isFinite(value));
        return [name, values.length === rows.length ? {
          medianMs: Number(median(values).toFixed(3)),
          ...range(values),
        } : null];
      })),
    };
  });
}

function selfCheckReport(workers, score = 100, verdict = 'killed') {
  const setupReport = {passed: 1, failed: 0, errors: 0, timeouts: 0};
  const setup = {
    name: 'node-workspace',
    runner: 'node',
    cwd: '.',
    typecheck: {state: 'passed', report: setupReport},
    baseline: {state: 'passed', report: setupReport},
    coverage: {state: 'passed', report: setupReport},
  };
  return {
    command: 'check',
    complete: true,
    scope: {include: ['src/**/*.ts'], exclude: [], files: [], setups: [{name: setup.name, runner: setup.runner, cwd: setup.cwd}]},
    result: {
      complete: true,
      jobsAttempted: 5 + (workers - 1),
      sources: [{
        path: 'src/compare.ts',
        result: {
          complete: true,
          problems: [],
          functions: [{name: 'adult', start: {line: 1, column: 1}, complexity: 1, coverage: 1, covered: 1, total: 1, crap: 1, status: 'ok'}],
        },
      }],
      setups: [setup],
      mutation: {
        complete: true,
        planned: 1,
        killed: verdict === 'killed' ? 1 : 0,
        survived: verdict === 'survived' ? 1 : 0,
        score,
        workersRequested: workers,
        workersUsed: workers,
        workerBaselineJobs: workers - 1,
        completed: 1,
        notRun: 0,
        unresolved: 0,
        workerBaselines: Array.from({length: workers - 1}, () => ({state: 'passed', report: setupReport})),
        outcomes: [{
          id: 0,
          localId: 0,
          offset: 42,
          path: 'src/compare.ts',
          original: '>=',
          replacement: verdict === 'killed' ? '>' : '<',
          verdict,
          setups: [{state: verdict === 'killed' ? 'failed' : 'passed', report: setupReport}],
        }],
      },
    },
  };
}

function selfCheckSwitchingReport(workers, strategy = 'replace') {
  const fixture = switchingFixture();
  const setupName = fixture.id === 'vitest' ? 'stack' : 'node-workspace';
  const runner = fixture.id === 'vitest' ? 'vitest' : 'node';
  const receiptReport = executionId => ({
    version: 1,
    executionId,
    node: '24.20.0',
    complete: true,
    passed: fixture.expected.tests,
    failed: 0,
    errors: 0,
    timeouts: 0,
  });
  const setup = {
    name: setupName,
    runner,
    cwd: '.',
    typecheck: {state: 'passed'},
    baseline: {state: 'passed', report: receiptReport('setup-baseline')},
    coverage: {state: 'passed', report: receiptReport('setup-coverage')},
  };
  const sources = Object.entries(fixture.expected.sourceMetrics).map(([path, metrics]) => ({
    path,
    result: {
      complete: true,
      problems: [],
      functions: metrics.map(([complexity, covered, total, crap], index) => ({
        name: path.includes('rules') ? 'answer' : 'adult',
        start: {line: index + 1, column: 1},
        complexity,
        coverage: covered / total,
        covered,
        total,
        crap,
        status: 'ok',
      })),
    },
  }));
  const mutation = {
    strategy,
    complete: true,
    planned: fixture.expected.mutants.length,
    killed: fixture.expected.mutants.length,
    survived: 0,
    score: fixture.expected.score,
    jobsAttempted: fixture.expected.mutants.length,
    workersRequested: workers,
    workersUsed: workers,
    workerBaselineJobs: workers - 1,
    completed: fixture.expected.mutants.length,
    notRun: 0,
    unresolved: 0,
    error: null,
    restorationError: null,
    workerBaselines: Array.from({length: workers - 1}, (_, index) => ({
      state: 'passed',
      report: receiptReport(`worker-baseline-${index + 1}`),
      ...(strategy === 'switch' ? {phase: 'prepared-baseline', worker: index + 1} : {}),
    })),
    outcomes: fixture.expected.mutants.map(item => ({
      ...item,
      executionMs: 1,
      setups: [{state: 'failed', report: receiptReport(`mutant-${item.id}`)}],
    })),
  };
  if (strategy === 'switch') {
    mutation.preparedBaselineJobs = 1;
    mutation.preparedBaselines = [{
      name: setupName,
      phase: 'prepared-baseline',
      state: 'passed',
      report: receiptReport('prepared-baseline'),
    }];
    mutation.switchPreparationMs = 1;
    mutation.preparedBaselineMs = 1;
  }
  return {
    command: 'check',
    complete: true,
    scope: {
      include: fixture.id === 'vitest' ? ['tempo.ts', 'view.tsx', 'server.ts'] : ['src/**/*.ts', 'packages/**/*.ts'],
      exclude: [],
      files: fixture.id === 'vitest'
        ? Object.keys(fixture.expected.sourceMetrics)
        : ['packages/rules/index.ts', 'src/compare.ts'],
      setups: [{name: setupName, runner, cwd: '.'}],
    },
    result: {
      phase: 'check',
      complete: true,
      jobsAttempted: expectedJobs(fixture, workers, strategy),
      sources,
      setups: [setup],
      mutation,
    },
  };
}

function runSwitchingSelfCheck() {
  const fixture = switchingFixture();
  const sampleCount = 5;
  const reports = [];
  for (const condition of switchingConditions()) {
    const report = selfCheckSwitchingReport(condition.workers, condition.strategy);
    assertExpected(fixture, report.result, condition.workers, condition.strategy, true);
    reports.push(report);
  }
  const positive = structuredClone(reports[1]);
  const records = [];
  for (const [index, condition] of switchingConditions().entries()) {
    const report = reports[index];
    for (const phase of ['warmup', ...Array.from({length: sampleCount}, (_, sample) => `sample-${sample + 1}`)]) {
      records.push({
        fixture: fixture.id,
        strategy: condition.strategy,
        workers: condition.workers,
        phase: phase === 'warmup' ? 'warmup' : 'measured',
        sample: phase === 'warmup' ? null : Number(phase.slice(7)),
        wallMs: 1,
        semanticHash: hashJson(portable(semanticProjection(report))),
        workerParityHash: hashJson(portable(workerIndependentProjection(report))),
        report: portable(report),
        reportTimings: {captureMs: 1, executionMs: 1},
      });
    }
  }
  const aggregateRows = switchingConditions().map(condition => ({
    ...condition,
    samples: Array.from({length: sampleCount}, () => 1),
  }));
  const summary = assertSwitchingSummary(records, aggregateRows, fixture, sampleCount);
  assert.equal(summary.conditions.length, 4);
  assert.equal(new Set(records.map(record => record.semanticHash)).size, 4,
    'worker-specific report fields were not retained in semantic hash');

  const wrongMetrics = structuredClone(positive);
  wrongMetrics.result.sources[0].result.functions[0].crap = 2;
  assert.throws(() => assertExpected(fixture, wrongMetrics.result, 1, 'switch', true));
  const wrongOperator = structuredClone(positive);
  wrongOperator.result.mutation.outcomes[0].replacement = '<';
  assert.throws(() => assertExpected(fixture, wrongOperator.result, 1, 'switch', true));
  const falseKill = structuredClone(positive);
  falseKill.result.mutation.outcomes[0].verdict = 'survived';
  falseKill.result.mutation.killed = 1;
  falseKill.result.mutation.survived = 1;
  falseKill.result.mutation.score = 50;
  assert.throws(() => assertExpected(fixture, falseKill.result, 1, 'switch', true));
  const wrongPreparedCount = structuredClone(positive);
  wrongPreparedCount.result.mutation.preparedBaselineJobs = 0;
  assert.throws(() => assertExpected(fixture, wrongPreparedCount.result, 1, 'switch', true));
  const wrongWorkerPhase = structuredClone(reports[2]);
  wrongWorkerPhase.result.mutation.workerBaselines[0].phase = 'original-baseline';
  assert.throws(() => assertExpected(fixture, wrongWorkerPhase.result, 2, 'switch', true));
  const wrongParity = structuredClone(records);
  wrongParity[0].report.result.sources[0].result.functions[0].crap = 2;
  wrongParity[0].workerParityHash = hashJson(portable(workerIndependentProjection(wrongParity[0].report)));
  assert.throws(() => assertSwitchingSummary(wrongParity, aggregateRows, fixture, sampleCount));
  console.log('Installed switching benchmark self-check passed.');
}

function runReleaseSelfCheck() {
  const fixtures = [{id: 'nodeWorkspace'}, {id: 'vitest'}, {id: 'jestExpo'}];
  const records = [];
  const reports = new Map([1, 2].map(workers => [workers, selfCheckReport(workers)]));
  const parityHashes = [1, 2].map(workers => hashJson(portable(workerIndependentProjection(reports.get(workers)))));
  assert.equal(new Set(parityHashes).size, 1, 'worker-only report differences changed parity hash');
  const changedHash = hashJson(portable(workerIndependentProjection(selfCheckReport(2, 0, 'survived'))));
  assert.notEqual(changedHash, parityHashes[0], 'semantic score/verdict changes were discarded');
  assert.notEqual(hashJson(portable(semanticProjection(reports.get(1)))),
    hashJson(portable(semanticProjection(reports.get(2)))), 'worker-specific semantic hashes unexpectedly matched');
  for (const fixture of fixtures) {
    for (const workers of [1, 2]) {
      const report = reports.get(workers);
      records.push({fixture: fixture.id, workers, phase: 'warmup', binary: 'candidate', progress: true,
        semanticHash: hashJson(portable(semanticProjection(report))), workerParityHash: parityHashes[workers - 1]});
      for (let sample = 1; sample <= samples; sample++) {
        records.push({fixture: fixture.id, workers, phase: 'measured', sample, binary: 'candidate', progress: true,
          semanticHash: hashJson(portable(semanticProjection(report))), workerParityHash: parityHashes[workers - 1]});
      }
    }
  }
  const aggregateRows = fixtures.flatMap(fixture => [1, 2].map(workers => ({
    fixture: fixture.id,
    workers,
    progress: true,
    binary: 'candidate',
    samples: Array.from({length: samples}, () => 1),
  })));
  const parity = assertReleaseSummary(records, aggregateRows, fixtures);
  assert.equal(Object.keys(parity).length, fixtures.length);
  assert.equal(parity.vitest.workerIndependentHash, parityHashes[0]);
  console.log('Release benchmark summary self-check passed.');
}

function toolVersions() {
  const npm = assertCommand(run('npm', ['--version'], repo), 'npm --version').stdout.trim();
  const readVersion = path => JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')).version;
  const environment = {
    node: process.version,
    npm,
    platform: process.platform,
    arch: process.arch,
    kernel: os.release(),
    cpu: os.cpus()[0]?.model ?? null,
    logicalCPUs: os.availableParallelism?.() ?? os.cpus().length,
    memoryBytes: os.totalmem(),
    typescript: readVersion(join(repo, 'benchmarks/node_modules/typescript')),
  };
  if (switchingMode && switchingFixtureName === 'vitest') {
    environment.proofTools = Object.fromEntries([
      'vitest', '@vitest/coverage-istanbul', 'fastify', '@sinclair/typebox', 'react', 'react-dom',
    ].map(name => [name, readVersion(join(proofModules, name))]));
  } else if (!switchingMode) {
    environment.proofTools = {
      vitest: readVersion(join(proofModules, 'vitest')),
      '@vitest/coverage-istanbul': readVersion(join(proofModules, '@vitest/coverage-istanbul')),
      jest: readVersion(join(jestDeps, 'node_modules/jest')),
      'jest-expo': readVersion(join(jestDeps, 'node_modules/jest-expo')),
    };
  }
  return environment;
}

function maintainedCounts() {
  const codePaths = ['benchmarks/proofs/src', 'benchmarks/proofs/diagnostics-overhead.mjs'];
  const codeFiles = walkInputs(repo, codePaths).filter(file => file.kind === 'file');
  const codeRows = codeFiles.filter(file => /\.(?:rs|mjs)$/.test(file.path));
  const lines = codeRows.reduce((total, file) => {
    const source = readFileSync(join(repo, file.path), 'utf8');
    return total + source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0);
  }, 0);
  const cargoLock = readFileSync(join(proofHere, 'Cargo.lock'), 'utf8');
  return {
    code: {
      scope: codePaths,
      files: codeRows.length,
      lines,
    },
    cargoDependencies: {
      scope: 'benchmarks/proofs/Cargo.lock [[package]] entries',
      packages: (cargoLock.match(/^\[\[package\]\]$/gm) ?? []).length,
      type: 'locked Cargo package entries',
    },
  };
}

function provenance() {
  const protocol = switchingMode
    ? switchingFixture().protocol
    : 'release-benchmark.md';
  const value = {
    candidateSourceRevision: candidateCommit,
    harnessRevision: cli['harness-commit'] ?? null,
    harness: {
      path: 'benchmarks/proofs/diagnostics-overhead.mjs',
      sha256: hashFile(join(proofHere, 'diagnostics-overhead.mjs')),
    },
    protocol: {
      path: `benchmarks/proofs/${protocol}`,
      sha256: hashFile(join(proofHere, protocol)),
    },
  };
  if (switchingMode) {
    value.fixtureHelper = {
      path: 'benchmarks/proofs/node-workspace-fixture.mjs',
      sha256: hashFile(join(proofHere, 'node-workspace-fixture.mjs')),
    };
  }
  return value;
}

function formatMs(value) {
  return Number.isFinite(value) ? `${value.toFixed(3)} ms` : 'unavailable';
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : 'unavailable';
}

function renderSwitchingReport(evidence) {
  const fixture = evidence.fixture ?? {};
  const isVitest = fixture.id === 'vitest';
  const fixtureLabel = isVitest ? 'Vitest/TSX fixture' : 'Node workspace';
  const protocolFile = isVitest ? 'installed-vitest-switching-comparison.md' : 'installed-switching-comparison.md';
  const outputFile = isVitest ? 'installed-vitest-switching-comparison.json' : 'installed-switching-comparison.json';
  const metricSummary = Object.entries(fixture.expected?.sourceMetrics ?? {})
    .map(([path, metrics]) => `\`${path}\` reports \`${JSON.stringify(metrics)}\``)
    .join('; ');
  const mutantSummary = (fixture.expected?.mutants ?? [])
    .map(mutant => `\`${mutant.path}\` byte-${mutant.offset} \`${mutant.original}\` -> \`${mutant.replacement}\``)
    .join(', ');
  const validation = isVitest
    ? `The ${metricSummary}. All ${fixture.expected?.mutants?.length ?? 'expected'} exact mutants (${mutantSummary}) were killed with no unresolved or not-run outcomes.`
    : 'Both source files report the expected \`[[1,1,1,1]]\` metrics. Both exact byte-42 \`>=\` mutants were killed with no unresolved or not-run outcomes.';
  const buildTiming = isVitest && evidence.buildCost?.status === 0
    ? `\nThe recorded candidate build took ${formatMs(evidence.buildCost.wallMs)}. ${evidence.buildCost.boundary ?? 'The build boundary was not recorded.'}\n`
    : '';
  const comparisons = evidence.comparisons ?? [];
  const phaseColumns = [
    ['Wall', 'wallMs'],
    ['Capture', 'captureMs'],
    ['Execution', 'executionMs'],
    ['Analysis', 'analysisMs'],
    ['Runner prep', 'preparationMs'],
    ['Typecheck', 'typecheckMs'],
    ['Baseline', 'baselineMs'],
    ['Coverage', 'coverageMs'],
    ['Attribution', 'attributionMs'],
    ['Worker prep', 'workerPreparationMs'],
    ['Switch prep', 'switchPreparationMs'],
    ['Prepared baseline', 'preparedBaselineMs'],
    ['Mutation', 'mutationMs'],
    ['Worker cleanup', 'workerCleanupMs'],
    ['Cleanup', 'cleanupMs'],
  ];
  const rows = comparisons.map(comparison => [
    `| ${comparison.workers} | ${formatMs(comparison.leftMedianMs)} [${formatMs(comparison.leftMinMs)}, ${formatMs(comparison.leftMaxMs)}] | ${formatMs(comparison.rightMedianMs)} [${formatMs(comparison.rightMinMs)}, ${formatMs(comparison.rightMaxMs)}] | ${formatMs(comparison.deltaMedianMs)} (${formatPercent(comparison.deltaMedianPercent)}) |`,
  ].join('\n')).join('\n');
  const phaseRows = (evidence.phaseSummary ?? []).map(({strategy, workers, timings}) =>
    `| ${strategy} | ${workers} | ${phaseColumns.map(([, key]) => formatMs(timings[key]?.medianMs)).join(' | ')} |`).join('\n');
  const phaseHeader = `| Strategy | Workers | ${phaseColumns.map(([label]) => label).join(' | ')} |`;
  const phaseDivider = `| --- | ---: | ${phaseColumns.map(() => '---:').join(' | ')} |`;
  const artifact = evidence.artifacts?.candidate;
  const candidateHash = artifact?.tarball?.sha256 ?? 'unavailable';
  const semanticHash = evidence.parity?.workerIndependentHash ?? 'unavailable';
  return `${isVitest ? '# Installed Seshat Vitest switching comparison' : '# Installed Seshat switching comparison'}

This report records the fixed candidate-only ${fixtureLabel} matrix described by
[\`${protocolFile}\`](../benchmarks/proofs/${protocolFile}).
It is fixture-specific evidence and does not establish a production performance
bound.

The installed candidate source revision is ${evidence.candidateCommit ?? 'unrecorded'}.
The candidate tarball SHA-256 is \`${candidateHash}\`. The shared workspace input
hash is \`${evidence.fixture.inputSha256}\`; the common worker-independent semantic
hash is \`${semanticHash}\`.
${buildTiming}

## Timings

Times are milliseconds. Each cell uses five measured samples; brackets contain
the minimum and maximum. Delta is switching minus replacement, so a negative
value favours switching.

| Workers | Replacement median [min, max] | Switching median [min, max] | Delta (percent) |
| ---: | ---: | ---: | ---: |
${rows}

The wall boundary runs from installed CLI process spawn through stdout and
stderr drain. It includes capture, runner preparation, original typecheck and
baseline, fresh coverage and CRAP, switching preparation and prepared baselines,
mutation execution, cleanup and report serialization. Report parsing and
semantic validation follow that boundary. Top-level invocations are serial;
workers inside the workers-2 condition may run concurrently.

${phaseHeader}
${phaseDivider}
${phaseRows}

## Validation

The matrix contains ${evidence.validation?.runCount ?? 'unavailable'} runs: one
warmup and five measured runs for each replacement/switching and worker 1/2
condition. Every run passed the original typecheck, test baseline, fresh coverage
and CRAP attribution. ${validation} Strategy-specific prepared and worker baseline rows were
validated separately before semantic parity was compared.

## Provenance

The raw portable reports and per-run timings are in
[\`${outputFile}\`](../outputs/${outputFile}).
The report retains the installed package and BUILD metadata, environment,
configuration hashes, source inventory, helper hash and protocol provenance.

The result is descriptive evidence for this small ${fixtureLabel}. It does not
claim that switching is faster for other projects, runners or hosts.
`;
}

function createFixtures() {
  const fixtures = [makeNodeFixture(), makeVitestFixture(), makeJestFixture()];
  for (const fixture of fixtures) {
    assert.equal(readdirSync(fixture.scratch).length, 0);
    fixture.inputs = snapshotInputs(fixture.project, fixture.inputPaths);
    fixture.configs = {};
    fixture.dependencyVersions = Object.fromEntries((fixture.dependencies ?? []).map(name => [name, packageVersion(fixture.project, name)]));
  }
  return fixtures;
}

function prepareFixtureConfig(fixture, workers) {
  const config = fixture.config(workers);
  json(fixture.configPath, config);
  fixture.configs[workers] = {config: portable(config), sha256: hashJson(portable(config))};
  fixture.inputs = snapshotInputs(fixture.project, fixture.inputPaths);
  return fixture.inputs;
}

function switchingBuildCost() {
  if (!cli['build-evidence']) {
    return {wallMs: null, status: 'unmeasured', reason: 'candidate build runs outside the benchmark'};
  }
  const path = realpathSync(resolve(cli['build-evidence']));
  let supplied;
  assert.doesNotThrow(() => { supplied = JSON.parse(readFileSync(path, 'utf8')); },
    'build evidence is not JSON');
  const reused = supplied.buildCost && supplied.status === undefined;
  const value = reused ? supplied.buildCost : supplied;
  assert.equal(value.status, 0, 'candidate build evidence reports failure');
  assert.ok(Number.isFinite(value.wallMs) && value.wallMs >= 0, 'build evidence wall time is invalid');
  if (candidateCommit && value.sourceRevision) {
    assert.equal(value.sourceRevision, candidateCommit, 'build evidence source revision changed');
  }
  return {
    ...portable(value),
    evidencePath: '<build-evidence>',
    source: reused ? 'historical-reused' : 'direct',
    boundary: reused
      ? `Historical reused build timing from a prior installed switching comparison; ${value.boundary ?? 'build evidence boundary was not recorded'}`
      : value.boundary ?? 'build evidence boundary was not recorded',
  };
}

function runSwitchingBenchmark() {
  assert.ok(existsSync(compiler), `TypeScript compiler missing: ${compiler}`);
  assert.ok(existsSync(collector), `coverage collector missing: ${collector}`);
  const protocolPath = join(proofHere, switchingFixture().protocol);
  assert.ok(existsSync(protocolPath), `switching protocol missing: ${protocolPath}`);
  assert.ok(cli['candidate-commit'], '--candidate-commit is required for the switching benchmark');
  assert.ok(cli['harness-commit'], '--harness-commit is required for the switching benchmark');

  const binary = installTarball('candidate', candidateTarball);
  const fixture = makeSwitchingFixture();
  fixture.configs = {};
  fixture.inputs = snapshotInputs(fixture.project, fixture.inputPaths);
  assert.equal(fixture.inputs.sha256, switchingFixture().inputSha256,
    `${fixture.id} workspace input hash changed`);
  fixture.dependencyVersions = Object.fromEntries((fixture.dependencies ?? [])
    .map(name => [name, packageVersion(fixture.project, name)]));
  const fixtureEvidence = {
    id: fixture.id,
    expected: fixture.expected,
    inputPaths: fixture.inputPaths,
    inputSha256: switchingFixture().inputSha256,
    inputs: fixture.inputs,
    configs: {},
    dependencies: fixture.dependencies ?? [],
    dependencyVersions: fixture.dependencyVersions,
  };
  if (fixture.id === 'nodeWorkspace') {
    fixtureEvidence.source = NODE_COMPARE_SOURCE;
    fixtureEvidence.rulesSource = NODE_RULES_SOURCE;
  } else {
    fixtureEvidence.sourcePaths = ['tempo.ts', 'view.tsx', 'server.ts'];
    fixtureEvidence.testPaths = ['stack.test.tsx'];
    fixtureEvidence.configPaths = ['vitest.config.mjs'];
  }
  const evidence = {
    version: 1,
    kind: switchingFixtureName === 'vitest'
      ? 'installed-vitest-switching-comparison'
      : 'installed-switching-comparison',
    mode: 'switching-matrix',
    environment: toolVersions(),
    candidateCommit,
    provenance: provenance(),
    maintainedCounts: maintainedCounts(),
    buildCost: switchingBuildCost(),
    artifacts: {candidate: binary.artifact},
    fixture: fixtureEvidence,
    limits: {
      samplesPerCondition: samples,
      warmupsPerCondition: 1,
      workers: [1, 2],
      strategies: ['replace', 'switch'],
      conditions: switchingConditions(),
      expectedExecutions: 4 * (samples + 1),
      progress: true,
      order: 'warmup uses the fixed condition order; measured pairs alternate that order and its reverse; all top-level processes are serial',
      wallBoundary: 'installed CLI process spawn through stdout/stderr drain; child report serialization is included; validation follows',
      cacheBoundary: 'each invocation captures a fresh Seshat copy; host filesystem, npm, runner and OS caches remain warm',
      hostPermissions: 'required for mutation child execution; EPERM is an environment failure, never a mutation verdict',
    },
    runs: [],
  };
  const expectedSnapshots = new Map();
  const saveEvidence = () => {
    evidence.work = portable(work);
    evidence.fixture.configs = fixture.configs;
    json(output, portable(evidence));
  };
  const recordRun = record => {
    evidence.runs.push(record);
    saveEvidence();
    const sample = record.phase === 'warmup' ? 'warmup' : `sample=${record.sample}`;
    console.log(`${record.phase} ${record.strategy} workers=${record.workers} ${sample} wall=${record.wallMs.toFixed(1)}ms`);
  };
  const runCondition = (condition, phase, sample) => {
    prepareFixtureConfig(fixture, condition.workers);
    const key = `${condition.strategy}|${condition.workers}`;
    const expectedSnapshot = expectedSnapshots.get(key) ?? {inputs: fixture.inputs, semanticHash: null};
    const result = runCheck(
      binary,
      fixture,
      condition.workers,
      true,
      'candidate',
      phase,
      phase === 'warmup' ? null : sample,
      phase === 'warmup' ? null : sample,
      expectedSnapshot,
      {retainDetails: true, strategy: condition.strategy},
    );
    if (!expectedSnapshot.semanticHash) {
      expectedSnapshot.semanticHash = result.record.semanticHash;
      expectedSnapshots.set(key, expectedSnapshot);
    }
    recordRun(result.record);
  };

  saveEvidence();
  for (const condition of switchingConditions()) runCondition(condition, 'warmup', null);
  for (let sample = 1; sample <= samples; sample += 1) {
    const order = sample % 2 === 1 ? switchingConditions() : [...switchingConditions()].reverse();
    for (const condition of order) runCondition(condition, 'measured', sample);
  }
  evidence.aggregate = aggregate(evidence.runs, ['strategy', 'workers']);
  evidence.comparisons = switchingComparisons(evidence.aggregate);
  evidence.phaseSummary = switchingPhaseSummary(evidence.runs);
  evidence.parity = assertSwitchingSummary(evidence.runs, evidence.aggregate, fixture);
  evidence.validation = {
    runCount: evidence.runs.length,
    warmups: 4,
    measured: 4 * samples,
    conditions: switchingConditions(),
    semanticHash: evidence.parity.workerIndependentHash,
  };
  evidence.conclusion = `Descriptive medians and raw ranges for one fixed installed ${fixture.id === 'vitest' ? 'Vitest/TSX fixture' : 'Node workspace'} only; no production overhead or general strategy recommendation.`;
  saveEvidence();
  mkdirSync(dirname(reportOutput), {recursive: true});
  writeFileSync(reportOutput, renderSwitchingReport(evidence));
  console.log(`Installed switching benchmark evidence: ${output}`);
  console.log(`Installed switching benchmark report: ${reportOutput}`);
}

function main() {
  if (switchingMode) {
    runSwitchingBenchmark();
    return;
  }
  const binaries = {};
  if (releaseMode) {
    binaries.candidate = installTarball('candidate', candidateTarball);
  } else {
    binaries.baseline = installTarball('baseline', baselineTarball);
    if (candidateTarball) binaries.candidate = installTarball('candidate', candidateTarball);
  }
  const fixtures = createFixtures();
  const evidence = {
    version: 1,
    kind: releaseMode ? 'release-benchmark' : 'diagnostics-overhead',
    environment: toolVersions(),
    limits: {
      samplesPerCondition: samples,
      warmupsPerCondition: 1,
      workers: [1, 2],
      progress: releaseMode ? [true] : [true, false],
      strategy: releaseMode ? 'replace' : null,
      conditions: releaseMode ? 6 : null,
      expectedExecutions: releaseMode ? 6 * (samples + 1) : null,
      order: releaseMode
        ? 'worker order alternates by measured pair within each fixture; all processes are sequential'
        : 'baseline/candidate alternates by measured pair; all processes are sequential',
      wallBoundary: 'spawn through close after stdout/stderr drains; child report serialization is included',
      cacheBoundary: 'each invocation captures a fresh Seshat copy; host filesystem, npm, runner and OS caches remain warm',
    },
    baselineCommit,
    candidateCommit,
    provenance: provenance(),
    maintainedCounts: maintainedCounts(),
    buildCost: {wallMs: null, status: 'unmeasured', reason: 'reused package metadata has no build timing'},
    artifacts: Object.fromEntries(Object.entries(binaries).map(([label, binary]) => [label, binary.artifact])),
    fixtures: Object.fromEntries(fixtures.map(fixture => [fixture.id, {
      expected: fixture.expected,
      inputs: fixture.inputs,
      configs: fixture.configs,
      dependencies: fixture.dependencies ?? [],
      dependencyVersions: fixture.dependencyVersions,
    }])),
    runs: [],
  };

  const saveEvidence = () => {
    evidence.work = portable(work);
    json(output, portable(evidence));
  };
  const updateFixtureEvidence = fixture => {
    evidence.fixtures[fixture.id] = {
      expected: fixture.expected,
      inputs: fixture.inputs,
      configs: fixture.configs,
      dependencies: fixture.dependencies ?? [],
      dependencyVersions: fixture.dependencyVersions,
    };
  };
  const recordRun = record => {
    evidence.runs.push(record);
    saveEvidence();
    const condition = `${record.fixture} workers=${record.workers} progress=${record.progress ? 'on' : 'off'}`;
    const sample = record.phase === 'warmup' ? 'warmup' : record.phase === 'preflight' ? 'preflight' : `sample=${record.sample}`;
    console.log(`${record.phase} ${condition} ${record.binary} ${sample} wall=${record.wallMs.toFixed(1)}ms`);
  };

  evidence.mode = releaseMode
    ? 'release-matrix'
    : cli['prepare-only'] ? 'prepare-only' : preflightOnly ? 'preflight-only' : 'timed-matrix';
  saveEvidence();
  if (releaseMode) {
    const expectedSnapshots = new Map();
    for (const fixture of fixtures) {
      for (const workers of [1, 2]) {
        prepareFixtureConfig(fixture, workers);
        updateFixtureEvidence(fixture);
        const expectedSnapshot = {inputs: fixture.inputs, semanticHash: null};
        const warmup = runCheck(
          binaries.candidate, fixture, workers, true, 'candidate', 'warmup', null, null,
          expectedSnapshot, {retainDetails: true});
        expectedSnapshot.semanticHash = warmup.record.semanticHash;
        expectedSnapshots.set(`${fixture.id}|${workers}`, expectedSnapshot);
        recordRun(warmup.record);
      }
      for (let pair = 0; pair < samples; pair++) {
        const workerOrder = pair % 2 === 0 ? [1, 2] : [2, 1];
        for (const workers of workerOrder) {
          prepareFixtureConfig(fixture, workers);
          updateFixtureEvidence(fixture);
          const measured = runCheck(
            binaries.candidate, fixture, workers, true, 'candidate', 'measured', pair, pair + 1,
            expectedSnapshots.get(`${fixture.id}|${workers}`), {retainDetails: true});
          recordRun(measured.record);
        }
      }
    }
    evidence.aggregate = aggregate(evidence.runs, ['fixture', 'workers', 'progress', 'binary']);
    evidence.parity = assertReleaseSummary(evidence.runs, evidence.aggregate, fixtures);
    evidence.conclusion = 'Descriptive medians and raw ranges for six fixed fixture/worker conditions only; no production overhead bound.';
    saveEvidence();
    console.log(`Release benchmark evidence: ${output}`);
    return;
  }
  if (cli['prepare-only']) {
    for (const fixture of fixtures) {
      for (const workers of [1, 2]) prepareFixtureConfig(fixture, workers);
      updateFixtureEvidence(fixture);
    }
    saveEvidence();
    console.log(`Prepared diagnostics overhead fixtures and isolated installs: ${output}`);
    return;
  }

  if (preflightOnly) {
    evidence.conclusion = 'Baseline correctness preflight only; no candidate or timing matrix was run.';
    for (const fixture of fixtures) {
      for (const workers of [1, 2]) {
        prepareFixtureConfig(fixture, workers);
        updateFixtureEvidence(fixture);
        const expectedSnapshot = {inputs: fixture.inputs, semanticHash: null};
        const preflight = runCheck(
          binaries.baseline, fixture, workers, false, 'baseline', 'preflight', null, null, expectedSnapshot);
        recordRun(preflight.record);
      }
    }
    saveEvidence();
    console.log(`Baseline diagnostics preflight evidence: ${output}`);
    return;
  }

  assert.ok(binaries.candidate, 'full timing matrix requires --candidate');

  const parity = {};
  for (const fixture of fixtures) {
    parity[fixture.id] = {};
    for (const workers of [1, 2]) {
      prepareFixtureConfig(fixture, workers);
      updateFixtureEvidence(fixture);
      const warmupProgressOrder = workers % 2 === 1 ? [true, false] : [false, true];
      const expectedSnapshots = new Map();
      for (const progress of warmupProgressOrder) {
        const condition = `${workers}/${progress ? 'on' : 'off'}`;
        parity[fixture.id][condition] = null;
        const expectedSnapshot = {inputs: fixture.inputs, semanticHash: null};
        expectedSnapshots.set(progress, expectedSnapshot);
        for (const label of ['baseline', 'candidate']) {
          const warmup = runCheck(binaries[label], fixture, workers, progress, label, 'warmup', null, null, expectedSnapshot);
          if (!parity[fixture.id][condition]) {
            parity[fixture.id][condition] = {semantic: warmup.semantic, semanticHash: warmup.record.semanticHash};
            expectedSnapshot.semanticHash = warmup.record.semanticHash;
          }
          recordRun(warmup.record);
        }
      }
      for (let pair = 0; pair < samples; pair++) {
        const progressOrder = pair % 2 === 0 ? warmupProgressOrder : [...warmupProgressOrder].reverse();
        const binaryOrder = pair % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
        for (const progress of progressOrder) {
          const expectedSnapshot = expectedSnapshots.get(progress);
          for (const label of binaryOrder) {
            const measured = runCheck(
              binaries[label], fixture, workers, progress, label, 'measured', pair, pair + 1, expectedSnapshot);
            recordRun(measured.record);
          }
        }
      }
    }
  }
  evidence.parity = parity;
  evidence.aggregate = aggregate(evidence.runs, ['fixture', 'workers', 'progress', 'binary']);
  evidence.pairs = pairComparisons(evidence.runs);
  evidence.comparisons = {
    beforeAfter: evidence.aggregate.filter(row => row.binary === 'baseline').map(row => {
      const candidate = evidence.aggregate.find(other => other.fixture === row.fixture && other.workers === row.workers && other.progress === row.progress && other.binary === 'candidate');
      return {fixture: row.fixture, workers: row.workers, progress: row.progress, ...comparison(row.samples, candidate.samples)};
    }),
    progress: fixtures.flatMap(fixture => ['baseline', 'candidate'].flatMap(binary => [1, 2].map(workers => {
      const on = evidence.aggregate.find(row => row.fixture === fixture.id && row.binary === binary && row.workers === workers && row.progress === true);
      const off = evidence.aggregate.find(row => row.fixture === fixture.id && row.binary === binary && row.workers === workers && row.progress === false);
      return {fixture: fixture.id, binary, workers, ...comparison(off.samples, on.samples)};
    }))),
  };
  evidence.conclusion = 'Descriptive medians and raw ranges only: three paired samples on fixed fixtures do not establish a production overhead bound.';
  saveEvidence();
  console.log(`Diagnostics overhead evidence: ${output}`);
}

try {
  if (selfCheck) {
    runReleaseSelfCheck();
    if (switchingMode) runSwitchingSelfCheck();
  }
  else main();
} catch (error) {
  if (work) console.error(`Diagnostics overhead work retained at ${work}`);
  throw error;
}
