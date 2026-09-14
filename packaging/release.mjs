// Stage the release package set without publishing it.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const cargoManifest = join(repo, 'crates/seshat/Cargo.toml');
const version = readFileSync(cargoManifest, 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
assert.ok(version, `version is missing from ${cargoManifest}`);

const targets = [
  {key: 'linux-x64', name: '@binary-balance/seshat-linux-x64', os: ['linux'], cpu: ['x64'], libc: ['glibc'], executable: 'seshat'},
  {key: 'linux-arm64', name: '@binary-balance/seshat-linux-arm64', os: ['linux'], cpu: ['arm64'], libc: ['glibc'], executable: 'seshat'},
  {key: 'darwin-x64', name: '@binary-balance/seshat-darwin-x64', os: ['darwin'], cpu: ['x64'], executable: 'seshat'},
  {key: 'darwin-arm64', name: '@binary-balance/seshat-darwin-arm64', os: ['darwin'], cpu: ['arm64'], executable: 'seshat'},
  {key: 'win32-x64', name: '@binary-balance/seshat-win32-x64', os: ['win32'], cpu: ['x64'], executable: 'seshat.exe'},
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
    const [key, path] = value.split('=', 2);
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
const npm = (stage, destination) => {
  const result = JSON.parse(execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
    'pack', stage, '--json', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    '--update-notifier=false', '--pack-destination', destination,
  ], {cwd: repo, encoding: 'utf8'}));
  assert.equal(result.length, 1);
  return result[0];
};
function sourceCommit() {
  const dotGit = join(repo, '.git');
  const pointer = statSync(dotGit).isFile() ? readFileSync(dotGit, 'utf8').trim() : null;
  const gitDirectory = pointer?.startsWith('gitdir: ')
    ? resolve(repo, pointer.slice('gitdir: '.length))
    : dotGit;
  const head = readFileSync(join(gitDirectory, 'HEAD'), 'utf8').trim();
  const commonDirectory = existsSync(join(gitDirectory, 'commondir'))
    ? resolve(gitDirectory, readFileSync(join(gitDirectory, 'commondir'), 'utf8').trim())
    : gitDirectory;
  return head.startsWith('ref: ')
    ? readFileSync(join(commonDirectory, head.slice('ref: '.length)), 'utf8').trim()
    : head;
}
const sourceRevision = sourceCommit();
assert.match(sourceRevision, /^[0-9a-f]{40}$/i, 'HEAD must resolve to a commit');
const rootSource = join(repo, 'packages/seshat');
const rootStage = join(output, 'seshat');
mkdirSync(output, {recursive: true});

const optionalDependencies = Object.fromEntries(
  targets.map(target => [target.name, version]),
);
writeJson(join(rootStage, 'package.json'), {
  name: '@binary-balance/seshat',
  version,
  description: 'Native TypeScript code assurance',
  license: 'MIT',
  type: 'module',
  engines: {node: '24.20.0'},
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
  const notices = noticeFiles.get(target.key);
  if (binary && pack) assert.ok(notices, `--notices is required when packing ${target.key}`);
  const files = [`bin/${target.executable}`, 'README.md', 'LICENSE', 'BUILD.json',
    ...(notices ? ['THIRD_PARTY_NOTICES.txt'] : [])];
  writeJson(join(stage, 'package.json'), {
    name: target.name,
    version,
    description: `Native Seshat payload for ${target.key}`,
    license: 'MIT',
    engines: {node: '24.20.0'},
    os: target.os,
    cpu: target.cpu,
    ...(target.libc ? {libc: target.libc} : {}),
    files,
  });
  mkdirSync(join(stage, 'bin'), {recursive: true});
  writeFileSync(join(stage, 'README.md'), `# Seshat native payload\n\nTarget: ${target.key}.\n`);
  copy(join(repo, 'LICENSE'), join(stage, 'LICENSE'));
  if (notices) copy(notices, join(stage, 'THIRD_PARTY_NOTICES.txt'));
  if (binary) {
    assert.ok(existsSync(binary) && statSync(binary).isFile(), `native binary is missing: ${binary}`);
    copyFileSync(binary, executablePath);
    if (target.os[0] !== 'win32') chmodSync(executablePath, 0o755);
    const bytes = readFileSync(binary);
    const supplied = buildInfos.get(target.key);
    const build = supplied
      ? JSON.parse(readFileSync(supplied, 'utf8'))
      : {};
    writeJson(join(stage, 'BUILD.json'), {
      ...build,
      schemaVersion: 1,
      package: target.name,
      packageVersion: version,
      target: build.target ?? target.key,
      sourceCommit: build.sourceCommit ?? sourceRevision,
      binarySha256: sha256(bytes),
      binaryBytes: bytes.length,
    });
  }
  const archive = binary && pack ? npm(stage, output) : null;
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

const rootArchive = pack ? npm(rootStage, output) : null;
const release = {
  schemaVersion: 1,
  version,
  sourceCommit: sourceRevision,
  entry: {
    name: '@binary-balance/seshat',
    version,
    stage: portable(rootStage),
    archive: rootArchive ? {file: rootArchive.filename, path: portable(join(output, rootArchive.filename)), bytes: rootArchive.size, integrity: rootArchive.integrity} : null,
  },
  native: staged,
};
const resultPath = manifestOutput ?? process.env.SESHAT_RELEASE_OUTPUT ?? join(output, 'release.json');
mkdirSync(dirname(resultPath), {recursive: true});
writeJson(resultPath, release);
console.log(JSON.stringify(release, null, 2));
