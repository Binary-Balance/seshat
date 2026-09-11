import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

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
const sha256 = value => createHash('sha256').update(value).digest('hex');

function validLifecycle(value) {
  if (!value || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...lifecycleCases].sort())) return false;
  return lifecycleCases.every(name => {
    const result = value[name];
    if (!result || typeof result.ms !== 'number' || !result.exit || !Array.isArray(result.remainingScratch)) return false;
    const expectedCode = name.startsWith('SIGINT') ? 130 : name.startsWith('SIGTERM') ? 143 : 2;
    return result.exit.code === expectedCode && result.exit.signal === null &&
      result.leaderAlive === false && result.descendantAlive === false && result.remainingScratch.length === 0;
  });
}

function validate({preflight, packed, build, npm, standalone, lifecycle}, parseErrors = {}, artifactDirectory = null) {
  const failures = Object.entries(parseErrors).map(([name, message]) => `${name}: invalid JSON (${message})`);
  const fail = message => failures.push(message);
  if (!preflight) fail('preflight result missing');
  else if (preflight.validation?.passed !== true) fail('preflight validation failed');
  if (!packed) fail('package result missing');
  else {
    if (!packed.tarballSha256 || !packed.binary || !packed.standalone?.sha256) fail('package hashes missing');
    if (artifactDirectory) {
      const cpu = preflight?.candidate?.cpu;
      for (const name of [`seshat-macos-${cpu}.tgz`, `seshat-macos-${cpu}-standalone.tar.gz`]) {
        if (!existsSync(join(artifactDirectory, name))) fail(`artifact missing: ${name}`);
      }
    }
  }
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
  if (!lifecycle) fail('lifecycle result missing');
  else {
    if (!validLifecycle(lifecycle)) fail('lifecycle proof did not retain all 11 successful cases');
    if (artifactDirectory && !existsSync(join(artifactDirectory, 'lifecycle.log'))) fail('artifact missing: lifecycle.log');
  }
  return failures;
}

function selfCheckSummary() {
  const checks = Object.fromEntries(Array.from({length: 13}, (_, index) => [`check-${index}`, {status: 0}]));
  checks['installed-cli-regression'] = {status: 0, stdout: 'CLI passed: 43 scenarios plus legacy parity'};
  const base = {
    preflight: {candidate: {cpu: 'arm64'}, validation: {passed: true}},
    packed: {tarballSha256: 'tarball', binary: 'binary', standalone: {sha256: 'standalone'}},
    build: {target: 'aarch64-apple-darwin', binarySha256: 'binary'},
    npm: {build: {target: 'aarch64-apple-darwin', binarySha256: 'binary'}, checks},
    standalone: {
      archiveSha256: 'standalone', cliScenarios: 43, build: {target: 'aarch64-apple-darwin', binarySha256: 'binary'},
      checks: {'installed-cli': {status: 0}, 'installed-parallel': {status: 0}},
      parallelChecks: Object.fromEntries(Array.from({length: 11}, (_, index) => [`case-${index}`, {}])),
    },
    lifecycle: Object.fromEntries(lifecycleCases.map(name => [name, {
      ms: 1, exit: {code: name.startsWith('SIGINT') ? 130 : name.startsWith('SIGTERM') ? 143 : 2, signal: null},
      leaderAlive: false, descendantAlive: false, remainingScratch: [],
    }])),
  };
  assert.deepEqual(validate(base), []);
  assert.match(validate({...base, npm: null}).join('\n'), /npm result missing/);
  const failed = structuredClone(base);
  failed.standalone.checks['installed-parallel'].status = 1;
  assert.match(validate(failed).join('\n'), /standalone installed-parallel check failed/);
  const missingLifecycle = structuredClone(base);
  delete missingLifecycle.lifecycle['leader-exit'];
  assert.match(validate(missingLifecycle).join('\n'), /lifecycle proof/);
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
  const build = read('BUILD.json');
  const lifecycle = read('lifecycle.json');
  const failures = validate({preflight, packed, build, npm, standalone, lifecycle}, parseErrors, directory);
  const cpu = preflight?.candidate?.cpu ?? 'unknown';
  const buildPath = join(directory, 'BUILD.json');
  const buildArtifact = build && existsSync(buildPath) ? {
    file: 'BUILD.json', sha256: sha256(readFileSync(buildPath)), bytes: statSync(buildPath).size,
  } : null;
  const portablePackage = packed && {...packed,
    tarball: `seshat-macos-${cpu}.tgz`,
    proofBinary: null,
    standalone: packed.standalone && {...packed.standalone, path: `seshat-macos-${cpu}-standalone.tar.gz`},
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
      npmTarball: {file: `seshat-macos-${cpu}.tgz`, sha256: packed.tarballSha256, bytes: packed.packedBytes},
      standalone: {file: `seshat-macos-${cpu}-standalone.tar.gz`, sha256: packed.standalone?.sha256, bytes: packed.standalone?.bytes},
      binary: {sha256: packed.binary, bytes: packed.binaryBytes},
    } : null,
    npm: npm ? {build: npm.build, tarballSha256: packed?.tarballSha256 ?? null, cliScenarios: cliScenarios(npm), checks: statuses(npm)} : null,
    standalone: standalone ? {build: standalone.build, archiveSha256: standalone.archiveSha256, archiveBytes: standalone.archiveBytes, cliScenarios: standalone.cliScenarios, checks: statuses(standalone)} : null,
    lifecycle: lifecycle ? {cases: Object.keys(lifecycle).length, passed: validLifecycle(lifecycle)} : null,
    validation: {package: Boolean(packed), npm: Boolean(npm), standalone: Boolean(standalone), passed: failures.length === 0, failures},
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
