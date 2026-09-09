#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
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
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {
  NODE_COMPARE_OFFSET,
  NODE_COMPARE_SOURCE,
  NODE_RULES_SOURCE,
  NODE_WORKSPACE_EXPECTED,
  NODE_WORKSPACE_INPUT_PATHS,
  NODE_WORKSPACE_INPUT_SHA256,
  nodeWorkspaceSeshatConfig,
  writeNodeWorkspace,
} from './node-workspace-fixture.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const proofHere = join(repo, 'benchmarks/proofs');
const strykerHere = join(repo, 'benchmarks/stryker');
const compiler = join(repo, 'benchmarks/node_modules/typescript/bin/tsc');
const collector = join(proofHere, 'collect-node.mjs');
const strykerBinary = join(strykerHere, 'node_modules/.bin/stryker');
const nodeCommand = process.execPath;
const defaultTarball = join(repo, 'work/npm-pack-BR2zxn/binary-balance-seshat-0.0.0.tgz');
const defaultTimeoutMs = 180000;
const equalityOnlyExclusions = [
  'ArithmeticOperator',
  'ArrayDeclaration',
  'ArrowFunction',
  'AssignmentOperator',
  'BlockStatement',
  'BooleanLiteral',
  'CallExpression',
  'ConditionalExpression',
  'LogicalOperator',
  'MethodExpression',
  'ObjectLiteral',
  'OptionalChaining',
  'Regex',
  'StringLiteral',
  'UnaryOperator',
  'UpdateOperator',
];

const cli = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: false,
  options: {
    mode: {type: 'string', default: 'preflight'},
    output: {type: 'string'},
    repo: {type: 'string', default: repo},
    'seshat-binary': {type: 'string'},
    'seshat-tarball': {type: 'string', default: defaultTarball},
    tool: {type: 'string', default: 'both'},
    workers: {type: 'string', default: '1'},
    samples: {type: 'string', default: '5'},
    'timeout-ms': {type: 'string', default: String(defaultTimeoutMs)},
  },
}).values;

const root = resolve(cli.repo);
const mode = cli.mode;
const workersArgument = Number(cli.workers);
const samples = Number(cli.samples);
const timeoutMs = Number(cli['timeout-ms']);
assert.ok(['self-check', 'preflight', 'matrix'].includes(mode), '--mode must be self-check, preflight or matrix');
assert.ok(['both', 'seshat', 'stryker'].includes(cli.tool), '--tool must be both, seshat or stryker');
assert.ok(Number.isInteger(workersArgument) && [1, 2].includes(workersArgument), '--workers must be 1 or 2');
assert.equal(samples, 5, '--samples is fixed at 5 by the protocol');
assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, '--timeout-ms must be positive');

