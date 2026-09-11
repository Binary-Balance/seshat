import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

export const packageFiles = ['BUILD.json', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.txt', 'bin/seshat', 'package.json'];
export const repeatArtifacts = ['binary', 'build', 'npmArchive', 'standaloneArchive'];
const isHash = value => typeof value === 'string' && /^[\da-f]{64}$/.test(value);
const isCommit = value => typeof value === 'string' && /^(?!0{40})[\da-f]{40}$/.test(value);
const isText = value => typeof value === 'string' && value.trim().length > 0;
const isEvidence = value => isHash(value?.sha256) && Number.isInteger(value?.bytes) && value.bytes > 0;
const sameEvidence = (left, right) => isEvidence(left) && isEvidence(right) &&
  left.sha256 === right.sha256 && left.bytes === right.bytes;
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function readArchiveBuild(path) {
  try {
    const tar = gunzipSync(readFileSync(path));
    for (let offset = 0; offset + 512 <= tar.length;) {
      const name = tar.subarray(offset, offset + 100).toString().replace(/\0.*$/, '');
      const size = Number.parseInt(tar.subarray(offset + 124, offset + 136).toString().replace(/\0.*$/, '').trim() || '0', 8);
      if (name === 'package/BUILD.json') {
        const bytes = tar.subarray(offset + 512, offset + 512 + size);
        return {value: JSON.parse(bytes), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length};
      }
      offset += 512 + Math.ceil(size / 512) * 512;
    }
  } catch {
    // A malformed or non-gzip retained package cannot satisfy the proof.
  }
  return null;
}

export function repeatPassed(value, {
  sourceCommit, expectedTarget, expectedPlatform, expectedArch, expectedMachine, inputMode,
  hostGlibc, expectedToolchain, packed, build, npm, standalone, artifacts, requireArtifacts, retainedBuild,
} = {}) {
  if (!value || value.schemaVersion !== 1 || value.validation?.passed !== true ||
      typeof value.validation.reason !== 'string' || !value.validation.reason) return false;
  if (!isCommit(sourceCommit) || !isCommit(value.sourceCommit) || value.sourceCommit !== sourceCommit ||
      !isText(expectedTarget) || !['linux', 'darwin'].includes(expectedPlatform) ||
      !isText(expectedArch) || !isText(expectedMachine) || !isText(inputMode) ||
      expectedPlatform === 'linux' && !isText(hostGlibc) ||
      expectedPlatform === 'darwin' && hostGlibc !== undefined && hostGlibc !== null ||
      !expectedToolchain || !['node', 'npm', 'rustc', 'cargo'].every(name => isText(expectedToolchain[name]))) return false;
  const host = value.host;
  if (!host || host.platform !== expectedPlatform || host.arch !== expectedArch || !Object.hasOwn(host, 'glibc') ||
      expectedPlatform === 'linux' && host.glibc !== hostGlibc ||
      expectedPlatform === 'darwin' && host.glibc !== null ||
      host.uname?.system !== (expectedPlatform === 'linux' ? 'Linux' : 'Darwin') ||
      host.uname?.machine !== expectedMachine || !isText(host.uname.release)) return false;
  const toolchain = value.toolchain;
  if (!toolchain || !['node', 'npm', 'rustc', 'cargo'].every(name =>
    isText(toolchain[name]) && toolchain[name] === expectedToolchain[name])) return false;
  const input = value.input;
  if (!input || input.mode !== inputMode || !Array.isArray(input.archives) ||
      input.archives.some(archive => typeof archive?.file !== 'string' || !isHash(archive.sha256))) return false;
  if (inputMode === 'debian-x64' && (input.archives.length !== 3 ||
      !sameJson(input.archives.map(archive => archive.file), ['libc6.deb', 'libc6-dev.deb', 'libgcc-s1.deb']))) return false;
  if (inputMode !== 'debian-x64' && input.archives.length !== 0) return false;
  const runs = value.runs;
  if (!Array.isArray(runs) || runs.length !== 2 || !runs.every(run =>
    run && repeatArtifacts.every(name => isEvidence(run[name])) && Array.isArray(run.files) &&
    sameJson([...run.files].sort(), packageFiles))) return false;
  const [first, second] = runs;
  if (!repeatArtifacts.every(name => sameEvidence(first[name], second[name])) ||
      !repeatArtifacts.every(name => value.comparisons?.[name]?.passed === true &&
        value.comparisons[name].hash === true && value.comparisons[name].bytes === true)) return false;
  if (!packed || !isEvidence({sha256: packed.binary, bytes: packed.binaryBytes}) ||
      !sameEvidence({sha256: packed.binary, bytes: packed.binaryBytes}, first.binary) ||
      !sameEvidence({sha256: packed.tarballSha256, bytes: first.npmArchive.bytes}, first.npmArchive) ||
      packed.standalone?.sha256 !== first.standaloneArchive.sha256 ||
      packed.standalone?.bytes !== first.standaloneArchive.bytes) return false;
  if (requireArtifacts && (!isEvidence(artifacts.tarball) || !isEvidence(artifacts.standalone))) return false;
  if (artifacts.tarball && !sameEvidence(artifacts.tarball, first.npmArchive)) return false;
  if (artifacts.standalone && !sameEvidence(artifacts.standalone, first.standaloneArchive)) return false;
  if (!npm?.build || !standalone?.build ||
      npm.build.binarySha256 !== first.binary.sha256 || npm.build.binaryBytes !== first.binary.bytes ||
      standalone.build.binarySha256 !== first.binary.sha256 || standalone.build.binaryBytes !== first.binary.bytes ||
      npm.build.target !== expectedTarget || standalone.build.target !== expectedTarget ||
      standalone.archiveSha256 !== first.standaloneArchive.sha256 ||
      standalone.archiveBytes !== first.standaloneArchive.bytes) return false;
  if (build && (build.binarySha256 !== first.binary.sha256 || build.binaryBytes !== first.binary.bytes ||
      build.target !== expectedTarget)) return false;
  if (![npm.build, standalone.build, build, retainedBuild?.value].filter(Boolean)
    .every(record => record.rust === toolchain.rustc)) return false;
  if (retainedBuild) {
    if (!sameEvidence(retainedBuild, first.build) || retainedBuild.value?.binarySha256 !== first.binary.sha256 ||
        retainedBuild.value?.binaryBytes !== first.binary.bytes || retainedBuild.value?.target !== expectedTarget ||
        !sameJson(npm.build, retainedBuild.value) || !sameJson(standalone.build, retainedBuild.value) ||
        build && !sameJson(build, retainedBuild.value)) return false;
    if (retainedBuild.value.glibcPackages && !sameJson(input.archives, retainedBuild.value.glibcPackages)) return false;
  } else if (requireArtifacts) return false;
  return true;
}
