// Build the portable metadata file retained by the native ARM64 workflow.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {packageFiles, readArchiveBuild, repeatArtifacts, repeatPassed} from './repeat-proof.mjs';

const selfCheck = process.argv[2] === '--self-check';
assert.ok(selfCheck || process.argv.length === 3,
  'usage: node benchmarks/proofs/linux-arm64-summary.mjs <artifact directory> | --self-check');

const cliScenarios = value => Number(value?.checks?.['installed-cli-regression']?.stdout?.match(/CLI passed: (\d+) scenarios/)?.[1] ?? NaN) || null;
const statuses = value => Object.fromEntries(Object.entries(value?.checks ?? {}).map(([name, check]) => [name, check.status]));
const runnerCases = {
  jestExpo: ['normal-1', 'assertion-kill', 'survivor', 'before-all'],
  vitest: ['stack', 'assertion', 'survived', 'before-all'],
};
const lifecycleCases = [
  ...['SIGINT', 'SIGTERM'].flatMap(signal => ['typecheck', 'baseline', 'coverage', 'mutation'].map(phase => `${signal}-${phase}`)),
  'timeout', 'overflow', 'leader-exit',
];
const environmentNames = ['CARGO_HOME', 'RUSTUP_HOME', 'CARGO_TARGET_DIR', 'NODE_OPTIONS', 'SESHAT_MUTANT_ID'];
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');

function validateRunner(label, value, cases, packed, artifacts, fail) {
  if (!value) {
    fail(`${label} result missing`);
    return;
  }
  if (value.version !== 1) fail(`${label} result version missing`);
  if (value.checks?.requested !== cases.length || value.checks?.completed !== cases.length) {
    fail(`${label} did not retain ${cases.length} requested checks`);
  }
  if (!value.originalsPreserved) fail(`${label} source preservation check failed`);
  const noRust = value.noConsumingRust;
  if (!noRust) fail(`${label} no-Rust evidence missing`);
  else {
    for (const command of ['cargo', 'rustc']) {
      if (noRust.probes?.find(probe => probe.command === command)?.unavailable !== true) {
        fail(`${label} consuming ${command} probe was available`);
      }
    }
    if (!environmentNames.every(name => noRust.environmentUnset?.includes(name))) {
      fail(`${label} consuming environment was not sanitized`);
    }
  }
  if (value.cli?.source !== 'tarball') fail(`${label} did not record tarball installation`);
  if (value.cli?.version !== 'seshat 0.0.0 (candidate)') fail(`${label} candidate version missing`);
  if (packed && value.cli?.binarySha256 !== packed.binary) fail(`${label} binary hash differs from package metadata`);
  if (artifacts.tarball?.sha256 && value.cli?.tarballSha256 !== artifacts.tarball.sha256) {
    fail(`${label} tarball hash differs from retained archive`);
  }
  const runs = value.runs;
  if (!runs || Object.keys(runs).length !== cases.length) fail(`${label} result is partial`);
  for (const name of cases) {
    const run = runs?.[name];
    if (!run) {
      fail(`${label} check missing: ${name}`);
      continue;
    }
    const result = run.result ?? run.report?.result;
    const expectedComplete = name !== 'before-all';
    if (!run.report || run.report.complete !== expectedComplete) fail(`${label} report incomplete: ${name}`);
    if (result?.complete !== expectedComplete) fail(`${label} result verdict mismatch: ${name}`);
    if (run.execution?.status !== (expectedComplete ? 0 : 2)) fail(`${label} exit status mismatch: ${name}`);
    if (result?.mutation?.unresolved !== (expectedComplete ? 0 : 1)) fail(`${label} unresolved result mismatch: ${name}`);
  }
}

