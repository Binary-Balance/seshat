// Build the portable metadata file retained by the native ARM64 workflow.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

const selfCheck = process.argv[2] === '--self-check';
assert.ok(selfCheck || process.argv.length === 3,
  'usage: node benchmarks/proofs/linux-arm64-summary.mjs <artifact directory> | --self-check');

const cliScenarios = value => Number(value?.checks?.['installed-cli-regression']?.stdout?.match(/CLI passed: (\d+) scenarios/)?.[1] ?? NaN) || null;
const statuses = value => Object.fromEntries(Object.entries(value?.checks ?? {}).map(([name, check]) => [name, check.status]));

function validate({preflight, packed, npm, standalone}, parseErrors = {}, artifactDirectory = null) {
  const failures = Object.entries(parseErrors).map(([name, message]) => `${name}: invalid JSON (${message})`);
  const fail = message => failures.push(message);
  if (!preflight) fail('preflight result missing');
  else if (preflight.validation?.passed !== true) fail('preflight validation failed');
  if (!packed) fail('package result missing');
  else {
    if (!packed.tarballSha256 || !packed.binary || !packed.standalone?.sha256) fail('package hashes missing');
    if (artifactDirectory) {
      for (const name of ['seshat-linux-arm64.tgz', 'seshat-linux-arm64-standalone.tar.gz']) {
        if (!existsSync(join(artifactDirectory, name))) fail(`artifact missing: ${name}`);
      }
    }
  }
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
  return failures;
}

function selfCheckSummary() {
  const checks = Object.fromEntries(Array.from({length: 15}, (_, index) => [`check-${index}`, {status: 0}]));
  checks['installed-cli-regression'] = {status: 0, stdout: 'CLI passed: 43 scenarios plus legacy parity'};
  const base = {
    preflight: {validation: {passed: true}},
    packed: {tarballSha256: 'tarball', binary: 'binary', standalone: {sha256: 'standalone'}},
    npm: {build: {binarySha256: 'binary'}, checks},
    standalone: {
      archiveSha256: 'standalone', cliScenarios: 43, build: {binarySha256: 'binary'},
      checks: {'installed-cli': {status: 0}, 'installed-parallel': {status: 0}},
      parallelChecks: Object.fromEntries(Array.from({length: 11}, (_, index) => [`case-${index}`, {}])),
    },
  };
  assert.deepEqual(validate(base), []);
  assert.match(validate({...base, npm: null}).join('\n'), /npm result missing/);
  const failed = structuredClone(base);
  failed.standalone.checks['installed-parallel'].status = 1;
  assert.match(validate(failed).join('\n'), /standalone installed-parallel check failed/);
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
  const failures = validate({preflight, packed, npm, standalone}, parseErrors, directory);
  const portablePackage = packed && {...packed,
    tarball: 'seshat-linux-arm64.tgz',
    proofBinary: null,
    standalone: packed.standalone && {...packed.standalone, path: 'seshat-linux-arm64-standalone.tar.gz'},
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
      npmTarball: {file: 'seshat-linux-arm64.tgz', sha256: packed.tarballSha256, bytes: packed.packedBytes},
      standalone: {file: 'seshat-linux-arm64-standalone.tar.gz', sha256: packed.standalone?.sha256, bytes: packed.standalone?.bytes},
      binary: {sha256: packed.binary, bytes: packed.binaryBytes},
    } : null,
    npm: npm ? {build: npm.build, tarballSha256: packed?.tarballSha256 ?? null, cliScenarios: cliScenarios(npm), checks: statuses(npm)} : null,
    standalone: standalone ? {build: standalone.build, archiveSha256: standalone.archiveSha256, archiveBytes: standalone.archiveBytes, cliScenarios: standalone.cliScenarios, checks: statuses(standalone)} : null,
    validation: {package: Boolean(packed), npm: Boolean(npm), standalone: Boolean(standalone), passed: failures.length === 0, failures},
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
