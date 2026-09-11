import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {packageFiles, readArchiveBuild, repeatArtifacts, repeatPassed} from './repeat-proof.mjs';

const selfCheck = process.argv[2] === '--self-check';
assert.ok(selfCheck || process.argv.length === 3,
  'usage: node benchmarks/proofs/macos-package-summary.mjs <artifact directory> | --self-check');

const cliScenarios = value => Number(value?.checks?.['installed-cli-regression']?.stdout?.match(/CLI passed: (\d+) scenarios/)?.[1] ?? NaN) || null;
const statuses = value => Object.fromEntries(Object.entries(value?.checks ?? {}).map(([name, check]) => [name, check.status]));
const lifecycleCases = [
  'SIGINT-typecheck', 'SIGINT-baseline', 'SIGINT-coverage', 'SIGINT-mutation',
  'SIGTERM-typecheck', 'SIGTERM-baseline', 'SIGTERM-coverage', 'SIGTERM-mutation',
  'timeout', 'overflow', 'leader-exit',
];
const runnerCases = {
  jestExpo: ['normal-1', 'assertion-kill', 'survivor', 'before-all'],
  vitest: ['stack', 'assertion', 'survived', 'before-all'],
};
const environmentNames = ['CARGO_HOME', 'RUSTUP_HOME', 'CARGO_TARGET_DIR', 'NODE_OPTIONS', 'SESHAT_MUTANT_ID'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hashFile = path => sha256(readFileSync(path));

function validLifecycle(value) {
  if (!value || value.completed !== true) return false;
  const rows = Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'completed'));
  if (JSON.stringify(Object.keys(rows).sort()) !== JSON.stringify([...lifecycleCases].sort())) return false;
  return lifecycleCases.every(name => {
    const result = rows[name];
    if (!result || typeof result.ms !== 'number' || !result.exit || !Array.isArray(result.remainingScratch)) return false;
    const expectedCode = name.startsWith('SIGINT') ? 130 : name.startsWith('SIGTERM') ? 143 : 2;
    return result.exit.code === expectedCode && result.exit.signal === null &&
      result.leaderAlive === false && result.descendantAlive === false && result.remainingScratch.length === 0;
  });
}

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

function validate({preflight, packed, build, npm, standalone, jestExpo, vitest, lifecycle, repeat}, parseErrors = {}, artifactDirectory = null, artifacts = {}) {
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
      const cpu = preflight?.candidate?.cpu;
      for (const name of [`seshat-macos-${cpu}.tgz`, `seshat-macos-${cpu}-standalone.tar.gz`]) {
        if (!existsSync(join(artifactDirectory, name))) fail(`artifact missing: ${name}`);
      }
      if (!artifacts.tarball?.sha256) fail('npm tarball hash missing');
      if (packed.tarballSha256 && artifacts.tarball?.sha256 && artifacts.tarball.sha256 !== packed.tarballSha256) {
        fail('npm tarball hash differs from package evidence');
      }
      if (!artifacts.standalone?.sha256) fail('standalone archive hash missing');
      if (packed.standalone?.sha256 && artifacts.standalone?.sha256 && artifacts.standalone.sha256 !== packed.standalone.sha256) {
        fail('standalone archive hash differs from package evidence');
      }
      if (artifacts.tarball?.sha256 !== artifacts.standalone?.sha256) fail('npm and standalone artifact hashes differ');
    }
  }
  if (!repeat) fail('repeat pack result missing');
  else if (!repeatPassed(repeat, {
    sourceCommit: preflight?.provenance?.sourceCommit,
    expectedTarget: preflight?.candidate?.target,
    expectedPlatform: 'darwin', expectedArch: preflight?.candidate?.cpu,
    expectedMachine: preflight?.candidate?.cpu === 'arm64' ? 'arm64' : 'x86_64', inputMode: '--native-macos',
    nodeVersion: preflight?.environment?.node?.version,
    packed, build, npm, standalone, artifacts, requireArtifacts: Boolean(artifactDirectory), retainedBuild: retainedPackageBuild,
  })) fail('repeat pack reproducibility proof failed');
  if (!build) fail('BUILD.json missing');
  else {
    if (!build.binarySha256) fail('BUILD.json binary hash missing');
    if (packed && build.binarySha256 !== packed.binary) fail('BUILD.json binary hash differs from package metadata');
    if (!/^[\w-]+-apple-darwin$/.test(build.target ?? '')) fail('BUILD.json target is not macOS');
    if (artifactDirectory && !existsSync(join(artifactDirectory, 'BUILD.json'))) fail('artifact missing: BUILD.json');
  }
  if (!npm) fail('npm result missing');
  else {
    if (Object.keys(npm.checks ?? {}).length !== 14) fail('npm proof did not retain 14 macOS checks');
    if (npm.checks?.['installed-cli-regression']?.status !== 0) fail('npm installed CLI check failed');
    if (cliScenarios(npm) !== 43) fail('npm proof did not retain 43 CLI scenarios');
    if (packed && npm.build?.binarySha256 !== packed.binary) fail('npm binary hash differs from package metadata');
    if (!/^\w+-apple-darwin$/.test(npm.build?.target ?? '')) fail('npm build target is not macOS');
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
    if (!/^\w+-apple-darwin$/.test(standalone.build?.target ?? '')) fail('standalone build target is not macOS');
  }
  validateRunner('Jest/Expo', jestExpo, runnerCases.jestExpo, packed, artifacts, fail);
  validateRunner('Vitest', vitest, runnerCases.vitest, packed, artifacts, fail);
  if (!lifecycle) fail('lifecycle result missing');
  else {
    if (!validLifecycle(lifecycle)) fail('lifecycle proof did not retain all 11 successful cases');
    if (artifactDirectory && !existsSync(join(artifactDirectory, 'lifecycle.log'))) fail('artifact missing: lifecycle.log');
  }
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