function validateLifecycle(value, fail) {
  if (!value) {
    fail('lifecycle result missing');
    return;
  }
  const rows = Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'completed'));
  if (value.completed !== true) fail('lifecycle completion marker missing');
  if (Object.keys(rows).length !== lifecycleCases.length || lifecycleCases.some(name => !rows[name])) {
    fail('lifecycle result is partial');
  }
  for (const name of lifecycleCases) {
    const row = rows[name];
    if (!row) continue;
    if (row.leaderAlive !== false || row.descendantAlive !== false) fail(`lifecycle cleanup failed: ${name}`);
    if (!Array.isArray(row.remainingScratch) || row.remainingScratch.length) fail(`lifecycle scratch was not empty: ${name}`);
    let report;
    try { report = JSON.parse(row.stdout); } catch { report = null; }
    if (!report || report.complete !== false) fail(`lifecycle report incomplete: ${name}`);
    const signal = name.match(/^(SIGINT|SIGTERM)-/)?.[1];
    if (signal) {
      if (report.cancelled !== true || row.exit?.code !== (signal === 'SIGINT' ? 130 : 143)) {
        fail(`lifecycle cancellation verdict mismatch: ${name}`);
      }
    } else if (report.cancelled === true || row.exit?.code !== 2) {
      fail(`lifecycle failure verdict mismatch: ${name}`);
    }
  }
}

function validate({preflight, packed, npm, standalone, jestExpo, vitest, lifecycle, repeat}, parseErrors = {}, artifactDirectory = null, artifacts = {}) {
  const failures = Object.entries(parseErrors).map(([name, message]) => `${name}: invalid JSON (${message})`);
  const fail = message => failures.push(message);
  const retainedPackageBuild = artifactDirectory && artifacts.tarball?.file
    ? readArchiveBuild(join(artifactDirectory, artifacts.tarball.file)) : null;
  if (!preflight) fail('preflight result missing');
  else if (preflight.validation?.passed !== true) fail('preflight validation failed');
  if (!packed) fail('package result missing');
  else {
    if (!packed.tarballSha256 || !packed.binary || !packed.standalone?.sha256) fail('package hashes missing');
    if (packed.tarballSha256 !== packed.standalone?.sha256) fail('package npm and standalone hashes differ');
    if (artifactDirectory) {
      for (const name of ['seshat-linux-arm64.tgz', 'seshat-linux-arm64-standalone.tar.gz']) {
        if (!existsSync(join(artifactDirectory, name))) fail(`artifact missing: ${name}`);
      }
      if (!artifacts.tarball?.sha256) fail('npm tarball hash missing');
      if (packed.tarballSha256 && artifacts.tarball?.sha256 && artifacts.tarball.sha256 !== packed.tarballSha256) fail('npm tarball hash differs from package evidence');
      if (!artifacts.standalone?.sha256) fail('standalone archive hash missing');
      if (packed.standalone?.sha256 && artifacts.standalone?.sha256 && artifacts.standalone.sha256 !== packed.standalone.sha256) fail('standalone archive hash differs from package evidence');
      if (artifacts.tarball?.sha256 !== artifacts.standalone?.sha256) fail('npm and standalone artifact hashes differ');
    }
  }
  if (!repeat) fail('repeat pack result missing');
  else if (!repeatPassed(repeat, {
    sourceCommit: preflight?.provenance?.sourceCommit,
    expectedTarget: 'aarch64-unknown-linux-gnu', expectedPlatform: 'linux', expectedArch: 'arm64', expectedMachine: 'aarch64',
    inputMode: '--native-arm64', hostGlibc: preflight?.environment?.glibc, nodeVersion: preflight?.environment?.node?.version,
    packed, npm, standalone, artifacts, requireArtifacts: Boolean(artifactDirectory), retainedBuild: retainedPackageBuild,
  })) fail('repeat pack reproducibility proof failed');
  if (!npm) fail('npm result missing');
  else {
    if (Object.keys(npm.checks ?? {}).length !== 16) fail('npm proof did not retain 16 checks');
    if (npm.checks?.['installed-cli-regression']?.status !== 0) fail('npm installed CLI check failed');
    if (cliScenarios(npm) !== 43) fail('npm proof did not retain 43 CLI scenarios');
    if (packed && npm.build?.binarySha256 !== packed.binary) fail('npm binary hash differs from package metadata');
  }
  if (!standalone) fail('standalone result missing');
  else {
    for (const name of ['installed-cli', 'installed-parallel']) {
      if (standalone.checks?.[name]?.status !== 0) fail(`standalone ${name} check failed`);
    }
    if (standalone.cliScenarios !== 43) fail('standalone proof did not retain 43 CLI scenarios');
    if (Object.keys(standalone.parallelChecks ?? {}).length !== 11) fail('standalone proof did not retain 11 parallel controls');
    if (packed?.standalone?.sha256 !== standalone.archiveSha256) fail('standalone archive hash differs from package metadata');
    if (packed && standalone.build?.binarySha256 !== packed.binary) fail('standalone binary hash differs from package metadata');
  }
  validateRunner('Jest/Expo', jestExpo, runnerCases.jestExpo, packed, artifacts, fail);
  validateRunner('Vitest', vitest, runnerCases.vitest, packed, artifacts, fail);
  validateLifecycle(lifecycle, fail);
  return failures;
}

