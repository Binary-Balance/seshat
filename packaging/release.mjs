// Stage the release package set without publishing it.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runNpm} from './npm.mjs';
import {loadRuntimeNoticeAssets, renderRuntimeNotice} from './runtime-notice-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const cargoManifest = join(repo, 'crates/seshat/Cargo.toml');
const version = readFileSync(cargoManifest, 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
assert.ok(version, `version is missing from ${cargoManifest}`);

const targets = [
  {key: 'linux-x64', triple: 'x86_64-unknown-linux-gnu', name: '@binary-balance/seshat-linux-x64', os: ['linux'], cpu: ['x64'], libc: ['glibc'], executable: 'seshat'},
  {key: 'linux-arm64', triple: 'aarch64-unknown-linux-gnu', name: '@binary-balance/seshat-linux-arm64', os: ['linux'], cpu: ['arm64'], libc: ['glibc'], executable: 'seshat'},
  {key: 'darwin-x64', triple: 'x86_64-apple-darwin', name: '@binary-balance/seshat-darwin-x64', os: ['darwin'], cpu: ['x64'], executable: 'seshat'},
  {key: 'darwin-arm64', triple: 'aarch64-apple-darwin', name: '@binary-balance/seshat-darwin-arm64', os: ['darwin'], cpu: ['arm64'], executable: 'seshat'},
  {key: 'win32-x64', triple: 'x86_64-pc-windows-msvc', name: '@binary-balance/seshat-win32-x64', os: ['win32'], cpu: ['x64'], executable: 'seshat.exe'},
];
const targetByKey = new Map(targets.map(target => [target.key, target]));
const args = process.argv.slice(2);
let output = join(repo, 'work', `release-${version}`);
let manifestOutput;
const binaries = new Map();
const buildInfos = new Map();
const noticeFiles = new Map();
let pack = true;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--output' || arg === '--manifest') {
    const value = args[++index];
    assert.ok(value, `${arg} requires a path`);
    if (arg === '--output') output = resolve(value);
    else manifestOutput = resolve(value);
  } else if (arg === '--binary' || arg === '--build-info' || arg === '--notices') {
    const value = args[++index];
    assert.ok(value?.includes('='), `${arg} requires target=path`);
    const separator = value.indexOf('=');
    const key = value.slice(0, separator);
    const path = value.slice(separator + 1);
    assert.ok(targetByKey.has(key), `unknown native target ${key}`);
    assert.ok(path, `${arg} requires a path for ${key}`);
    (arg === '--binary' ? binaries : arg === '--build-info' ? buildInfos : noticeFiles).set(key, resolve(path));
  } else if (arg === '--layout-only') {
    pack = false;
  } else {
    throw new Error(`unknown option ${arg}`);
  }
}

const writeJson = (path, value) => {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
const copy = (source, destination) => {
  mkdirSync(dirname(destination), {recursive: true});
  copyFileSync(source, destination);
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const portable = path => relative(repo, path).replaceAll('\\', '/') || '.';
const npm = (stage, destination, files) => {
  const result = JSON.parse(runNpm(['pack', stage, '--json', '--pack-destination', destination], destination));
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].files.map(file => file.path).sort(), [...files, 'package.json'].sort(),
    `packed file list differs from the declared release payload: ${stage}`);
  return result[0];
};
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repo,
  encoding: 'utf8',
}).trim();
assert.match(sourceRevision, /^[0-9a-f]{40}$/i, 'HEAD must resolve to a commit');
const resultPath = resolve(manifestOutput ?? process.env.SESHAT_RELEASE_OUTPUT ?? join(output, 'release.json'));
const existingOutput = lstatSync(output, {throwIfNoEntry:false});
assert.ok(!existingOutput || existingOutput.isDirectory() && readdirSync(output).length === 0,
  `output must be a new or empty directory: ${output}`);
