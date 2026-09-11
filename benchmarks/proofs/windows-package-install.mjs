// Minimal Windows package proof. Full CLI and parallel fixture coverage is a separate slice.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {arch, release, version as osVersion, tmpdir} from 'node:os';
import {basename, delimiter, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(process.platform, 'win32', 'Windows package proof requires Windows');
assert.equal(process.arch, 'x64', 'Windows package proof is x64 only');
assert.equal(process.env.RUNNER_OS, 'Windows', 'Windows package proof requires the Windows runner');
assert.equal(Number(release().match(/\b10\.0\.(\d+)\b/)?.[1]), 20348,
  'Windows package proof requires Windows Server 2022 build 20348');
assert.equal(process.argv.length, 3, 'usage: node benchmarks/proofs/windows-package-install.mjs <npm tarball>');

const tarball = resolve(process.argv[2]);
assert.ok(existsSync(tarball) && statSync(tarball).isFile(), `missing package archive: ${tarball}`);
const hash = value => createHash('sha256').update(value).digest('hex');
const tarballBytes = readFileSync(tarball);
const tarballSha256 = hash(tarballBytes);
if (process.env.SESHAT_TARBALL_SHA256) assert.equal(tarballSha256, process.env.SESHAT_TARBALL_SHA256);

const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
const comspec = process.env.ComSpec ?? process.env.COMSPEC;
assert.ok(systemRoot && comspec && existsSync(comspec), 'SystemRoot and ComSpec are required');
const nodeDirectory = dirname(process.execPath);
const npmCommand = process.env.SESHAT_NPM_CMD ?? 'npm.cmd';
const npmPath = process.env.SESHAT_NPM_CMD
  ? resolve(process.env.SESHAT_NPM_CMD)
  : process.env.PATH.split(delimiter).map(path => join(path, 'npm.cmd')).find(existsSync);
assert.ok(npmPath && existsSync(npmPath), 'npm.cmd is required');
const noRustPath = [nodeDirectory, join(systemRoot, 'System32')].join(delimiter);
const noRustEnv = {
  ...process.env,
  PATH:noRustPath,
  SystemRoot:systemRoot,
  ComSpec:comspec,
};
for (const name of ['CARGO_HOME', 'RUSTUP_HOME', 'CARGO_TARGET_DIR', 'RUSTC_WRAPPER', 'CARGO_BUILD_RUSTC', 'RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'RUSTUP_TOOLCHAIN']) {
  delete noRustEnv[name];
}
const npmConfig = path => ({
  npm_config_userconfig:join(path, 'user.npmrc'),
  npm_config_globalconfig:join(path, 'global.npmrc'),
  npm_config_cache:join(path, 'cache'),
  npm_config_offline:'true',
  npm_config_update_notifier:'false',
});
const work = mkdtempSync(join(tmpdir(), 'seshat-windows-package-'));
const consumer = join(work, 'consumer 🎸');
const standalone = join(work, 'standalone 🎸');
mkdirSync(consumer);
mkdirSync(standalone);
const env = {...noRustEnv, ...npmConfig(work)};
const checks = {};
function run(name, command, args, cwd, runEnv = env, status = 0, options = {}) {
  const started = performance.now();
  const child = spawnSync(command, args, {
    cwd,
    env:runEnv,
    encoding:'utf8',
    timeout:120000,
    maxBuffer:8 * 1024 * 1024,
    ...options,
  });
  assert.ifError(child.error);
  assert.equal(child.status, status, `${name}: ${child.stdout ?? ''}${child.stderr ?? ''}`);
  checks[name] = {status:child.status, ms:performance.now() - started, stdout:child.stdout, stderr:child.stderr};
  return child;
}
function npm(name, args, cwd, status = 0) {
  return run(name, npmCommand, args, cwd, env, status, {shell:true});
}
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
json(join(consumer, 'package.json'), {
  name:'seshat-windows-consumer', version:'0.0.0', private:true,
  scripts:{assurance:'seshat --version'},
});
npm('offline-install', ['install', '--save-dev', '--save-exact', '--ignore-scripts', '--offline', '--no-audit', '--no-fund',
  '--cache',join(work, 'cache'), '--userconfig',join(work, 'user.npmrc'), '--globalconfig',join(work, 'global.npmrc'), tarball], consumer);

const installed = join(consumer, 'node_modules', '@binary-balance', 'seshat');
const executable = join(installed, 'bin', 'seshat.exe');
const shim = join(consumer, 'node_modules', '.bin', 'seshat.cmd');
assert.ok(existsSync(executable), 'npm install did not retain bin/seshat.exe');
assert.ok(existsSync(shim), 'npm install did not create the Windows .cmd launcher');
assert.match(readFileSync(shim, 'utf8'), /seshat\.exe/i);
const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
assert.deepEqual(manifest.os, ['win32']);
assert.deepEqual(manifest.cpu, ['x64']);
assert.equal(manifest.libc, undefined);
assert.deepEqual(manifest.bin, {seshat: 'bin/seshat.exe'});
assert.deepEqual(readdirSync(installed).sort(), ['BUILD.json', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.txt', 'bin', 'package.json'].sort());
assert.deepEqual(readdirSync(join(installed, 'bin')).sort(), ['seshat.exe']);
const build = JSON.parse(readFileSync(join(installed, 'BUILD.json'), 'utf8'));
assert.equal(build.target, 'x86_64-pc-windows-msvc');
assert.equal(build.cpu, 'x64');
assert.equal(build.peMachine, '0x8664');
assert.equal(build.peFormat, 'PE32+');
assert.equal(build.crtStatic, true);
assert.ok(Array.isArray(build.imports) && build.imports.length);
assert.ok(build.imports.every(name => !/^(MSVCP|VCRUNTIME)/i.test(name)));
const binaryBytes = readFileSync(executable);
const binarySha256 = hash(binaryBytes);
const buildSha256 = hash(readFileSync(join(installed, 'BUILD.json')));
assert.equal(binarySha256, build.binarySha256);
assert.equal(binaryBytes.length, build.binaryBytes);
if (process.env.SESHAT_BINARY_SHA256) assert.equal(binarySha256, process.env.SESHAT_BINARY_SHA256);
assert.ok(build.sourceCommit);

run('installed-version', executable, ['--version'], consumer);
run('installed-help', executable, ['--help'], consumer);
run('bin-cmd-version', comspec, ['/d', '/c', shim, '--version'], consumer);
npm('npm-exec-help', ['exec', '--offline', '--', 'seshat', '--help'], consumer);
npm('package-script-version', ['run', '--silent', 'assurance'], consumer);
npm('offline-ci', ['ci', '--ignore-scripts', '--offline', '--no-audit', '--no-fund',
  '--cache',join(work, 'cache'), '--userconfig',join(work, 'user.npmrc'), '--globalconfig',join(work, 'global.npmrc')], consumer);

run('cargo-probe', 'where.exe', ['cargo'], consumer, noRustEnv, 1);
run('rustc-probe', 'where.exe', ['rustc'], consumer, noRustEnv, 1);
assert.equal(noRustEnv.SystemRoot, systemRoot);
assert.equal(noRustEnv.ComSpec, comspec);
assert.ok(noRustEnv.PATH.split(delimiter).includes(nodeDirectory));
assert.ok(noRustEnv.PATH.split(delimiter).includes(join(systemRoot, 'System32')));

run('standalone-list', 'tar.exe', ['-tzf', tarball], standalone);
run('standalone-extract', 'tar.exe', ['-xzf', tarball, '-C', standalone, '--strip-components=1'], standalone);
const standaloneBinary = join(standalone, 'bin', 'seshat.exe');
assert.ok(existsSync(standaloneBinary), 'standalone extraction did not produce bin/seshat.exe');
assert.equal(hash(readFileSync(join(standalone, 'BUILD.json'))), hash(readFileSync(join(installed, 'BUILD.json'))));
assert.equal(hash(readFileSync(standaloneBinary)), binarySha256);
run('standalone-version', standaloneBinary, ['--version'], standalone, noRustEnv);
run('standalone-help', standaloneBinary, ['--help'], standalone, noRustEnv);

const result = {
  schemaVersion:1,
  kind:'seshat-windows-package-install',
  sourceCommit:build.sourceCommit,
  host:{platform:process.platform, architecture:arch(), release:release(), version:osVersion(), runner:process.env.RUNNER_OS ?? null,
    image:process.env.ImageOS ?? null, imageVersion:process.env.ImageVersion ?? null},
  npmCommand:basename(npmCommand),
  tarball:{path:tarball, sha256:tarballSha256, bytes:tarballBytes.length},
  standaloneArchive:{path:tarball, sha256:tarballSha256, bytes:tarballBytes.length},
  installedBinary:executable,
  standaloneBinary,
  binary:{sha256:binarySha256, bytes:binaryBytes.length},
  buildSha256,
  build,
  noConsumingRust:{
    probes:[{command:'cargo', unavailable:checks['cargo-probe'].status === 1}, {command:'rustc', unavailable:checks['rustc-probe'].status === 1}],
    environmentUnset:['CARGO_HOME', 'RUSTUP_HOME', 'CARGO_TARGET_DIR', 'RUSTC_WRAPPER', 'CARGO_BUILD_RUSTC', 'RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'RUSTUP_TOOLCHAIN'],
    preserved:['SystemRoot', 'ComSpec', 'System32', 'Node', 'npm.cmd'],
  },
  checks,
};
const resultPath = process.env.SESHAT_PROOF_OUTPUT ?? join(work, 'result.json');
json(join(work, 'result.json'), result);
if (process.env.SESHAT_PROOF_OUTPUT) json(resultPath, result);
console.log(`Windows package install passed. Results: ${resultPath}`);