const selfCheckRunner = (cases, binary = 'binary', tarball = 'tarball') => ({
  version: 1,
  cli: {source: 'tarball', version: 'seshat 0.0.0 (candidate)', tarballSha256: tarball, binarySha256: binary},
  noConsumingRust: {
    probes: [{command: 'cargo', unavailable: true}, {command: 'rustc', unavailable: true}],
    environmentUnset: environmentNames,
  },
  checks: {requested: cases.length, completed: cases.length},
  originalsPreserved: true,
  runs: Object.fromEntries(cases.map(name => {
    const complete = name !== 'before-all';
    return [name, {
      execution: {status: complete ? 0 : 2},
      report: {complete, result: {complete, mutation: {unresolved: complete ? 0 : 1}}},
    }];
  })),
});

const selfCheckLifecycle = Object.fromEntries(lifecycleCases.map(name => {
  const signal = name.match(/^(SIGINT|SIGTERM)-/)?.[1];
  return [name, {
    exit: {code: signal ? (signal === 'SIGINT' ? 130 : 143) : 2},
    leaderAlive: false,
    descendantAlive: false,
    remainingScratch: [],
    stdout: JSON.stringify({complete: false, cancelled: Boolean(signal)}),
  }];
}));
selfCheckLifecycle.completed = true;