assert.ok(!lstatSync(resultPath, {throwIfNoEntry:false}), `release manifest already exists: ${resultPath}`);
const relativeResult = relative(output, resultPath).replaceAll('\\', '/');
const reservedResult = process.platform === 'win32' ? relativeResult.toLowerCase() : relativeResult;
const stageNames = ['seshat', ...targets.map(target => target.key)];
const archiveNames = ['binary-balance-seshat', ...targets.map(target => `binary-balance-seshat-${target.key}`)]
  .map(name => `${name}-${version}.tgz`);
assert.ok(reservedResult && !stageNames.includes(reservedResult.split('/')[0]) && !archiveNames.includes(reservedResult),
  'release manifest must not overwrite a staged package or archive');

// Check every input before creating output, retaining the exact bytes we validated.
const payloads = new Map();
// Git checkouts may encode the same lockfile with LF or CRLF across native jobs.
const lockfile = readFileSync(join(repo, 'crates/seshat/Cargo.lock'), 'utf8').replaceAll('\r\n', '\n');
const lockfileHashes = [sha256(lockfile), sha256(lockfile.replaceAll('\n', '\r\n'))];
const runtime = pack && binaries.size ? loadRuntimeNoticeAssets(join(here, 'runtime-notices/rust-1.98.1')) : null;
for (const target of targets) {
  const binary = binaries.get(target.key);
  const info = buildInfos.get(target.key);
  const notices = noticeFiles.get(target.key);
  if (pack) {
    assert.ok(binary || !info && !notices, `${target.key}: metadata requires --binary`);
    if (binary) {
      assert.ok(info, `${target.key}: --build-info is required when packing`);
      assert.ok(notices, `${target.key}: --notices is required when packing`);
    }
  }
  const payload = {};
  for (const [name, path] of [['binary', binary], ['build', info], ['notices', notices]]) {
    if (path) {
      assert.ok(statSync(path).isFile(), `${target.key}: ${name} must be a file`);
      payload[name] = readFileSync(path);
    }
  }
  if (pack && binary) {
    const build = JSON.parse(payload.build);
    const expected = {
      schemaVersion:1, package:target.name, packageVersion:version, target:target.triple,
      sourceCommit:sourceRevision,
      rust:runtime.provenance.toolchain.rustcBuild,
      binarySha256:sha256(payload.binary), binaryBytes:payload.binary.length,
    };
    for (const [field, value] of Object.entries(expected)) {
      assert.deepEqual(build?.[field], value, `${target.key}: BUILD.json ${field} mismatch`);
    }
    assert.ok(lockfileHashes.includes(build.cargoLockSha256), `${target.key}: BUILD.json cargoLockSha256 mismatch`);
    assert.ok(payload.binary.length > 0, `${target.key}: native binary is empty`);
    assert.ok(typeof build.dependencyInventoryScope === 'string' && build.dependencyInventoryScope.length > 0,
      `${target.key}: dependency inventory scope is missing`);
    assert.ok(Array.isArray(build.dependencies) && build.dependencies.length > 0 &&
      build.dependencies.every(row => row && ['name', 'version', 'license'].every(field => typeof row[field] === 'string' && row[field])),
    `${target.key}: dependency inventory is missing or invalid`);
    assert.ok(Array.isArray(build.nativeLibraries) && build.nativeLibraries.length > 0 &&
      build.nativeLibraries.every(name => typeof name === 'string' && name), `${target.key}: native libraries are missing`);
    const expectedNotices = {
      format:runtime.provenance.format, formatVersion:runtime.provenance.formatVersion,
      rustcVersion:runtime.provenance.toolchain.rustcVersion,
      rustcBuild:runtime.provenance.toolchain.rustcBuild,
      rustCommit:runtime.provenance.toolchain.rustCommit,
      noticeSha256:sha256(payload.notices), noticeBytes:payload.notices.length,
      assets:runtime.files.map(({path, bytes, sha256}) => ({path, bytes, sha256})),
    };
    for (const [field, value] of Object.entries(expectedNotices)) {
      assert.deepEqual(build.runtimeNotices?.[field], value, `${target.key}: runtimeNotices ${field} mismatch`);
    }
    assert.ok(payload.notices.includes(renderRuntimeNotice(runtime)), `${target.key}: pinned runtime notices are missing`);
  }
  payloads.set(target.key, payload);
}

