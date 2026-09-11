// Build the portable metadata file retained by the native ARM64 workflow.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

assert.equal(process.argv.length, 3, 'usage: node benchmarks/proofs/linux-arm64-summary.mjs <artifact directory>');
const directory = resolve(process.argv[2]);
const read = name => existsSync(join(directory, name)) ? JSON.parse(readFileSync(join(directory, name), 'utf8')) : null;
const statuses = value => Object.fromEntries(Object.entries(value?.checks ?? {}).map(([name, check]) => [name, check.status]));
const preflight = read('preflight.json');
const packed = read('package-result.json');
const npm = read('npm-package.json');
const standalone = read('standalone.json');
const cliScenarios = value => Number(value?.checks?.['installed-cli-regression']?.stdout?.match(/CLI passed: (\d+) scenarios/)?.[1] ?? NaN) || null;
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
  validation: {package: Boolean(packed), npm: Boolean(npm), standalone: Boolean(standalone)},
  limits: 'Native Ubuntu 22.04 ARM64 proof on the runner kernel. It does not establish a historical minimum kernel or support for other Linux userspaces, macOS or Windows.',
};
writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
if (portablePackage) writeFileSync(join(directory, 'package-result.json'), JSON.stringify(portablePackage, null, 2) + '\n');
console.log(`Wrote ${join(directory, 'summary.json')}`);