function selfCheckSummary() {
  const binaryHash = 'b'.repeat(64);
  const archiveHash = 'c'.repeat(64);
  const checks = Object.fromEntries(Array.from({length: 15}, (_, index) => [`check-${index}`, {status: 0}]));
  checks['installed-cli-regression'] = {status: 0, stdout: 'CLI passed: 43 scenarios plus legacy parity'};
  const base = {
    preflight: {validation: {passed: true}, provenance: {sourceCommit: 'a'.repeat(40)}, environment: {
      glibc: '2.35', node: {version: 'v24.20.0'},
    }},
    packed: {tarballSha256: archiveHash, binary: binaryHash, binaryBytes: 1, standalone: {sha256: archiveHash, bytes: 2}},
    npm: {build: {target: 'aarch64-unknown-linux-gnu', binarySha256: binaryHash, binaryBytes: 1}, checks},
    standalone: {
      archiveSha256: archiveHash, archiveBytes: 2, cliScenarios: 43,
      build: {target: 'aarch64-unknown-linux-gnu', binarySha256: binaryHash, binaryBytes: 1},
      checks: {'installed-cli': {status: 0}, 'installed-parallel': {status: 0}},
      parallelChecks: Object.fromEntries(Array.from({length: 11}, (_, index) => [`case-${index}`, {}])),
    },
    jestExpo: selfCheckRunner(runnerCases.jestExpo, binaryHash, archiveHash),
    vitest: selfCheckRunner(runnerCases.vitest, binaryHash, archiveHash),
    lifecycle: selfCheckLifecycle,
  };
  const repeat = {
    schemaVersion: 1, sourceCommit: 'a'.repeat(40),
    host: {platform: 'linux', arch: 'arm64', uname: {system: 'Linux', release: '6.8.0-test', machine: 'aarch64'}, glibc: '2.35'},
    toolchain: {node: 'v24.20.0', npm: '11.0.0', rustc: 'rustc 1.98.1', cargo: 'cargo 1.98.1'},
    input: {mode: '--native-arm64', archives: []},
    runs: Array.from({length: 2}, () => ({
      binary: {sha256: binaryHash, bytes: 1}, build: {sha256: '1'.repeat(64), bytes: 3},
      npmArchive: {sha256: archiveHash, bytes: 2}, standaloneArchive: {sha256: archiveHash, bytes: 2}, files: packageFiles,
    })),
    comparisons: Object.fromEntries(repeatArtifacts.map(name => [name, {hash: true, bytes: true, passed: true}])),
    validation: {passed: true, reason: 'two clean packer invocations produced identical native binary and archive bytes'},
  };
  const artifacts = {tarball: {sha256: archiveHash, bytes: 2}, standalone: {sha256: archiveHash, bytes: 2}};
  assert.deepEqual(validate({...base, repeat}, {}, null, artifacts), []);
  assert.match(validate({...base, npm: null}).join('\n'), /npm result missing/);
  assert.match(validate({...base, vitest: null}).join('\n'), /Vitest result missing/);
  const partial = structuredClone(base);
  delete partial.jestExpo.runs['before-all'];
  assert.match(validate(partial).join('\n'), /Jest\/Expo result is partial/);
  const lifecycleFailure = structuredClone(base);
  lifecycleFailure.lifecycle.timeout.remainingScratch = ['left'];
  assert.match(validate(lifecycleFailure).join('\n'), /lifecycle scratch was not empty/);
  const partialLastCase = structuredClone(base);
  delete partialLastCase.lifecycle.completed;
  assert.match(validate(partialLastCase).join('\n'), /lifecycle completion marker missing/);
  const failed = structuredClone(base);
  failed.standalone.checks['installed-parallel'].status = 1;
  assert.match(validate(failed).join('\n'), /standalone installed-parallel check failed/);
  assert.match(validate({...base, repeat: null}).join('\n'), /repeat pack result missing/);
  assert.match(validate({...base, repeat: {...repeat, runs: [repeat.runs[0]]}}).join('\n'), /repeat pack reproducibility proof failed/);
  assert.match(validate({...base, repeat: {...repeat, runs: undefined}}).join('\n'), /repeat pack reproducibility proof failed/);
  assert.match(validate({...base, repeat: {...repeat, sourceCommit: '0'.repeat(40)}}).join('\n'), /repeat pack reproducibility proof failed/);
  assert.match(validate({...base, repeat, packed: {...base.packed, binary: '0'.repeat(64)}}).join('\n'), /repeat pack reproducibility proof failed/);
  console.log('Linux ARM64 summary self-check passed');
}

