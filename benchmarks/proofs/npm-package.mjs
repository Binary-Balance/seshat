// Install the release entry package and one native payload through a disposable
// loopback registry. This proves npm's platform selection without publishing.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants} from 'node:os';
import {alive} from './liveness.mjs';
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {delimiter, dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(process.argv.length, 4,
  'usage: node benchmarks/proofs/npm-package.mjs <entry tarball> <native tarball>');
const entryArchive = realpathSync(process.argv[2]);
const nativeArchive = realpathSync(process.argv[3]);
assert.ok(statSync(entryArchive).isFile());
assert.ok(statSync(nativeArchive).isFile());

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sha512 = bytes => createHash('sha512').update(bytes).digest('base64');
const sha1 = bytes => createHash('sha1').update(bytes).digest('hex');
const archiveBytes = path => readFileSync(path);
const tarCommand = process.platform === 'win32' ? 'tar.exe' : 'tar';
const archiveJson = path => {
  const result = spawnSync(tarCommand, ['-xOf', path, 'package/package.json'], {encoding: 'utf8'});
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};
const archiveText = (path, name) => {
  const result = spawnSync(tarCommand, ['-xOf', path, `package/${name}`], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
const entryArchiveBytes = archiveBytes(entryArchive);
const nativeArchiveBytes = archiveBytes(nativeArchive);
const entryArchiveManifest = archiveJson(entryArchive);
const nativeArchiveManifest = archiveJson(nativeArchive);
const entryReadme = archiveText(entryArchive, 'README.md');
const normalizedEntryReadme = entryReadme.replace(/\s+/g, ' ');
const nativeReadme = archiveText(nativeArchive, 'README.md');
const nativeNotices = archiveText(nativeArchive, 'THIRD_PARTY_NOTICES.txt');
assert.match(nativeNotices, /\nCOPYRIGHT\n/);
assert.match(nativeNotices, /\nUNLICENSE\n/);
const repository = {type: 'git', url: 'git+https://github.com/Binary-Balance/seshat.git'};
const entryDescription = 'A native CLI for TypeScript and TSX complexity analysis and mutation testing.';
const version = entryArchiveManifest.version;
assert.equal(entryArchiveManifest.name, '@binary-balance/seshat');
assert.equal(entryArchiveManifest.description, entryDescription);
assert.ok(normalizedEntryReadme.includes('Seshat is a native CLI for TypeScript and TSX complexity analysis and mutation testing.'));
assert.ok(normalizedEntryReadme.includes('The package declares and verifies Node.js 24.20.0 exactly'));
assert.ok(normalizedEntryReadme.includes('npm install --save-dev @binary-balance/seshat'));
assert.ok(normalizedEntryReadme.includes('seshat mutate --config ./seshat.json'));
assert.ok(normalizedEntryReadme.includes('Linux x64 (glibc; Debian 11 userspace, glibc 2.31)'));
assert.ok(normalizedEntryReadme.includes('Linux ARM64 (glibc; Ubuntu 22.04, glibc 2.35)'));
assert.ok(normalizedEntryReadme.includes('macOS x64 (macOS 15.0 minimum)'));
assert.ok(normalizedEntryReadme.includes('macOS ARM64 (macOS 15.0 minimum)'));
assert.ok(normalizedEntryReadme.includes('Windows x64 (Windows Server 2022 verification)'));
assert.ok(normalizedEntryReadme.includes('https://github.com/Binary-Balance/seshat/blob/main/docs/configuration.md'));
assert.ok(normalizedEntryReadme.includes('https://github.com/Binary-Balance/seshat/blob/main/docs/report-format.md'));
assert.ok(normalizedEntryReadme.includes('https://github.com/Binary-Balance/seshat/blob/main/docs/platform-support.md'));
assert.deepEqual(entryArchiveManifest.repository, repository);
assert.ok(nativeArchiveManifest.name);
assert.equal(nativeArchiveManifest.version, version);
assert.equal(nativeArchiveManifest.description,
  `Native Seshat payload for ${nativeArchiveManifest.name.replace('@binary-balance/seshat-', '')}`);
assert.ok(nativeReadme.includes('Target: '));
assert.ok(nativeReadme.includes('Consumers normally install `@binary-balance/seshat`'));
assert.deepEqual(nativeArchiveManifest.repository, repository);
assert.deepEqual(Object.keys(entryArchiveManifest.optionalDependencies).sort(), [
  '@binary-balance/seshat-darwin-arm64',
  '@binary-balance/seshat-darwin-x64',
  '@binary-balance/seshat-linux-arm64',
  '@binary-balance/seshat-linux-x64',
  '@binary-balance/seshat-win32-x64',
]);

if (process.env.SESHAT_ENTRY_TARBALL_SHA256) {
  assert.equal(sha256(entryArchiveBytes), process.env.SESHAT_ENTRY_TARBALL_SHA256);
}
if (process.env.SESHAT_NATIVE_TARBALL_SHA256) {
  assert.equal(sha256(nativeArchiveBytes), process.env.SESHAT_NATIVE_TARBALL_SHA256);
}

const targetForHost = {
  'linux-x64': '@binary-balance/seshat-linux-x64',
  'linux-arm64': '@binary-balance/seshat-linux-arm64',
  'darwin-x64': '@binary-balance/seshat-darwin-x64',
  'darwin-arm64': '@binary-balance/seshat-darwin-arm64',
  'win32-x64': '@binary-balance/seshat-win32-x64',
}[`${process.platform}-${process.arch}`];
assert.ok(targetForHost, `unsupported proof host: ${process.platform}/${process.arch}`);
assert.equal(nativeArchiveManifest.name, targetForHost);
const nativePackageNames = Object.keys(entryArchiveManifest.optionalDependencies);
const unavailableNames = nativePackageNames.filter(name => name !== targetForHost);

const packageArchives = new Map([
  [entryArchiveManifest.name, {manifest: entryArchiveManifest, bytes: entryArchiveBytes}],
  [nativeArchiveManifest.name, {manifest: nativeArchiveManifest, bytes: nativeArchiveBytes}],
]);
const packageManifests = new Map(packageArchives);
for (const name of nativePackageNames) {
  if (packageManifests.has(name)) continue;
  const linux = name.includes('-linux-');
  const arm64 = name.endsWith('-arm64');
  packageManifests.set(name, {
    manifest: {
      name,
      version,
      license: 'MIT',
      engines: {node: '24.20.0'},
      os: [name.includes('-darwin-') ? 'darwin' : name.includes('-win32-') ? 'win32' : 'linux'],
      cpu: [arm64 ? 'arm64' : 'x64'],
      ...(linux ? {libc: ['glibc']} : {}),
    },
    bytes: null,
  });
}
const packageMetadata = manifest => {
  const bytes = packageArchives.get(manifest.name)?.bytes ?? Buffer.from('');
  const filename = `${manifest.name.replaceAll('/', '-')}-${manifest.version}.tgz`;
  return {
    name: manifest.name,
    'dist-tags': {latest: manifest.version},
    versions: {
      [manifest.version]: {
        ...manifest,
        dist: {
          tarball: `${registryUrl}/${encodeURIComponent(manifest.name)}/-/${filename}`,
          shasum: sha1(bytes),
          integrity: `sha512-${sha512(bytes)}`,
        },
      },
    },
  };
};

const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, registryUrl).pathname);
  const packageEntry = [...packageManifests.values()].find(({manifest}) =>
    path === `/${manifest.name}` || path.endsWith(`/${manifest.name}`) ||
    path.includes(`/${manifest.name}/-/`));
  if (!packageEntry) {
    response.writeHead(404).end();
    return;
  }
  if (path.includes('/-/')) {
    if (!packageEntry.bytes) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {'content-type': 'application/octet-stream'}).end(packageEntry.bytes);
    return;
  }
  response.writeHead(200, {'content-type': 'application/json'}).end(
    JSON.stringify(packageMetadata(packageEntry.manifest)),
  );
});
let registryUrl;
await new Promise((resolveServer, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    registryUrl = `http://127.0.0.1:${address.port}`;
    resolveServer();
  });
});
// A failed assertion must be able to terminate the proof even though the
// registry remains open for the child npm process. Successful runs close it
// explicitly after writing their result.
server.unref();