function selfCheckSummary() {
  const binaryHash = 'b'.repeat(64);
  const archiveHash = 'c'.repeat(64);
  const checks = Object.fromEntries(Array.from({length: 13}, (_, index) => [`check-${index}`, {status: 0}]));
  checks['installed-cli-regression'] = {status: 0, stdout: 'CLI passed: 43 scenarios plus legacy parity'};
  const base = {
    preflight: {candidate: {cpu: 'arm64', target: 'aarch64-apple-darwin'}, validation: {passed: true}, provenance: {sourceCommit: 'a'.repeat(40)}, environment: {
      node: {version: 'v24.20.0'},
    }},
    packed: {tarballSha256: archiveHash, binary: binaryHash, binaryBytes: 1, standalone: {sha256: archiveHash, bytes: 2}},
    build: {target: 'aarch64-apple-darwin', binarySha256: binaryHash, binaryBytes: 1},
    npm: {build: {target: 'aarch64-apple-darwin', binarySha256: binaryHash, binaryBytes: 1}, checks},
    standalone: {
      archiveSha256: archiveHash, archiveBytes: 2, cliScenarios: 43,
      build: {target: 'aarch64-apple-darwin', binarySha256: binaryHash, binaryBytes: 1},
      checks: {'installed-cli': {status: 0}, 'installed-parallel': {status: 0}},
      parallelChecks: Object.fromEntries(Array.from({length: 11}, (_, index) => [`case-${index}`, {}])),
    },
    jestExpo: selfCheckRunner(runnerCases.jestExpo, binaryHash, archiveHash),
    vitest: selfCheckRunner(runnerCases.vitest, binaryHash, archiveHash),
    lifecycle: {...Object.fromEntries(lifecycleCases.map(name => [name, {
      ms: 1, exit: {code: name.startsWith('SIGINT') ? 130 : name.startsWith('SIGTERM') ? 143 : 2, signal: null},
      leaderAlive: false, descendantAlive: false, remainingScratch: [],
    }])), completed: true},
  };
  const repeat = {
    schemaVersion: 1, sourceCommit: 'a'.repeat(40),
    host: {platform: 'darwin', arch: 'arm64', uname: {system: 'Darwin', release: '24.6.0', machine: 'arm64'}, glibc: null},
    toolchain: {node: 'v24.20.0', npm: '11.0.0', rustc: 'rustc 1.98.1', cargo: 'cargo 1.98.1'},
    input: {mode: '--native-macos', archives: []},
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
  const failed = structuredClone(base);
  failed.standalone.checks['installed-parallel'].status = 1;
  assert.match(validate(failed).join('\n'), /standalone installed-parallel check failed/);
  const missingLifecycle = structuredClone(base);
  delete missingLifecycle.lifecycle['leader-exit'];
  assert.match(validate(missingLifecycle).join('\n'), /lifecycle proof/);
  const partialLastCase = structuredClone(base);
  delete partialLastCase.lifecycle.completed;
  assert.match(validate(partialLastCase).join('\n'), /lifecycle proof/);
  const wrongArchive = structuredClone(base);
  wrongArchive.jestExpo.cli.tarballSha256 = 'changed';
  assert.match(validate(wrongArchive, {}, null, artifacts).join('\n'), /Jest\/Expo tarball hash differs/);
  assert.match(validate({...base, repeat: null}).join('\n'), /repeat pack result missing/);
  assert.match(validate({...base, repeat: {...repeat, runs: [repeat.runs[0]]}}).join('\n'), /repeat pack reproducibility proof failed/);
  assert.match(validate({...base, repeat: {...repeat, runs: undefined}}).join('\n'), /repeat pack reproducibility proof failed/);
  assert.match(validate({...base, repeat: {...repeat, sourceCommit: '0'.repeat(40)}}).join('\n'), /repeat pack reproducibility proof failed/);
  assert.match(validate({...base, repeat, packed: {...base.packed, binary: '0'.repeat(64)}}).join('\n'), /repeat pack reproducibility proof failed/);
  assert.match(validate({...base, repeat}, {}, null, {tarball: {sha256: '0'.repeat(64), bytes: 2}, standalone: {sha256: archiveHash, bytes: 2}}).join('\n'), /repeat pack reproducibility proof failed/);
  console.log('macOS package summary self-check passed');
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
  const build = read('BUILD.json');
  const lifecycle = read('lifecycle.json');
  const repeat = read('repeat-pack.json');
  const artifacts = {};
  for (const [key, name] of [['tarball', `seshat-macos-${preflight?.candidate?.cpu ?? 'unknown'}.tgz`], ['standalone', `seshat-macos-${preflight?.candidate?.cpu ?? 'unknown'}-standalone.tar.gz`]]) {
    const path = join(directory, name);
    if (existsSync(path) && statSync(path).isFile()) artifacts[key] = {file: name, sha256: hashFile(path), bytes: statSync(path).size};
  }
  const retainedBuild = artifacts.tarball?.file
    ? readArchiveBuild(join(directory, artifacts.tarball.file)) : null;
  const failures = validate({preflight, packed, build, npm, standalone, jestExpo, vitest, lifecycle, repeat}, parseErrors, directory, artifacts);
  const cpu = preflight?.candidate?.cpu ?? 'unknown';
  const buildPath = join(directory, 'BUILD.json');
  const buildArtifact = build && existsSync(buildPath) ? {
    file: 'BUILD.json', sha256: sha256(readFileSync(buildPath)), bytes: statSync(buildPath).size,
  } : null;
  const portablePackage = packed && artifacts.tarball && artifacts.standalone && {...packed,
    tarball: `seshat-macos-${cpu}.tgz`,
    proofBinary: null,
    tarballSha256: artifacts.tarball.sha256,
    standalone: {...packed.standalone, path: `seshat-macos-${cpu}-standalone.tar.gz`, sha256: artifacts.standalone.sha256, bytes: artifacts.standalone.bytes},
  };
  const summary = {
    schemaVersion: 1,
    kind: `seshat-macos-${cpu}-package-proof`,
    sourceCommit: process.env.GITHUB_SHA ?? preflight?.provenance?.sourceCommit ?? null,
    testedCommit: process.env.GITHUB_SHA ?? preflight?.provenance?.sourceCommit ?? null,
    pullRequestHead: preflight?.provenance?.pullRequestHead ?? null,
    runner: preflight?.candidate?.runner ?? null,
    os: preflight?.candidate?.os ?? 'macOS 15',
    osVersion: preflight?.environment?.os?.productVersion ?? null,
    architecture: cpu,
    node: '24.20.0',
    rust: '1.98.1',
    deploymentTarget: preflight?.environment?.deploymentTarget ?? null,
    sdk: preflight?.environment?.toolchain?.sdk?.version ?? null,
    clang: preflight?.environment?.toolchain?.clang?.version ?? null,
    preflight: preflight ? {environment: preflight.environment, validation: preflight.validation, provenance: preflight.provenance} : null,
    artifacts: packed ? {
      build: buildArtifact,
      npmTarball: artifacts.tarball ?? null,
      standalone: artifacts.standalone ?? null,
      binary: {sha256: packed.binary, bytes: packed.binaryBytes},
    } : null,
    npm: npm ? {build: npm.build, tarballSha256: packed?.tarballSha256 ?? null, cliScenarios: cliScenarios(npm), checks: statuses(npm)} : null,
    standalone: standalone ? {build: standalone.build, archiveSha256: standalone.archiveSha256, archiveBytes: standalone.archiveBytes, cliScenarios: standalone.cliScenarios, checks: statuses(standalone)} : null,
    runners: {
      jestExpo: jestExpo ? {environment: jestExpo.environment, cli: jestExpo.cli, dependencies: jestExpo.dependencies, noConsumingRust: jestExpo.noConsumingRust, checks: jestExpo.checks, originalsPreserved: jestExpo.originalsPreserved} : null,
      vitest: vitest ? {environment: vitest.environment, cli: vitest.cli, dependencies: vitest.dependencies, noConsumingRust: vitest.noConsumingRust, checks: vitest.checks, originalsPreserved: vitest.originalsPreserved} : null,
    },
    lifecycle: lifecycle ? {cases: Object.keys(lifecycle).filter(name => name !== 'completed').length, completed: lifecycle.completed === true, passed: validLifecycle(lifecycle)} : null,
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
      expectedTarget: preflight?.candidate?.target,
      expectedPlatform: 'darwin', expectedArch: preflight?.candidate?.cpu,
      expectedMachine: preflight?.candidate?.cpu === 'arm64' ? 'arm64' : 'x86_64', inputMode: '--native-macos',
      nodeVersion: preflight?.environment?.node?.version,
      packed, build, npm, standalone, artifacts, requireArtifacts: true, retainedBuild,
    })), passed: failures.length === 0, failures},
    limits: 'Native macOS 15 proof on the selected GitHub-hosted CPU runner. It does not establish support for older macOS versions, Rosetta execution, the other CPU architecture, signing, notarization or public release distribution.',
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