if (selfCheck) {
  selfCheckSummary();
} else {
  const directory = resolve(process.argv[2]);
  const parseErrors = {};
  const read = name => {
    const path = join(directory, name);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      parseErrors[name] = error.message;
      return null;
    }
  };
  const preflight = read('preflight.json');
  const packed = read('package-result.json');
  const npm = read('npm-package.json');
  const standalone = read('standalone.json');
  const jestExpo = read('jest-expo-check.json');
  const vitest = read('vitest-check.json');
  const lifecycle = read('lifecycle.json');
  const repeat = read('repeat-pack.json');
  const artifacts = {};
  for (const [key, name] of [['tarball', 'seshat-linux-arm64.tgz'], ['standalone', 'seshat-linux-arm64-standalone.tar.gz']]) {
    const path = join(directory, name);
    if (existsSync(path) && statSync(path).isFile()) artifacts[key] = {file: name, sha256: hash(path), bytes: statSync(path).size};
  }
  const retainedBuild = artifacts.tarball?.file
    ? readArchiveBuild(join(directory, artifacts.tarball.file)) : null;
  const failures = validate({preflight, packed, npm, standalone, jestExpo, vitest, lifecycle, repeat}, parseErrors, directory, artifacts);
  const portablePackage = packed && artifacts.tarball && artifacts.standalone && {...packed,
    tarball: 'seshat-linux-arm64.tgz',
    proofBinary: null,
    tarballSha256: artifacts.tarball.sha256,
    standalone: {...packed.standalone, path: 'seshat-linux-arm64-standalone.tar.gz', sha256: artifacts.standalone.sha256, bytes: artifacts.standalone.bytes},
  };
  const summary = {
    schemaVersion: 1,
    kind: 'seshat-linux-arm64-package-proof',
    sourceCommit: process.env.GITHUB_SHA ?? preflight?.provenance?.sourceCommit ?? null,
    runner: 'ubuntu-22.04-arm',
    userspace: 'Ubuntu 22.04 / glibc 2.35',
    node: '24.20.0',
    rust: '1.98.1',
    architecture: 'aarch64',
    preflight: preflight ? {environment: preflight.environment, validation: preflight.validation, provenance: preflight.provenance} : null,
    artifacts: packed ? {
      npmTarball: artifacts.tarball ?? null,
      standalone: artifacts.standalone ?? null,
      binary: {sha256: packed.binary, bytes: packed.binaryBytes},
    } : null,
    npm: npm ? {build: npm.build, tarballSha256: artifacts.tarball?.sha256 ?? null, cliScenarios: cliScenarios(npm), checks: statuses(npm)} : null,
    standalone: standalone ? {build: standalone.build, archiveSha256: standalone.archiveSha256, archiveBytes: standalone.archiveBytes, cliScenarios: standalone.cliScenarios, checks: statuses(standalone)} : null,
    runners: {
      jestExpo: jestExpo ? {environment: jestExpo.environment, cli: jestExpo.cli, dependencies: jestExpo.dependencies, noConsumingRust: jestExpo.noConsumingRust, checks: jestExpo.checks, originalsPreserved: jestExpo.originalsPreserved} : null,
      vitest: vitest ? {environment: vitest.environment, cli: vitest.cli, dependencies: vitest.dependencies, noConsumingRust: vitest.noConsumingRust, checks: vitest.checks, originalsPreserved: vitest.originalsPreserved} : null,
      lifecycle: lifecycle ? {completed: lifecycle.completed === true, cases: Object.keys(lifecycle).filter(name => name !== 'completed'), cleanup: Object.fromEntries(Object.entries(lifecycle).filter(([name]) => name !== 'completed').map(([name, row]) => [name, {exit: row.exit, leaderAlive: row.leaderAlive, descendantAlive: row.descendantAlive, remainingScratch: row.remainingScratch}]))} : null,
    },
    repeatPack: repeat ? {
      sourceCommit: repeat.sourceCommit,
      host: repeat.host,
      toolchain: repeat.toolchain,
      input: repeat.input,
      runs: repeat.runs,
      comparisons: repeat.comparisons,
      validation: repeat.validation,
    } : null,
    validation: {package: Boolean(packed && portablePackage), npm: Boolean(npm), standalone: Boolean(standalone), jestExpo: Boolean(jestExpo), vitest: Boolean(vitest), lifecycle: Boolean(lifecycle), repeatPack: Boolean(repeat && repeatPassed(repeat, {
      sourceCommit: preflight?.provenance?.sourceCommit,
      expectedTarget: 'aarch64-unknown-linux-gnu', expectedPlatform: 'linux', expectedArch: 'arm64', expectedMachine: 'aarch64',
      inputMode: '--native-arm64', hostGlibc: preflight?.environment?.glibc, nodeVersion: preflight?.environment?.node?.version,
      packed, npm, standalone, artifacts, requireArtifacts: true, retainedBuild,
    })), passed: failures.length === 0, failures},
    limits: 'Native Ubuntu 22.04 ARM64 proof on the runner kernel. It does not establish a historical minimum kernel or support for other Linux userspaces, macOS or Windows.',
  };
  writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  if (portablePackage) writeFileSync(join(directory, 'package-result.json'), JSON.stringify(portablePackage, null, 2) + '\n');
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Wrote ${join(directory, 'summary.json')}`);
  }
}