const rootSource = join(repo, 'packages/seshat');
const rootStage = join(output, 'seshat');
mkdirSync(output, {recursive: true});

const optionalDependencies = Object.fromEntries(
  targets.map(target => [target.name, version]),
);
writeJson(join(rootStage, 'package.json'), {
  name: '@binary-balance/seshat',
  version,
  description: 'A native CLI for TypeScript and TSX complexity analysis and mutation testing.',
  license: 'MIT',
  repository: {type: 'git', url: 'git+https://github.com/Binary-Balance/seshat.git'},
  type: 'module',
  engines: {node: '>=24.20.0 <25'},
  bin: {seshat: 'bin/seshat.mjs'},
  files: ['bin/seshat.mjs', 'README.md', 'LICENSE'],
  optionalDependencies,
});
copy(join(rootSource, 'bin/seshat.mjs'), join(rootStage, 'bin/seshat.mjs'));
chmodSync(join(rootStage, 'bin/seshat.mjs'), 0o755);
copy(join(rootSource, 'README.md'), join(rootStage, 'README.md'));
copy(join(repo, 'LICENSE'), join(rootStage, 'LICENSE'));

const staged = [];
for (const target of targets) {
  const stage = join(output, target.key);
  const binary = binaries.get(target.key);
  const executablePath = join(stage, 'bin', target.executable);
  const payload = payloads.get(target.key);
  const files = [`bin/${target.executable}`, 'README.md', 'LICENSE', 'BUILD.json', 'THIRD_PARTY_NOTICES.txt'];
  writeJson(join(stage, 'package.json'), {
    name: target.name,
    version,
    description: `Native Seshat payload for ${target.key}`,
    license: 'MIT',
    repository: {type: 'git', url: 'git+https://github.com/Binary-Balance/seshat.git'},
    engines: {node: '>=24.20.0 <25'},
    os: target.os,
    cpu: target.cpu,
    ...(target.libc ? {libc: target.libc} : {}),
    files,
  });
  mkdirSync(join(stage, 'bin'), {recursive: true});
  writeFileSync(join(stage, 'README.md'), `# Seshat native payload\n\nTarget: ${target.key}.\nConsumers normally install \`@binary-balance/seshat\`, which selects this payload for matching hosts.\n`);
  copy(join(repo, 'LICENSE'), join(stage, 'LICENSE'));
  if (payload.notices) writeFileSync(join(stage, 'THIRD_PARTY_NOTICES.txt'), payload.notices);
  if (payload.build) writeFileSync(join(stage, 'BUILD.json'), payload.build);
  if (payload.binary) {
    writeFileSync(executablePath, payload.binary);
    if (target.os[0] !== 'win32') chmodSync(executablePath, 0o755);
  }
  const archive = binary && pack ? npm(stage, output, files) : null;
  staged.push({
    key: target.key,
    name: target.name,
    version,
    os: target.os,
    cpu: target.cpu,
    ...(target.libc ? {libc: target.libc} : {}),
    stage: portable(stage),
    binary: binary ? portable(binary) : null,
    archive: archive ? {file: archive.filename, path: portable(join(output, archive.filename)), bytes: archive.size, integrity: archive.integrity} : null,
  });
}

const rootArchive = pack ? npm(rootStage, output, ['bin/seshat.mjs', 'README.md', 'LICENSE']) : null;
const release = {
  schemaVersion: 1,
  version,
  mode: pack ? 'packed' : 'layout-only',
  sourceCommit: sourceRevision,
  entry: {
    name: '@binary-balance/seshat',
    version,
    stage: portable(rootStage),
    archive: rootArchive ? {file: rootArchive.filename, path: portable(join(output, rootArchive.filename)), bytes: rootArchive.size, integrity: rootArchive.integrity} : null,
  },
  native: staged,
};
mkdirSync(dirname(resultPath), {recursive: true});
writeJson(resultPath, release);
console.log(JSON.stringify(release, null, 2));