function writeJson(path, value) {
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

function run(command, args, cwd, limit = timeoutMs) {
  const start = performance.now();
  const child = spawnSync(command, args, {
    cwd,
    env: {...process.env, FORCE_COLOR: '0'},
    encoding: 'utf8',
    timeout: limit,
    maxBuffer: 128 * 1024 * 1024,
  });
  return {
    status: child.status,
    signal: child.signal,
    error: child.error?.message ?? null,
    stdout: child.stdout ?? '',
    stderr: child.stderr ?? '',
    wallMs: performance.now() - start,
  };
}

function assertCommand(result, label) {
  assert.equal(result.status, 0,
    `${label} exited ${result.status} signal=${result.signal} error=${result.error}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

function walkInputs(rootPath, paths) {
  const rows = [];
  const visit = relativePath => {
    const path = join(rootPath, relativePath);
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

function snapshotInputs(project, paths = NODE_WORKSPACE_INPUT_PATHS) {
  const files = walkInputs(project, paths);
  return {files, sha256: hashJson(files)};
}

function assertInputs(project, snapshot) {
  assert.deepEqual(snapshotInputs(project), snapshot, `${project} fixture inputs changed`);
}

function portable(value, replacements = []) {
  if (typeof value === 'string') {
    return replacements.reduce((result, [from, to]) => result.replaceAll(from, to), value);
  }
  if (Array.isArray(value)) return value.map(item => portable(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, portable(item, replacements)]));
  }
  return value;
}

function createStrykerConfig(workers) {
  return {
    mutate: ['src/compare.ts', 'packages/rules/index.ts'],
    testRunner: 'command',
    commandRunner: {
      command: `${nodeCommand} --test --test-concurrency=1 tests/check.mjs`,
    },
    coverageAnalysis: 'off',
    concurrency: workers,
    mutator: {excludedMutations: equalityOnlyExclusions},
    reporters: ['json'],
    jsonReporter: {fileName: 'reports/stryker.json'},
    disableTypeChecks: true,
    cleanTempDir: 'always',
    timeoutMS: 60000,
  };
}

function createFixture(workRoot, workers) {
  const project = mkdtempSync(join(workRoot, 'fixture-'));
  const scratch = mkdtempSync(join(workRoot, 'scratch-'));
  writeNodeWorkspace(project);
  const seshatConfigPath = join(project, 'seshat.json');
  const strykerConfigPath = join(project, 'stryker.config.json');
  writeJson(seshatConfigPath, nodeWorkspaceSeshatConfig({
    collector,
    compiler,
    nodeCommand,
    workers,
  }));
  writeJson(strykerConfigPath, createStrykerConfig(workers));
  return {
    project,
    scratch,
    seshatConfigPath,
    strykerConfigPath,
    inputs: snapshotInputs(project),
    configHashes: {
      seshat: hashFile(seshatConfigPath),
      stryker: hashFile(strykerConfigPath),
    },
    executions: [],
  };
}

function cleanupFixture(fixture) {
  rmSync(fixture.project, {recursive: true, force: true});
  rmSync(fixture.scratch, {recursive: true, force: true});
}

function recordExecution(fixture, label, args, result) {
  fixture.executions.push({label, args, cwd: fixture.project, ...result});
}

function preserveFailure(fixture, workRoot, tool, workers, phase, sample, error) {
  const suffix = sample === null ? 'preflight' : `${phase}-${sample}`;
  const failureRoot = mkdtempSync(join(workRoot, `failure-${tool}-workers${workers}-${suffix}-`));
  cpSync(fixture.project, join(failureRoot, 'project'), {recursive: true, verbatimSymlinks: true});
  cpSync(fixture.scratch, join(failureRoot, 'scratch'), {recursive: true, verbatimSymlinks: true});
  writeFileSync(join(failureRoot, 'error.txt'), `${error?.stack ?? error}\n`);
  writeJson(join(failureRoot, 'executions.json'), fixture.executions);
  return failureRoot;
}

function assertFixtureUnchanged(fixture) {
  assertInputs(fixture.project, fixture.inputs);
  assert.equal(hashFile(fixture.seshatConfigPath), fixture.configHashes.seshat, 'Seshat config changed');
  assert.equal(hashFile(fixture.strykerConfigPath), fixture.configHashes.stryker, 'Stryker config changed');
  assert.equal(readdirSync(fixture.scratch).length, 0, 'Seshat scratch was not cleaned');
  assert.equal(existsSync(join(fixture.project, '.stryker-tmp')), false, 'Stryker temporary directory was not cleaned');
}

function positionToCharOffset(source, position) {
  assert.ok(Number.isInteger(position?.line) && position.line >= 1, 'invalid Stryker location line');
  assert.ok(Number.isInteger(position?.column) && position.column >= 1, 'invalid Stryker location column');
  let lineStart = 0;
  for (let line = 1; line < position.line; line += 1) {
    const newline = source.indexOf('\n', lineStart);
    assert.notEqual(newline, -1, 'Stryker location points past source');
    lineStart = newline + 1;
  }
  const offset = lineStart + position.column - 1;
  assert.ok(offset <= source.length, 'Stryker location column points past source');
  return offset;
}

function reportPath(project, key) {
  const path = key.startsWith('file:') ? fileURLToPath(key) : resolve(project, key);
  const relativePath = relative(project, path).split(sep).join('/');
  assert.ok(relativePath && !relativePath.startsWith('../') && relativePath !== '..', `Stryker report path escapes fixture: ${key}`);
  return relativePath;
}

function replacementOperator(originalSpan, replacementText) {
  const matches = ['>', '<'].filter(operator =>
    replacementText === operator || replacementText === originalSpan.replace('>=', operator));
  assert.equal(matches.length, 1,
    `unsupported Stryker replacement ${JSON.stringify(replacementText)} for ${JSON.stringify(originalSpan)}`);
  return matches[0];
}

function normalizeStrykerReport(report, project) {
  assert.ok(report && typeof report.files === 'object', 'Stryker report has no files');
  const expectedSources = {
    'packages/rules/index.ts': NODE_RULES_SOURCE,
    'src/compare.ts': NODE_COMPARE_SOURCE,
  };
  const reportSources = Object.entries(report.files).map(([key, file]) => ({
    path: reportPath(project, key),
    file,
  }));
  assert.equal(new Set(reportSources.map(({path}) => path)).size, reportSources.length,
    'Stryker report has duplicate source paths');
  assert.deepEqual(reportSources.map(({path}) => path).sort(), Object.keys(expectedSources).sort(),
    'Stryker report source files differ from the shared fixture');
  for (const {path, file} of reportSources) {
    assert.equal(typeof file.source, 'string', `Stryker report has no source for ${path}`);
    assert.deepEqual(Buffer.from(file.source), Buffer.from(expectedSources[path]),
      `Stryker report source bytes differ for ${path}`);
  }
  const mutants = [];
  const ignored = [];
  for (const {path, file} of reportSources) {
    for (const mutant of file.mutants ?? []) {
      if (mutant.status === 'Ignored') {
        assert.ok(equalityOnlyExclusions.includes(mutant.mutatorName),
          `unexpected Stryker ignored mutator ${mutant.mutatorName}`);
        ignored.push({path, mutatorName: mutant.mutatorName, status: mutant.status, id: mutant.id});
        continue;
      }
      assert.equal(mutant.mutatorName, 'EqualityOperator', `unexpected Stryker mutator ${mutant.mutatorName}`);
      assert.equal(mutant.testsCompleted, NODE_WORKSPACE_EXPECTED.tests,
        `Stryker mutant ${mutant.id} did not complete the shared test count`);
      assert.match(mutant.statusReason ?? '', /ERR_ASSERTION/,
        `Stryker mutant ${mutant.id} has no assertion failure evidence`);
      assert.match(mutant.statusReason ?? '', /tests[\\/]check\.mjs/,
        `Stryker mutant ${mutant.id} has no shared test evidence`);
      const start = positionToCharOffset(file.source, mutant.location?.start);
      const end = positionToCharOffset(file.source, mutant.location?.end);
      assert.ok(end > start, `empty Stryker location for ${path}`);
      const span = file.source.slice(start, end);
      const operatorOffsets = [];
      for (let offset = span.indexOf('>='); offset !== -1; offset = span.indexOf('>=', offset + 1)) {
        operatorOffsets.push(offset);
      }
      assert.equal(operatorOffsets.length, 1,
        `unsupported Stryker source span for ${path}: ${JSON.stringify(span)}`);
      const characterOffset = start + operatorOffsets[0];
      const original = file.source.slice(characterOffset, characterOffset + 2);
      assert.equal(original, '>=', `Stryker source at normalized location is not >= for ${path}`);
      const replacement = replacementOperator(span, mutant.replacement);
      mutants.push({
        path,
        offset: Buffer.byteLength(file.source.slice(0, characterOffset)),
        original,
        replacement,
        verdict: mutant.status === 'Killed' ? 'killed' : mutant.status,
        mutatorName: mutant.mutatorName,
        status: mutant.status,
        id: mutant.id,
        location: mutant.location,
        testsCompleted: mutant.testsCompleted,
        statusReason: mutant.statusReason,
      });
    }
  }
  return {
    active: mutants.sort((left, right) => `${left.path}:${left.offset}:${left.replacement}`.localeCompare(`${right.path}:${right.offset}:${right.replacement}`)),
    ignored,
  };
}

function expectedMutants() {
  return NODE_WORKSPACE_EXPECTED.mutants
    .map(({path, offset, original, replacement, verdict}) => ({path, offset, original, replacement, verdict}))
    .sort((left, right) => `${left.path}:${left.offset}:${left.replacement}`.localeCompare(`${right.path}:${right.offset}:${right.replacement}`));
}

function assertSemanticRuns(runs) {
  const expected = expectedMutants();
  const expectedHash = hashJson(expected);
  assert.ok(runs.length > 0, 'no semantic runs recorded');
  assert.ok(runs.every(run => run.semanticHash === expectedHash), 'semantic hash differs from the shared fixture');
  assert.ok(runs.every(run => JSON.stringify(run.semantic) === JSON.stringify(expected)),
    'normalized semantic tuples differ from the shared fixture');
  assert.equal(new Set(runs.map(run => run.semanticHash)).size, 1, 'semantic hashes differ between tools');
  return expectedHash;
}

function assertMatrixEvidence(evidence) {
  const runs = evidence.runs;
  assert.equal(runs.length, 24, 'matrix must contain exactly 24 runs');
  assert.equal(runs.filter(run => run.phase === 'warmup').length, 4, 'matrix must contain four warmups');
  assert.equal(runs.filter(run => run.phase === 'measured').length, 20, 'matrix must contain twenty measured runs');
  const conditions = ['seshat:1', 'stryker:1', 'seshat:2', 'stryker:2'];
  assert.deepEqual([...new Set(runs.map(run => `${run.tool}:${run.workers}`))].sort(), conditions.sort(),
    'matrix conditions differ from the protocol');
  for (const condition of conditions) {
    const conditionRuns = runs.filter(run => `${run.tool}:${run.workers}` === condition);
    assert.equal(conditionRuns.filter(run => run.phase === 'warmup').length, 1,
      `${condition} must have one warmup`);
    assert.equal(conditionRuns.filter(run => run.phase === 'measured').length, 5,
      `${condition} must have five measured runs`);
  }
  const semanticHash = assertSemanticRuns(runs);
  evidence.validation = {
    runCount: runs.length,
    warmups: 4,
    measured: 20,
    conditions,
    semanticHash,
  };
}

function assertStrykerReport(report, project) {
  const normalized = normalizeStrykerReport(report, project);
  const semantic = normalized.active.map(({path, offset, original, replacement, verdict}) => ({
    path, offset, original, replacement, verdict,
  }));
  assert.deepEqual(semantic, expectedMutants(), 'Stryker mutants differ from the shared fixture');
  assert.ok(semantic.every(mutant => mutant.verdict === 'killed'), 'Stryker returned a non-killed mutant');
  assert.equal(semantic.length, 2);
  assert.equal(report.thresholds?.high, 80, 'unexpected Stryker threshold high');
  assert.equal(report.thresholds?.low, 60, 'unexpected Stryker threshold low');
  return {semantic, details: normalized};
}

function assertSeshatReport(report, workers) {
  const result = report.result ?? report;
  assert.equal(result.phase, 'mutate');
  assert.equal(result.complete, true, 'Seshat mutation report incomplete');
  assert.equal(result.setups?.length, 1);
  const setup = result.setups[0];
  assert.equal(setup.typecheck.state, 'passed');
  assert.equal(setup.baseline.state, 'passed');
  assert.equal(setup.coverage.state, 'not-requested');
  assert.equal(setup.baseline.report.passed, NODE_WORKSPACE_EXPECTED.tests);
  const mutation = result.mutation;
  assert.ok(mutation, 'Seshat mutation result missing');
  assert.equal(mutation.planned, 2);
  assert.equal(mutation.killed, 2);
  assert.equal(mutation.survived, 0);
  assert.equal(mutation.score, 100);
  assert.equal(mutation.workersRequested, workers);
  assert.equal(mutation.workersUsed, workers);
  assert.equal(mutation.workerBaselineJobs, workers - 1);
  assert.equal(mutation.completed, 2);
  assert.equal(mutation.notRun, 0);
  assert.equal(mutation.unresolved, 0);
  assert.equal(result.jobsAttempted, 2 + NODE_WORKSPACE_EXPECTED.mutants.length + workers - 1);
  const normalized = (mutation.outcomes ?? []).map(({path, offset, original, replacement, verdict}) => ({
    path, offset, original, replacement, verdict,
  })).sort((left, right) => `${left.path}:${left.offset}:${left.replacement}`.localeCompare(`${right.path}:${right.offset}:${right.replacement}`));
  assert.deepEqual(normalized, expectedMutants(), 'Seshat mutants differ from the shared fixture');
  return normalized;
}

function loadJson(path, label) {
  let value;
  assert.doesNotThrow(() => { value = JSON.parse(readFileSync(path, 'utf8')); }, `${label} is not JSON`);
  return value;
}

function runSeshat(binary, fixture, workers) {
  const args = [
    'mutate', '--config', fixture.seshatConfigPath, '--scratch', fixture.scratch,
    '--json', '--no-progress',
  ];
  const execution = run(binary, args, fixture.project);
  recordExecution(fixture, 'seshat', args, execution);
  assertCommand(execution, `Seshat workers=${workers}`);
  const report = loadJsonFromText(execution.stdout, 'Seshat');
  const semantic = assertSeshatReport(report, workers);
  assertFixtureUnchanged(fixture);
  return {
    tool: 'seshat',
    workers,
    wallMs: execution.wallMs,
    stdoutBytes: Buffer.byteLength(execution.stdout),
    stderrBytes: Buffer.byteLength(execution.stderr),
    semantic,
    semanticHash: hashJson(semantic),
    report,
  };
}

function loadJsonFromText(text, label) {
  let value;
  assert.doesNotThrow(() => { value = JSON.parse(text); }, `${label} did not emit JSON\n${text}`);
  return value;
}

function runStryker(fixture, workers) {
  const start = performance.now();
  const typecheckArgs = [compiler, '--project', 'tsconfig.json'];
  const typecheck = run(nodeCommand, typecheckArgs, fixture.project);
  recordExecution(fixture, 'stryker-typecheck', typecheckArgs, typecheck);
  assertCommand(typecheck, `Stryker original TypeScript check workers=${workers}`);
  const mutationArgs = ['run'];
  const mutation = run(strykerBinary, mutationArgs, fixture.project);
  recordExecution(fixture, 'stryker', mutationArgs, mutation);
  assertCommand(mutation, `Stryker workers=${workers}`);
  const wallMs = performance.now() - start;
  const reportPath = join(fixture.project, 'reports/stryker.json');
  assert.ok(existsSync(reportPath), 'Stryker JSON report missing');
  const report = loadJson(reportPath, 'Stryker');
  const {semantic, details} = assertStrykerReport(report, fixture.project);
  assertFixtureUnchanged(fixture);
  return {
    tool: 'stryker',
    workers,
    wallMs,
    phases: {typecheckMs: typecheck.wallMs, strykerMs: mutation.wallMs},
    stdoutBytes: Buffer.byteLength(mutation.stdout),
    stderrBytes: Buffer.byteLength(mutation.stderr),
    semantic,
    semanticHash: hashJson(semantic),
    details,
    report,
  };
}

function installSeshat(tarball, workRoot) {
  assert.ok(existsSync(tarball), `Seshat tarball does not exist: ${tarball}`);
  const installRoot = mkdtempSync(join(workRoot, 'seshat-install-'));
  const consumer = join(installRoot, 'consumer');
  mkdirSync(consumer, {recursive: true});
  writeJson(join(consumer, 'package.json'), {
    name: 'seshat-stryker-comparison-consumer',
    version: '0.0.0',
    private: true,
  });
  const npmCache = join(installRoot, 'npm-cache');
  mkdirSync(npmCache, {recursive: true});
  const installation = run('npm', [
    'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    '--save-dev', '--save-exact', '--cache', npmCache, tarball,
  ], consumer, 180000);
  assertCommand(installation, 'Seshat candidate install');
  const binary = realpathSync(resolve(consumer, 'node_modules/.bin/seshat'));
  assert.ok(statSync(binary).isFile(), `Seshat executable missing: ${binary}`);
  const version = assertCommand(run(binary, ['--version'], consumer), 'Seshat --version').stdout.trim();
  const packageRoot = join(consumer, 'node_modules/@binary-balance/seshat');
  const packageFiles = walkInputs(consumer, ['node_modules/@binary-balance/seshat']);
  return {
    binary,
    version,
    artifact: {
      tarball: {bytes: statSync(tarball).size, sha256: hashFile(tarball)},
      binary: {bytes: statSync(binary).size, sha256: hashFile(binary)},
      package: JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')),
      installedPackage: {
        bytes: packageFiles.reduce((total, file) => total + (file.bytes ?? 0), 0),
        files: packageFiles.length,
        sha256: hashJson(packageFiles),
      },
      installWallMs: installation.wallMs,
    },
  };
}

function strykerArtifact() {
  const lockPath = join(strykerHere, 'package-lock.json');
  const binary = realpathSync(strykerBinary);
  const lock = loadJson(lockPath, 'Stryker package lock');
  const dependencyFiles = walkInputs(strykerHere, ['node_modules']);
  const dependencyCount = Object.keys(lock.packages ?? {})
    .filter(path => path.includes('node_modules/')).length;
  return {
    version: JSON.parse(readFileSync(join(strykerHere, 'node_modules/@stryker-mutator/core/package.json'), 'utf8')).version,
    packageLock: {bytes: statSync(lockPath).size, sha256: hashFile(lockPath)},
    binary: {bytes: statSync(binary).size, sha256: hashFile(binary)},
    installedDependencies: {
      scope: 'benchmarks/stryker/node_modules only; shared Node and TypeScript packages excluded',
      count: dependencyCount,
      files: dependencyFiles.length,
      bytes: dependencyFiles.reduce((total, file) => total + (file.bytes ?? 0), 0),
      sha256: hashJson(dependencyFiles),
    },
  };
}

function fileArtifact(path) {
  return {path, bytes: statSync(path).size, sha256: hashFile(path)};
}

function toolEnvironment(seshat) {
  const npmVersion = assertCommand(run('npm', ['--version'], root), 'npm --version').stdout.trim();
  return {
    node: process.version,
    npm: npmVersion,
    stryker: JSON.parse(readFileSync(join(strykerHere, 'node_modules/@stryker-mutator/core/package.json'), 'utf8')).version,
    typescript: JSON.parse(readFileSync(join(repo, 'benchmarks/node_modules/typescript/package.json'), 'utf8')).version,
    seshat: seshat.version,
    platform: process.platform,
    arch: process.arch,
    kernel: os.release(),
    cpu: os.cpus()[0]?.model ?? null,
    logicalCPUs: os.availableParallelism?.() ?? os.cpus().length,
    memoryBytes: os.totalmem(),
  };
}

function runSample(tool, workers, phase, sample, workRoot, seshatBinary) {
  const fixture = createFixture(workRoot, workers);
  let validated = false;
  try {
    const result = tool === 'seshat'
      ? runSeshat(seshatBinary, fixture, workers)
      : runStryker(fixture, workers);
    const configs = {
      seshat: loadJson(fixture.seshatConfigPath, 'Seshat config'),
      stryker: loadJson(fixture.strykerConfigPath, 'Stryker config'),
    };
    validated = true;
    return {
      ...result,
      phase,
      sample,
      inputs: fixture.inputs,
      configHashes: fixture.configHashes,
      configs,
    };
  } catch (error) {
    const failureRoot = preserveFailure(fixture, workRoot, tool, workers, phase, sample, error);
    if (error && typeof error === 'object' && 'message' in error) {
      error.message = `${error.message}\nFailure artifacts preserved at ${failureRoot}`;
    }
    throw error;
  } finally {
    if (validated) cleanupFixture(fixture);
  }
}

function runSelfCheck() {
  const workRoot = mkdtempSync(join(root, 'work/stryker-self-check-'));
  const fixture = createFixture(workRoot, 1);
  try {
    assert.equal(readFileSync(join(fixture.project, 'src/compare.ts'), 'utf8'), NODE_COMPARE_SOURCE);
    assert.equal(readFileSync(join(fixture.project, 'packages/rules/index.ts'), 'utf8'), NODE_RULES_SOURCE);
    assert.equal(snapshotInputs(fixture.project).sha256, NODE_WORKSPACE_INPUT_SHA256);
    assert.equal(NODE_COMPARE_OFFSET, 42);
    const sourceEnd = NODE_COMPARE_SOURCE.indexOf(';') + 1;
    const location = {
      start: {line: 1, column: NODE_COMPARE_SOURCE.indexOf('age >=') + 1},
      end: {line: 1, column: sourceEnd},
    };
    const statusReason = 'AssertionError [ERR_ASSERTION] at tests/check.mjs';
    const activeMutants = [
      {id: 'synthetic-gt', mutatorName: 'EqualityOperator', location, replacement: 'age > 18', status: 'Killed', testsCompleted: 1, statusReason},
      {id: 'synthetic-lt', mutatorName: 'EqualityOperator', location, replacement: 'age < 18', status: 'Killed', testsCompleted: 1, statusReason},
    ];
    const synthetic = {
      thresholds: {high: 80, low: 60},
      performance: {initialRun: 1},
      files: {
        'packages/rules/index.ts': {
          language: 'typescript',
          source: NODE_RULES_SOURCE,
          mutants: [],
        },
        'src/compare.ts': {
          language: 'typescript',
          source: NODE_COMPARE_SOURCE,
          mutants: activeMutants,
        },
      },
    };
    const positive = assertStrykerReport(synthetic, fixture.project);
    assert.deepEqual(positive.semantic, expectedMutants());
    const wrongMutator = structuredClone(synthetic);
    wrongMutator.files['src/compare.ts'].mutants[0].mutatorName = 'ArrowFunction';
    assert.throws(() => assertStrykerReport(wrongMutator, fixture.project));
    const wrongOperator = structuredClone(synthetic);
    wrongOperator.files['src/compare.ts'].mutants[0].replacement = 'age + 18';
    assert.throws(() => assertStrykerReport(wrongOperator, fixture.project));
    const wrongLocation = structuredClone(synthetic);
    wrongLocation.files['src/compare.ts'].mutants[0].location = {
      start: {line: 1, column: NODE_COMPARE_SOURCE.indexOf('18') + 1},
      end: {line: 1, column: NODE_COMPARE_SOURCE.indexOf(';') + 1},
    };
    assert.throws(() => assertStrykerReport(wrongLocation, fixture.project));
    const wrongSource = structuredClone(synthetic);
    wrongSource.files['src/compare.ts'].source = NODE_COMPARE_SOURCE.replace('>=', '==');
    assert.throws(() => assertStrykerReport(wrongSource, fixture.project));
    const wrongVerdict = structuredClone(synthetic);
    wrongVerdict.files['src/compare.ts'].mutants[1].status = 'Survived';
    assert.throws(() => assertStrykerReport(wrongVerdict, fixture.project));
    const extraMutant = structuredClone(synthetic);
    extraMutant.files['src/compare.ts'].mutants.push({...activeMutants[0], id: 'synthetic-extra'});
    assert.throws(() => assertStrykerReport(extraMutant, fixture.project));
    console.log('Stryker Node comparison self-check passed.');
  } finally {
    cleanupFixture(fixture);
  }
}

function assertUsage() {
  assert.ok(existsSync(compiler), `TypeScript compiler missing: ${compiler}`);
  assert.ok(existsSync(strykerBinary), `Stryker CLI missing: ${strykerBinary}`);
  assert.ok(existsSync(collector), `coverage collector missing: ${collector}`);
}

function saveEvidence(path, evidence) {
  writeJson(path, evidence);
  console.log(`Stryker Node comparison evidence: ${path}`);
}

function main() {
  if (mode === 'self-check') {
    runSelfCheck();
    return;
  }
  assertUsage();
  const workRoot = mkdtempSync(join(root, 'work/stryker-node-comparison-'));
  const tarball = resolve(cli['seshat-tarball']);
  const seshat = cli['seshat-binary']
    ? {binary: resolve(cli['seshat-binary']), version: 'provided', artifact: null}
    : installSeshat(tarball, workRoot);
  assert.ok(statSync(seshat.binary).isFile(), `Seshat binary missing: ${seshat.binary}`);
  const evidence = {
    version: 1,
    protocol: 'benchmarks/proofs/stryker-node-comparison.md',
    mode,
    environment: toolEnvironment(seshat),
    seshatArtifact: seshat.artifact,
    strykerArtifact: strykerArtifact(),
    provenance: {
      driver: fileArtifact(join(proofHere, 'stryker-node-comparison.mjs')),
      fixtureHelper: fileArtifact(join(proofHere, 'node-workspace-fixture.mjs')),
      protocol: fileArtifact(join(proofHere, 'stryker-node-comparison.md')),
    },
    fixture: {
      source: NODE_COMPARE_SOURCE,
      rulesSource: NODE_RULES_SOURCE,
      expected: NODE_WORKSPACE_EXPECTED,
      inputPaths: NODE_WORKSPACE_INPUT_PATHS,
      inputSha256: NODE_WORKSPACE_INPUT_SHA256,
      expectedSemantic: expectedMutants(),
      expectedSemanticHash: hashJson(expectedMutants()),
    },
    limits: {
      warmupsPerToolWorker: 1,
      samplesPerToolWorker: samples,
      workers: mode === 'matrix' ? [1, 2] : [workersArgument],
      coverage: 'excluded',
      crap: 'excluded',
      timing: 'child process spawn through stdout/stderr drain; report validation follows',
      order: 'tool and worker order rotate between measured pairs; all invocations are serial',
    },
    runs: [],
  };
  const output = resolve(cli.output ?? join(workRoot, 'evidence.json'));
  if (mode === 'preflight') {
    const tools = cli.tool === 'both' ? ['seshat', 'stryker'] : [cli.tool];
    for (const tool of tools) {
      const result = runSample(tool, workersArgument, 'preflight', null, workRoot, seshat.binary);
      evidence.runs.push(result);
      console.log(`preflight ${tool} workers=${workersArgument} wall=${result.wallMs.toFixed(1)}ms`);
    }
    evidence.validation = {
      runCount: evidence.runs.length,
      semanticHash: assertSemanticRuns(evidence.runs),
    };
    saveEvidence(output, portable(evidence, [[workRoot, '<work>'], [root, '<repo>']]));
    return;
  }
  const conditions = mode === 'matrix' ? [1, 2] : [workersArgument];
  for (let pair = 0; pair <= samples; pair += 1) {
    const phase = pair === 0 ? 'warmup' : 'measured';
    const workerOrder = pair % 2 === 0 ? conditions : [...conditions].reverse();
    for (const workers of workerOrder) {
      const toolOrder = (pair + workers) % 2 === 0 ? ['seshat', 'stryker'] : ['stryker', 'seshat'];
      for (const tool of toolOrder) {
        const result = runSample(tool, workers, phase, phase === 'measured' ? pair : null, workRoot, seshat.binary);
        evidence.runs.push(result);
        saveEvidence(output, portable(evidence, [[workRoot, '<work>'], [root, '<repo>']]));
        console.log(`${phase} ${tool} workers=${workers} wall=${result.wallMs.toFixed(1)}ms`);
      }
    }
  }
  assertMatrixEvidence(evidence);
  saveEvidence(output, portable(evidence, [[workRoot, '<work>'], [root, '<repo>']]));
}

try {
  main();
} catch (error) {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
}
