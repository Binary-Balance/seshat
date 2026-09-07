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
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import os from 'node:os';
import {parseArgs} from 'node:util';

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
    'prepare-only': {type: 'boolean', default: false},
    'preflight-only': {type: 'boolean', default: false},
  },
}).values;
const repo = resolve(cli.repo);
const samples = Number(cli.samples);
const timeoutMs = Number(cli['timeout-ms']);
const preflightOnly = Boolean(cli['preflight-only']);
assert.ok(cli.baseline && (cli.candidate || cli['prepare-only'] || preflightOnly),
  'usage: node diagnostics-overhead.mjs --baseline BASE.tgz --candidate CANDIDATE.tgz --jest-deps PATH [--repo ROOT]');
assert.ok(cli['jest-deps'], '--jest-deps must point at the prepared Jest/Expo dependency fixture');
assert.ok(Number.isSafeInteger(samples) && samples >= 3 && samples <= 9 && samples % 2 === 1,
  '--samples must be an odd integer from 3 to 9');
assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, '--timeoutMs must be positive');
assert.ok(existsSync(repo), `repository does not exist: ${repo}`);
const jestDeps = realpathSync(resolve(cli['jest-deps']));
assert.ok(statSync(jestDeps).isDirectory(), `Jest/Expo dependencies do not exist: ${jestDeps}`);

const baselineTarball = realpathSync(resolve(cli.baseline));
const candidateTarball = cli.candidate ? realpathSync(resolve(cli.candidate)) : null;
for (const path of [baselineTarball, candidateTarball].filter(Boolean)) assert.ok(statSync(path).isFile(), path);

const work = mkdtempSync(join(repo, 'work/diagnostics-overhead-'));
const output = resolve(cli.output ?? join(work, 'result.json'));
const proofHere = join(repo, 'benchmarks/proofs');
const proofModules = join(proofHere, 'node_modules');
const compiler = join(repo, 'benchmarks/node_modules/typescript/bin/tsc');
const collector = join(proofHere, 'collect-node.mjs');
const nodeCommand = process.execPath;
const baselineCommit = cli['baseline-commit'] ?? null;
const candidateCommit = cli['candidate-commit'] ?? null;
const NODE_COMPARE_SOURCE = 'export const adult = (age: number) => age >= 18;\n';
const NODE_COMPARE_OFFSET = Buffer.byteLength(NODE_COMPARE_SOURCE.slice(0, NODE_COMPARE_SOURCE.indexOf('>=')));

const EXPECTED = {
  nodeWorkspace: {
    name: 'node-workspace',
    sourceMetrics: {
      'packages/rules/index.ts': [[1, 1, 1, 1]],
      'src/compare.ts': [[1, 1, 1, 1]],
    },
    mutants: [
      {id: 0, localId: 0, offset: NODE_COMPARE_OFFSET, path: 'src/compare.ts', original: '>=', replacement: '>', verdict: 'killed'},
      {id: 1, localId: 1, offset: NODE_COMPARE_OFFSET, path: 'src/compare.ts', original: '>=', replacement: '<', verdict: 'killed'},
    ],
    score: 100,
    tests: 1,
  },
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
      .replaceAll(work, '<work>')
      .replaceAll(repo, '<repo>')
      .replaceAll(jestDeps, '<jest-deps>');
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
  const artifact = {
    source: label,
    tarball: {path: portable(tarball), bytes: statSync(tarball).size, sha256: hashFile(tarball)},
    installedBinary: {path: portable(executable), bytes: statSync(executable).size, sha256: hashFile(executable)},
    version,
    package: JSON.parse(readFileSync(join(consumer, 'node_modules/@binary-balance/seshat/package.json'), 'utf8')),
  };
  return {label, executable, root, env: npmEnv, artifact};
}

function copyDirectory(source, destination) {
  mkdirSync(destination, {recursive: true});
  cpSync(source, destination, {recursive: true, verbatimSymlinks: true, force: true});
}

function writeNodeWorkspace(project) {
  mkdirSync(join(project, 'src'), {recursive: true});
  mkdirSync(join(project, 'packages/rules'), {recursive: true});
  mkdirSync(join(project, 'tests'), {recursive: true});
  mkdirSync(join(project, 'node_modules/@seshat'), {recursive: true});
  json(join(project, 'package.json'), {name: 'seshat-diagnostics-workspace', private: true, type: 'module', workspaces: ['packages/*']});
  json(join(project, 'packages/rules/package.json'), {name: '@seshat/rules', version: '0.0.0', private: true, type: 'module', exports: './index.ts'});
  json(join(project, 'tsconfig.json'), {
    compilerOptions: {
      strict: true, noEmit: true, skipLibCheck: true, target: 'ES2022', module: 'NodeNext',
      moduleResolution: 'NodeNext', allowImportingTsExtensions: true,
    },
    include: ['src/**/*.ts', 'packages/**/*.ts'],
  });
  writeFileSync(join(project, 'packages/rules/index.ts'), 'export const answer = () => 42;\n');
  writeFileSync(join(project, 'src/compare.ts'), NODE_COMPARE_SOURCE);
  assert.equal(readFileSync(join(project, 'src/compare.ts'), 'utf8'), NODE_COMPARE_SOURCE);
  writeFileSync(join(project, 'tests/check.mjs'), [
    "import {test} from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import {adult} from '../src/compare.ts';",
    "import {answer} from '@seshat/rules';",
    "test('workspace rules', () => {",
    "  assert.deepEqual([adult(17), adult(18), adult(19)], [false, true, true]);",
    '  assert.equal(answer(), 42);',
    '});',
  ].join('\n') + '\n');
  symlinkSync('../../packages/rules', join(project, 'node_modules/@seshat/rules'));
  assert.equal(readlinkSync(join(project, 'node_modules/@seshat/rules')), '../../packages/rules');
}

