// Maintainer-only repeat pack proof. It writes evidence only after every comparison passes.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
assert.equal(process.argv.length, 3,
  'usage: SESHAT_REPEAT_OUTPUT=path node packaging/repeat-pack.mjs <Debian archive directory> | --native-arm64 | --native-macos');
const output = process.env.SESHAT_REPEAT_OUTPUT;
assert.ok(output, 'SESHAT_REPEAT_OUTPUT is required');
const packArgs = [process.argv[2]];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (command, args) => execFileSync(command, args, {cwd:repo, encoding:'utf8'}).trim();
const sourceCommit = run('git', ['rev-parse', 'HEAD']);
assert.equal(run('git', ['status', '--porcelain']), '', 'repeat proof requires a clean source tree');

const inputHashes = !packArgs[0].startsWith('--')
  ? ['libc6.deb', 'libc6-dev.deb', 'libgcc-s1.deb'].map(file => ({file, sha256:sha256(readFileSync(join(resolve(packArgs[0]), file)))}))
  : [];
const toolchain = {
  node: process.version,
  npm: run('npm', ['--version']),
  rustc: run('rustc', ['--version']),
  cargo: run('cargo', ['--version']),
};
const uname = {
  system: run('uname', ['-s']),
  release: run('uname', ['-r']),
  machine: run('uname', ['-m']),
};
const glibc = process.platform === 'linux' ? process.report.getReport().header.glibcVersionRuntime : null;

mkdirSync(join(repo, 'work'), {recursive:true});
const work = mkdtempSync(join(repo, 'work/repeat-pack-'));
const results = [0, 1].map(index => {
  const resultPath = join(work, `result-${index}.json`);
  execFileSync(process.execPath, [join(here, 'pack.mjs'), ...packArgs], {
    cwd:repo,
    env:{...process.env, SESHAT_PACK_RESULT:resultPath},
    stdio:'inherit',
  });
  return JSON.parse(readFileSync(resultPath, 'utf8'));
});

function inspect(result) {
  const npmBytes = readFileSync(result.tarball);
  const standaloneBytes = readFileSync(result.standalone.path);
  const buildBytes = execFileSync('tar', ['-xOf', result.tarball, 'package/BUILD.json'], {maxBuffer:2 * 1024 * 1024});
  const binaryBytes = execFileSync('tar', ['-xOf', result.tarball, 'package/bin/seshat'], {maxBuffer:32 * 1024 * 1024});
  const npm = {sha256:sha256(npmBytes), bytes:npmBytes.length};
  const standalone = {sha256:sha256(standaloneBytes), bytes:standaloneBytes.length};
  const build = {sha256:sha256(buildBytes), bytes:buildBytes.length};
  const binary = {sha256:sha256(binaryBytes), bytes:binaryBytes.length};
  assert.equal(result.tarballSha256, npm.sha256, 'npm archive hash differs from pack metadata');
  assert.deepEqual(result.standalone, {path:result.tarball, sha256:npm.sha256, bytes:npm.bytes});
  assert.equal(JSON.parse(buildBytes).binarySha256, result.binary, 'BUILD.json binary hash differs from pack metadata');
  assert.deepEqual(binary, {sha256:result.binary, bytes:result.binaryBytes});
  assert.equal(npm.sha256, standalone.sha256, 'npm and standalone hashes differ within one pack');
  assert.equal(npm.bytes, standalone.bytes, 'npm and standalone sizes differ within one pack');
  assert.ok(npmBytes.equals(standaloneBytes), 'npm and standalone bytes differ within one pack');
  return {binary, build, npmArchive:npm, standaloneArchive:standalone, files:result.files.map(file => file.path).sort()};
}

const runs = results.map(inspect);
const compare = (left, right) => ({
  hash: left.sha256 === right.sha256,
  bytes: left.bytes === right.bytes,
  passed: left.sha256 === right.sha256 && left.bytes === right.bytes,
});
const comparisons = {
  binary: compare(runs[0].binary, runs[1].binary),
  build: compare(runs[0].build, runs[1].build),
  npmArchive: compare(runs[0].npmArchive, runs[1].npmArchive),
  standaloneArchive: compare(runs[0].standaloneArchive, runs[1].standaloneArchive),
};
assert.ok(Object.values(comparisons).every(value => value.passed), 'repeat pack outputs differ');

const proof = {
  schemaVersion:1,
  sourceCommit,
  host:{platform:process.platform, arch:process.arch, uname, glibc},
  toolchain,
  input:{mode:packArgs[0].startsWith('--') ? packArgs[0] : 'debian-x64', archives:inputHashes},
  runs,
  comparisons,
  validation:{passed:true, reason:'two clean packer invocations produced identical native binary and archive bytes'},
};
const outputPath = resolve(output);
mkdirSync(dirname(outputPath), {recursive:true});
writeFileSync(outputPath, JSON.stringify(proof, null, 2) + '\n');
console.log(`Repeat pack proof passed: ${outputPath}`);