mkdirSync(join(repo, 'work/assurance-proofs'), {recursive: true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/npm-package-'));
const tools = join(work, 'tools');
mkdirSync(tools);
const npm = process.platform === 'win32'
  ? (process.env.npm_execpath && !/\.(?:cmd|bat)$/i.test(process.env.npm_execpath)
    ? process.env.npm_execpath
    : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'))
  : process.env.PATH.split(delimiter).map(path => join(path, 'npm')).find(existsSync);
assert.ok(npm && existsSync(npm), `npm CLI must be installed: ${npm ?? 'unknown'}`);
const npmCli = realpathSync(npm);
if (process.platform === 'win32') copyFileSync(process.execPath, join(tools, 'node.exe'));
else symlinkSync(process.execPath, join(tools, 'node'));
if (process.platform !== 'win32') symlinkSync('/bin/sh', join(tools, 'sh'));
const env = {
  ...process.env,
  PATH: process.platform === 'win32'
    ? [tools, join(process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32')].join(delimiter)
    : tools,
  npm_execpath: npmCli,
  npm_config_userconfig: join(work, 'user.npmrc'),
  npm_config_globalconfig: join(work, 'global.npmrc'),
  npm_config_cache: join(work, 'cache'),
  npm_config_update_notifier: 'false',
};
for (const name of ['CARGO_HOME', 'RUSTUP_HOME', 'CARGO_TARGET_DIR', 'npm_config_offline', 'npm_config_registry']) {
  delete env[name];
}
for (const command of ['cargo', 'rustc']) {
  assert.equal(spawnSync(command, ['--version'], {env}).error?.code, 'ENOENT');
}

const npmCommand = process.execPath;
const npmPrefix = [npmCli];

const commonNpmOptions = [
  '--ignore-scripts', '--no-audit', '--no-fund',
  '--cache', join(work, 'cache'),
  '--userconfig', join(work, 'user.npmrc'),
  '--globalconfig', join(work, 'global.npmrc'),
];
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const json = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const evidence = {};
const proofOutput = process.env.SESHAT_PROOF_OUTPUT ? resolve(process.env.SESHAT_PROOF_OUTPUT) : null;
const lastProgress = output => output.split(/\r?\n/)
  .findLast(line => line.startsWith('seshat-public-examples:')) ?? null;
const runDetails = (name, result) => [
  `${name}: timedOut=${result.timedOut} status=${result.status} signal=${result.signal}`,
  `lastProgress=${result.progress ?? '<none>'}`,
  `stdout:\n${result.stdout}`,
  `stderr:\n${result.stderr}`,
].join('\n');
async function run(name, command, args, cwd, status = 0, runEnv = env, timeoutMs = 120_000) {
  const started = performance.now();
  const child = spawn(command, args, {
    cwd,
    env: runEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  let stdout = '';
  let stderr = '';
  const forwardStderr = name === 'public-examples';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', value => { stdout += value; });
  return await new Promise(resolveRun => {
    let settled = false;
    let timedOut = false;
    let progress = null;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const completed = {...result, timedOut, stdout, stderr, progress: lastProgress(stderr)};
      evidence[name] = {
        status: completed.status,
        signal: completed.signal,
        timedOut: completed.timedOut,
        progress: completed.progress,
        ms: performance.now() - started,
        stdout,
        stderr,
      };
      if (completed.error || completed.timedOut || completed.status !== status) {
        if (proofOutput) {
          mkdirSync(dirname(proofOutput), {recursive: true});
          json(proofOutput, {
            schemaVersion: 1,
            kind: 'seshat-release-npm-install',
            version,
            host: {platform: process.platform, architecture: process.arch},
            checks: evidence,
            failure: {
              name,
              timedOut: completed.timedOut,
              status: completed.status,
              signal: completed.signal,
              progress: completed.progress,
              stdout,
              stderr,
              error: completed.error?.message ?? null,
            },
          });
        }
      }
      if (completed.error) completed.error.message = `${runDetails(name, completed)}\n${completed.error.message}`;
      assert.ifError(completed.error);
      assert.equal(completed.timedOut, false, runDetails(name, completed));
      assert.equal(completed.status, status, runDetails(name, completed));
      console.log(`${name}: exit ${completed.status}`);
      resolveRun(completed);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stderr.on('data', value => {
      const previousProgress = progress;
      stderr += value;
      progress = lastProgress(stderr);
      if (forwardStderr && !settled && !timedOut && progress !== previousProgress) timer.refresh();
      if (forwardStderr) process.stderr.write(value);
    });
    child.once('error', error => finish({error, status: null, signal: null}));
    child.once('close', (code, signal) => finish({error: null, status: code, signal}));
  });
}
async function runNpm(name, args, cwd, status = 0, timeoutMs = 120_000) {
  return await run(name, npmCommand, [...npmPrefix, ...args], cwd, status, env, timeoutMs);
}
async function runLauncher(name, args, cwd, status = 0) {
  return await run(name, process.execPath, [join(cwd, 'node_modules/@binary-balance/seshat/bin/seshat.mjs'), ...args], cwd, status);
}
function report(child) {
  assert.equal(child.stderr, '');
  assert.equal(child.stdout.trim().split('\n').length, 1);
  const value = JSON.parse(child.stdout);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.complete, false);
  assert.equal(value.result.complete, false);
  return value;
}

const publicExampleNames = ['node', 'jest-expo', 'vitest', 'workspaces'];
function validatePublicExamples(value, expectedCliKind) {
  assert.equal(value?.schemaVersion, 1);
  assert.equal(value?.validation?.passed, true, value?.validation?.error ?? 'public examples failed');
  assert.equal(value?.cli?.kind, expectedCliKind);
  assert.deepEqual(Object.keys(value.examples ?? {}).sort(), [...publicExampleNames].sort());
  for (const name of publicExampleNames) {
    const example = value.examples[name];
    assert.deepEqual(example?.workers, {one: 1, two: 2, parity: true}, `${name}: worker evidence is incomplete`);
    assert.ok(Array.isArray(example.sourceFiles) && example.sourceFiles.length > 0,
      `${name}: source file evidence is missing`);
  }
}

const consumer = join(work, 'consumer 🎸 with spaces');
mkdirSync(consumer);
json(join(consumer, 'package.json'), {
  name: 'seshat-local-consumer',
  version: '0.0.0',
  private: true,
  scripts: {assurance: 'seshat'},
});
await runNpm('registry-install', [
  'install', '--save-dev', '--save-exact', `${entryArchiveManifest.name}@${version}`,
  ...commonNpmOptions, '--registry', registryUrl,
], consumer);

const rootInstalled = join(consumer, 'node_modules/@binary-balance/seshat');
const nativeInstalled = join(consumer, 'node_modules', targetForHost);
const launcher = join(rootInstalled, 'bin/seshat.mjs');
const npmBin = join(consumer, 'node_modules/.bin');
const npmBinEntries = readdirSync(npmBin).filter(name => name.startsWith('seshat'));
const commandShim = process.platform === 'win32' ? join(npmBin, 'seshat.cmd') : null;
const comspec = process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe';
if (process.platform === 'win32') {
  assert.ok(npmBinEntries.includes('seshat.cmd'));
  const commandShimContents = readFileSync(commandShim, 'utf8')
    .replaceAll('\\', '/').toLowerCase();
  assert.match(commandShimContents, /@binary-balance\/seshat\/bin\/seshat\.mjs/);
  assert.doesNotMatch(commandShimContents, /seshat-(linux|darwin|win32)/);
} else {
  assert.deepEqual(npmBinEntries, ['seshat']);
  assert.equal(realpathSync(join(npmBin, 'seshat')), realpathSync(launcher));
}
const installedManifest = read(join(rootInstalled, 'package.json'));
assert.equal(installedManifest.name, entryArchiveManifest.name);
assert.equal(installedManifest.version, version);
assert.equal(installedManifest.description, entryDescription);
assert.deepEqual(installedManifest.repository, repository);
assert.deepEqual(installedManifest.optionalDependencies, entryArchiveManifest.optionalDependencies);
assert.equal(installedManifest.dependencies, undefined);
assert.equal(installedManifest.scripts, undefined);
assert.deepEqual(readdirSync(rootInstalled).sort(), ['LICENSE', 'README.md', 'bin', 'package.json'].sort());
assert.equal(readFileSync(join(rootInstalled, 'README.md'), 'utf8'), entryReadme);
const nativeManifest = read(join(nativeInstalled, 'package.json'));
assert.equal(nativeManifest.name, targetForHost);
assert.equal(nativeManifest.version, version);
assert.equal(nativeManifest.description, nativeArchiveManifest.description);
assert.deepEqual(nativeManifest.repository, repository);
assert.equal(nativeManifest.bin, undefined);
assert.deepEqual(nativeManifest.os, nativeArchiveManifest.os);
assert.deepEqual(nativeManifest.cpu, nativeArchiveManifest.cpu);
assert.deepEqual(nativeManifest.libc, nativeArchiveManifest.libc);
assert.equal(readFileSync(join(nativeInstalled, 'README.md'), 'utf8'), nativeReadme);
const nativeExecutable = join(nativeInstalled, 'bin', process.platform === 'win32' ? 'seshat.exe' : 'seshat');
assert.ok(statSync(nativeExecutable).isFile());
const build = read(join(nativeInstalled, 'BUILD.json'));
assert.equal(build.schemaVersion, 1);
assert.equal(build.package, targetForHost);
assert.equal(build.packageVersion, version);
assert.match(build.sourceCommit, /^[0-9a-f]{40}$/i);
assert.equal(build.binarySha256, sha256(readFileSync(nativeExecutable)));
assert.equal(build.binaryBytes, statSync(nativeExecutable).size);
if (process.env.SESHAT_NATIVE_BINARY_SHA256) {
  assert.equal(build.binarySha256, process.env.SESHAT_NATIVE_BINARY_SHA256);
}
for (const packageName of unavailableNames) {
  assert.equal(existsSync(join(consumer, 'node_modules', packageName)), false,
    `${packageName} should be omitted by npm platform selection`);
}

const nativeVersion = (await run('native-version', nativeExecutable, ['--version'], consumer)).stdout;
assert.equal(nativeVersion, `seshat ${version}\n`);
const launcherVersion = (await run('launcher-version', process.execPath, [launcher, '--version'], consumer)).stdout;
assert.equal(launcherVersion, nativeVersion);
await runNpm('npm-exec', ['exec', '--offline', ...commonNpmOptions, '--', 'seshat', '--help'], consumer);
await runNpm('package-script', ['run', '--silent', 'assurance', '--', '--version'], consumer);

if (process.platform === 'win32') {
  const shimVersion = await run('windows-shim-version', comspec,
    ['/d', '/s', '/c', 'call', commandShim, '--version'], consumer);
  assert.equal(shimVersion.stdout, nativeVersion);
}

const invalidJson = await runLauncher('unknown-command-json', ['bogus', '--json'], consumer, 2);
const invalidReport = report(invalidJson);
assert.equal(invalidReport.command, null);
assert.match(invalidReport.result.error, /unknown command/i);
const shellMarker = join(work, 'shell-marker');
const trickyConfig = join(work, 'project 🎸 with spaces', '$(touch shell-marker)', 'missing.json');
const argumentJson = await runLauncher('argument-forwarding-json', [
  'check', '--config', trickyConfig, '--scratch', work, '--json', '--no-progress',
], consumer, 2);
const argumentReport = report(argumentJson);
assert.equal(argumentReport.command, 'check');
assert.match(argumentReport.result.error, /missing|configuration|no such file|path specified/i);
assert.equal(existsSync(shellMarker), false, 'launcher interpreted a user argument as shell input');

if (process.platform === 'win32') {
  const shimArgument = await run('windows-shim-argument-forwarding', comspec, [
    '/d', '/s', '/c', 'call', commandShim, 'check', '--config', trickyConfig,
    '--scratch', work, '--json', '--no-progress',
  ], consumer, 2);
  const shimReport = report(shimArgument);
  assert.equal(shimReport.command, 'check');
  assert.match(shimReport.result.error, /missing|configuration|no such file|path specified/i);
  assert.equal(existsSync(shellMarker), false, 'Windows shim interpreted a user argument as shell input');
}

const unsupported = await run('unsupported-platform-json', process.execPath, ['-e', [
  `Object.defineProperty(process, 'platform', {value: 'freebsd'});`,
  `process.argv = [process.argv[0], 'seshat', '--json'];`,
  `await import(${JSON.stringify(pathToFileURL(launcher).href)});`,
].join('')], consumer, 2);
assert.match(report(unsupported).result.error, /unsupported platform/i);

const nativeBackup = join(work, 'native-package-backup');
renameSync(nativeInstalled, nativeBackup);
try {
  const missing = await runLauncher('missing-payload-json', ['check', '--json'], consumer, 2);
  assert.match(report(missing).result.error, /missing|omitted/i);
} finally {
  renameSync(nativeBackup, nativeInstalled);
}
const nativeManifestPath = join(nativeInstalled, 'package.json');
const originalNativeManifest = read(nativeManifestPath);
json(nativeManifestPath, {...originalNativeManifest, version: '0.1.0-rc.0'});
try {
  const mismatch = await runLauncher('version-mismatch-json', ['check', '--json'], consumer, 2);
  assert.match(report(mismatch).result.error, /version mismatch/i);
} finally {
  json(nativeManifestPath, originalNativeManifest);
}

const waitFor = async (predicate, label) => {
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
};

const synchronousSpawnError = await run('synchronous-spawn-error-json', process.execPath, ['--input-type=module', '-e', `
  import childProcess from 'node:child_process';
  import {syncBuiltinESMExports} from 'node:module';
  childProcess.spawn = () => { throw new Error('injected synchronous spawn failure'); };
  syncBuiltinESMExports();
  process.argv = [process.argv[0], 'seshat', 'check', '--json'];
  await import(${JSON.stringify(pathToFileURL(launcher).href)});
`], consumer, 2);
assert.match(report(synchronousSpawnError).result.error, /cannot start native payload: injected synchronous spawn failure/);

// Observe forwarding at the child-process boundary, including the interval after
// signal exit but before inherited stdio closes. The real launcher is imported.
await run('launcher-forwarding-guards', process.execPath, ['--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  import {EventEmitter} from 'node:events';
  import childProcess from 'node:child_process';
  import {syncBuiltinESMExports} from 'node:module';
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  const calls = [];
  child.kill = signal => calls.push(signal);
  childProcess.spawn = () => child;
  syncBuiltinESMExports();
  await import(${JSON.stringify(pathToFileURL(launcher).href)});
  process.emit('SIGINT', 'SIGINT');
  process.emit('SIGINT', 'SIGINT');
  if (process.platform === 'win32') process.emit('SIGBREAK', 'SIGBREAK');
  assert.deepEqual(calls, process.platform === 'win32' ? [] : ['SIGINT', 'SIGINT']);
  calls.length = 0;
  child.signalCode = 'SIGKILL';
  process.emit('SIGTERM', 'SIGTERM');
  assert.deepEqual(calls, []);
  child.signalCode = null;
  child.exitCode = 0;
  process.emit('SIGTERM', 'SIGTERM');
  assert.deepEqual(calls, []);
  child.emit('close', 0, null);
  if (process.platform !== 'win32') {
    // A real late signal must preserve the settled child status.
    process.kill(process.pid, 'SIGTERM');
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
`], consumer);

// Replace only the disposable installed payload, restoring it before native proofs.
const executableBackup = `${nativeExecutable}.backup`;
renameSync(nativeExecutable, executableBackup);
try {
  writeFileSync(nativeExecutable, process.platform === 'win32' ? 'invalid PE file' : '#!/seshat-missing-interpreter\n', {mode: 0o755});
  const spawnError = await runLauncher('spawn-error-json', ['check', '--json'], consumer, 2);
  assert.match(report(spawnError).result.error, /cannot start native payload/i);
  if (process.platform !== 'win32') {
    writeFileSync(nativeExecutable, '#!/bin/sh\nexit 23\n', {mode: 0o755});
    await runLauncher('ordinary-exit-23', [], consumer, 23);
    for (const signal of ['SIGKILL', 'SIGSEGV']) {
      writeFileSync(nativeExecutable, `#!/bin/sh\nulimit -c 0\nkill -${signal.slice(3)} $$\n`, {mode: 0o755});
      await runLauncher(`fatal-${signal.toLowerCase()}`, [], consumer, 128 + constants.signals[signal]);
    }

  }
} finally {
  rmSync(nativeExecutable, {force: true});
  renameSync(executableBackup, nativeExecutable);
}

// Exercise the installed launcher and the native cancellation report, including
// owned descendants and an unrelated process that must survive.
const signalProject = join(work, 'signal project 🎸');
const signalScratch = join(work, 'signal scratch');
const signalReady = join(work, 'signal-ready.json');
const signalStop = join(work, 'signal-stop');
const consoleReady = join(work, 'console-ready');
const consoleStdout = join(work, 'console.stdout');
const consoleStderr = join(work, 'console.stderr');
mkdirSync(signalProject);
mkdirSync(signalScratch);
writeFileSync(join(signalProject, 'package.json'), '{"type":"module"}\n');
writeFileSync(join(signalProject, 'subject.ts'), 'export const value = (input: number) => input >= 0;\n');
// Failure cleanup is independent of native supervision and never signals saved PIDs.
const fixtureCleanup = `setInterval(() => { if (existsSync(${JSON.stringify(signalStop)})) process.exit(0); }, 20); setTimeout(() => process.exit(0), 120_000);`;
writeFileSync(join(signalProject, 'hang.mjs'), [
  "import {test} from 'node:test';",
  "import {spawn} from 'node:child_process';",
  "import {existsSync, writeFileSync} from 'node:fs';",
  fixtureCleanup,
  `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify("const {existsSync} = require('node:fs');" + fixtureCleanup)}], {stdio: 'ignore'});`,
  `test('launcher cancellation', async () => { writeFileSync(${JSON.stringify(signalReady)}, JSON.stringify({cwd: process.cwd(), pid: process.pid, descendant: descendant.pid})); if (process.env.SESHAT_CONSOLE_READY) writeFileSync(process.env.SESHAT_CONSOLE_READY, 'ready\\n'); await new Promise(() => {}); });`,
].join('\n'));
const signalConfig = {
  source: {include: ['subject.ts']},
  capture: ['package.json', 'subject.ts', 'hang.mjs'],
  setups: [{
    name: 'node',
    runner: 'node',
    cwd: '.',
    timeoutMs: 30_000,
    test: [process.execPath, '--test', '--test-reporter={seshatReporter}', 'hang.mjs'],
    coverage: {
      command: [process.execPath, '-e', 'process.exit(0)'],
      report: 'coverage/final.json',
    },
  }],
};
const signalConfigPath = join(signalProject, 'seshat.json');
json(signalConfigPath, signalConfig);
const signalArguments = ['crap', '--config', signalConfigPath, '--scratch', signalScratch, '--json', '--no-progress'];
const consoleHelper = process.env.SESHAT_CONSOLE_HELPER_BINARY;
if (process.platform === 'win32') {
  assert.ok(consoleHelper && existsSync(consoleHelper),
    'SESHAT_CONSOLE_HELPER_BINARY must point to the built Windows console helper');
}

const routes = process.platform === 'win32' ? [
  {name: 'signal-lifecycle', signal: 'SIGBREAK', shim: true},
  {name: 'signal-ctrl-c', signal: 'SIGINT'},
] : [
  {name: 'signal-lifecycle', signal: 'SIGTERM'},
  {name: 'signal-int-launcher', signal: 'SIGINT'},
  {name: 'signal-term-group', signal: 'SIGTERM', group: true},
  {name: 'signal-int-group', signal: 'SIGINT', group: true},
];
const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {env, stdio: 'ignore'});
const sentinelClosed = new Promise(resolveExit => sentinel.once('close', resolveExit));
try {
  for (const route of routes) {
    rmSync(signalReady, {force: true});
    rmSync(signalStop, {force: true});
    rmSync(consoleReady, {force: true});
    const signalProgram = process.platform === 'win32' ? consoleHelper : process.execPath;
    const signalProgramArgs = process.platform === 'win32'
      ? [...(route.shim ? [] : ['--ctrl-c']), consoleReady, consoleStdout, consoleStderr,
        ...(route.shim ? [comspec, '/d', '/s', '/c', 'call', commandShim] : [process.execPath, launcher]),
        ...signalArguments]
      : [launcher, ...signalArguments];
    const signalChild = spawn(signalProgram, signalProgramArgs, {
      cwd: signalProject,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let signalStdout = '';
    let signalStderr = '';
    signalChild.stdout.on('data', bytes => { signalStdout += bytes; });
    signalChild.stderr.on('data', bytes => { signalStderr += bytes; });
    const signalClosed = new Promise((resolveExit, reject) => {
      signalChild.once('error', reject);
      signalChild.once('close', (code, signal) => resolveExit({code, signal}));
    });
    let signalExit;
    try {
      await waitFor(() => existsSync(signalReady), `${route.name} native test readiness`);
      const ready = read(signalReady);
      assert.ok(ready.cwd.includes('capture-'));
      if (process.platform !== 'win32') {
        const target = route.group ? -signalChild.pid : signalChild.pid;
        process.kill(target, route.signal);

      }
      await waitFor(() => signalChild.exitCode !== null || signalChild.signalCode !== null,
        `${route.name} cancellation exit`);
      signalExit = await signalClosed;
      assert.equal(signalExit.signal, null);
      const expectedSignal = process.platform === 'win32' ? 2 : constants.signals[route.signal];
      assert.equal(signalExit.code, process.platform === 'win32' ? 2 : 128 + expectedSignal, signalStderr);
      assert.equal(signalStderr, '');
      assert.equal(signalStdout.trim().split('\n').length, 1);
      const signalReport = JSON.parse(signalStdout);
      assert.equal(signalReport.schemaVersion, 1);
      assert.equal(signalReport.command, 'crap');
      assert.equal(signalReport.complete, false);
      assert.equal(signalReport.cancelled, true);
      assert.equal(signalReport.signal, expectedSignal);
      assert.ok(Array.isArray(signalReport.result.setups));
      await waitFor(() => readdirSync(signalScratch).length === 0, `${route.name} scratch cleanup`);
      await waitFor(() => !alive(ready.pid) && !alive(ready.descendant), `${route.name} child cleanup`);
      assert.ok(alive(sentinel.pid), `${route.name} killed an unrelated process`);
      evidence[route.name] = {
        status: signalExit.code,
        ms: 0,
        route: route.shim ? 'windows-console-helper/cmd-shim'
          : process.platform === 'win32' ? 'windows-console-helper/ctrl-c/node-launcher'
            : `node-launcher/${route.signal.toLowerCase()}${route.group ? '-group' : ''}`,
        stdout: signalStdout,
        stderr: signalStderr,
      };
      console.log(`${route.name}: exit ${signalExit.code}`);
    } finally {
      // Assert native cleanup above before allowing the fixtures to stop themselves.
      writeFileSync(signalStop, 'stop\n');
      try {
        if (existsSync(signalReady)) {
          const ready = read(signalReady);
          await waitFor(() => !alive(ready.pid) && !alive(ready.descendant),
            `${route.name} fixture fallback cleanup`);
        }
      } finally {
        if (!signalExit) {
          if (process.platform === 'win32') {
            spawnSync('taskkill.exe', ['/pid', String(signalChild.pid), '/t', '/f'], {stdio: 'ignore'});
          } else {
            try { process.kill(-signalChild.pid, 'SIGKILL'); } catch (error) {
              if (error.code !== 'ESRCH') throw error;
            }
          }
          await signalClosed;
        }
      }
    }
  }
} finally {
  sentinel.kill();
  await sentinelClosed;
}

const publicExamplesPath = resolve(process.env.SESHAT_EXAMPLES_OUTPUT ?? join(work, 'public-consumer-examples.json'));
const publicCli = process.platform === 'win32' ? commandShim : launcher;
// Debian supplies a read-only host-warmed cache because its namespace has no network.
const publicExamplesEnv = process.env.SESHAT_EXAMPLES_NPM_CACHE
  ? {...env, npm_config_cache: process.env.SESHAT_EXAMPLES_NPM_CACHE, npm_config_offline: 'true'}
  : env;
const publicExamples = await run('public-examples', process.execPath, [
  join(repo, 'examples/verify.mjs'), '--cli', publicCli, '--output', publicExamplesPath,
], consumer, 0, publicExamplesEnv, 600_000);
const publicExamplesReport = read(publicExamplesPath);
validatePublicExamples(publicExamplesReport, process.platform === 'win32' ? 'windows-npm-shim' : 'node-launcher');

// Keep the lockfile from the registry install, remove installed files, and make
// npm ci prove that its cache is sufficient while the registry is unavailable.
rmSync(join(consumer, 'node_modules'), {recursive: true, force: true});
const offline = await runNpm('offline-ci', [
  'ci', '--offline', ...commonNpmOptions, '--registry', 'http://127.0.0.1:9',
], consumer);
assert.match(offline.stdout + offline.stderr, /added|up to date|audited/i);
assert.equal((await run('version-after-ci', process.execPath, [
  join(consumer, 'node_modules/@binary-balance/seshat/bin/seshat.mjs'), '--version',
], consumer)).stdout, nativeVersion);

const result = {
  schemaVersion: 1,
  kind: 'seshat-release-npm-install',
  version,
  host: {platform: process.platform, architecture: process.arch},
  entryArchive: {
    path: entryArchive,
    name: entryArchiveManifest.name,
    version: entryArchiveManifest.version,
    sha256: sha256(entryArchiveBytes),
    bytes: entryArchiveBytes.length,
  },
  nativeArchive: {
    path: nativeArchive,
    name: nativeArchiveManifest.name,
    version: nativeArchiveManifest.version,
    sha256: sha256(nativeArchiveBytes),
    bytes: nativeArchiveBytes.length,
  },
  nativeNotices: {
    bytes: Buffer.byteLength(nativeNotices),
    hasCopyright: /\nCOPYRIGHT\n/.test(nativeNotices),
    hasUnlicense: /\nUNLICENSE\n/.test(nativeNotices),
  },
  installedEntry: rootInstalled,
  installedNative: nativeInstalled,
  build,
  publicExamples: {
    path: publicExamplesPath,
    cli: publicExamplesReport.cli,
    examples: Object.fromEntries(Object.entries(publicExamplesReport.examples).map(([name, value]) => [name, {
      sourceFiles: value.sourceFiles,
      workers: value.workers,
    }])),
    validation: publicExamplesReport.validation,
  },
  cachePrerequisite: 'registry-install populated the disposable npm cache before offline ci',
  checks: evidence,
};
const resultPath = proofOutput ?? join(work, 'result.json');
json(join(work, 'result.json'), result);
if (process.env.SESHAT_PROOF_OUTPUT) json(resultPath, result);
await new Promise(resolveServer => server.close(resolveServer));
console.log(`npm release package passed: ${Object.keys(evidence).length} checks. Results: ${resultPath}`);