function nodeWorkspaceConfig(project, workers) {
  const test = [nodeCommand, '--test', '--test-concurrency=1', '--test-reporter={seshatReporter}', 'tests/check.mjs'];
  return {
    workers,
    source: {include: ['src/**/*.ts', 'packages/**/*.ts']},
    capture: ['package.json', 'tsconfig.json', 'src', 'packages', 'node_modules', 'tests'],
    setups: [{
      name: 'node-workspace', runner: 'node', cwd: '.', timeoutMs: 60000,
      typecheck: [nodeCommand, compiler, '--project', 'tsconfig.json'],
      test,
      coverage: {command: [nodeCommand, collector, 'tests/check.mjs'], report: 'coverage/coverage-final.json'},
    }],
  };
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
    inputPaths: ['package.json', 'tsconfig.json', 'src', 'packages', 'node_modules/@seshat/rules', 'tests'],
    expected: EXPECTED.nodeWorkspace,
    config: workers => nodeWorkspaceConfig(project, workers),
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

function expectedJobs(fixture, workers) {
  return 3 + fixture.expected.mutants.length + (workers - 1);
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

function metricsFor(result) {
  const metrics = {};
  for (const source of result.sources ?? []) {
    metrics[source.path] = source.result.functions.map(({complexity, covered, total, crap}) =>
      [complexity, covered, total, crap]);
  }
  return metrics;
}

function assertExpected(fixture, result, workers) {
  const {expected} = fixture;
  assert.equal(result.complete, true, `${fixture.id} report incomplete`);
  assert.equal(result.jobsAttempted, expectedJobs(fixture, workers));
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
  assert.equal(result.mutation.killed, expected.mutants.filter(item => item.verdict === 'killed').length);
  assert.equal(result.mutation.survived, expected.mutants.filter(item => item.verdict === 'survived').length);
  assert.equal(result.mutation.score, expected.score);
  assert.equal(result.mutation.workersRequested, workers);
  assert.equal(result.mutation.workersUsed, workers);
  assert.equal(result.mutation.workerBaselineJobs, workers - 1);
  assert.equal(result.mutation.completed, expected.mutants.length);
  assert.equal(result.mutation.notRun, 0);
  assert.equal(result.mutation.unresolved, 0);
  assert.equal(result.setups[0].baseline.report.passed, expected.tests);
  assert.equal(result.setups[0].coverage.report.passed, expected.tests);
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

function runCheck(binary, fixture, workers, progress, label, phase, pair, sample, expectedSnapshot) {
  const args = ['check', '--config', fixture.configPath, '--scratch', fixture.scratch, '--json'];
  if (!progress) args.push('--no-progress');
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
  assertExpected(fixture, report.result, workers);
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
    diagnosticsHash: hashJson(diagnosticsSnapshot(report)),
    diagnostics: label === 'candidate' && (phase === 'warmup' || sample === 1)
      ? diagnosticsSnapshot(report)
      : null,
    reportTimings: label === 'candidate' && (phase === 'warmup' || sample === 1)
      ? portable(report.timings ?? null)
      : null,
  };
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

function toolVersions() {
  const npm = assertCommand(run('npm', ['--version'], repo), 'npm --version').stdout.trim();
  const readVersion = path => JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')).version;
  return {
    node: process.version,
    npm,
    platform: process.platform,
    arch: process.arch,
    kernel: os.release(),
    cpu: os.cpus()[0]?.model ?? null,
    typescript: readVersion(join(repo, 'benchmarks/node_modules/typescript')),
    proofTools: {
      vitest: readVersion(join(proofModules, 'vitest')),
      '@vitest/coverage-istanbul': readVersion(join(proofModules, '@vitest/coverage-istanbul')),
      jest: readVersion(join(jestDeps, 'node_modules/jest')),
      'jest-expo': readVersion(join(jestDeps, 'node_modules/jest-expo')),
    },
  };
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

function main() {
  const binaries = {
    baseline: installTarball('baseline', baselineTarball),
  };
  if (candidateTarball) binaries.candidate = installTarball('candidate', candidateTarball);
  const fixtures = createFixtures();
  const evidence = {
    version: 1,
    kind: 'diagnostics-overhead',
    environment: toolVersions(),
    limits: {
      samplesPerCondition: samples,
      warmupsPerCondition: 1,
      workers: [1, 2],
      progress: [true, false],
      order: 'baseline/candidate alternates by measured pair; all processes are sequential',
      wallBoundary: 'spawn through close after stdout/stderr drains; child report serialization is included',
      cacheBoundary: 'each invocation captures a fresh Seshat copy; host filesystem, npm, runner and OS caches remain warm',
    },
    baselineCommit,
    candidateCommit,
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

  evidence.mode = cli['prepare-only'] ? 'prepare-only' : preflightOnly ? 'preflight-only' : 'timed-matrix';
  saveEvidence();
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
  main();
} catch (error) {
  console.error(`Diagnostics overhead work retained at ${work}`);
  throw error;
}
