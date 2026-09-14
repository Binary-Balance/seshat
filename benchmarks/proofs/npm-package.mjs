// Install the release entry package and one native payload through a disposable
// loopback registry. This proves npm's platform selection without publishing.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  existsSync,
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
const archiveJson = path => {
  const result = spawnSync('tar', ['-xOf', path, 'package/package.json'], {encoding: 'utf8'});
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};
const archiveText = (path, name) => {
  const result = spawnSync('tar', ['-xOf', path, `package/${name}`], {
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
const nativeNotices = archiveText(nativeArchive, 'THIRD_PARTY_NOTICES.txt');
assert.match(nativeNotices, /\nCOPYRIGHT\n/);
assert.match(nativeNotices, /\nUNLICENSE\n/);
const version = entryArchiveManifest.version;
assert.equal(entryArchiveManifest.name, '@binary-balance/seshat');
assert.ok(nativeArchiveManifest.name);
assert.equal(nativeArchiveManifest.version, version);
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
const npm = process.env.PATH.split(delimiter).map(path => join(path, 'npm')).find(existsSync);
assert.ok(npm, 'npm must be installed');
symlinkSync(process.execPath, join(tools, 'node'));
symlinkSync(realpathSync(npm), join(tools, 'npm'));
if (process.platform !== 'win32') symlinkSync('/bin/sh', join(tools, 'sh'));
const env = {
  ...process.env,
  PATH: tools,
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

const commonNpmOptions = [
  '--ignore-scripts', '--no-audit', '--no-fund',
  '--cache', join(work, 'cache'),
  '--userconfig', join(work, 'user.npmrc'),
  '--globalconfig', join(work, 'global.npmrc'),
];
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const json = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const evidence = {};
async function run(name, command, args, cwd, status = 0, runEnv = env) {
  const started = performance.now();
  const child = spawn(command, args, {
    cwd,
    env: runEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', value => { stdout += value; });
  child.stderr.on('data', value => { stderr += value; });
  return await new Promise(resolveRun => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const completed = {...result, stdout, stderr};
      evidence[name] = {
        status: completed.status,
        ms: performance.now() - started,
        stdout,
        stderr,
      };
      assert.ifError(completed.error);
      assert.equal(completed.status, status, `${name}: ${stdout}${stderr}`);
      console.log(`${name}: exit ${completed.status}`);
      resolveRun(completed);
    };
    const timer = setTimeout(() => child.kill('SIGTERM'), 120_000);
    child.once('error', error => finish({error, status: null, signal: null}));
    child.once('close', (code, signal) => finish({error: null, status: code, signal}));
  });
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

const consumer = join(work, 'consumer 🎸 with spaces');
mkdirSync(consumer);
json(join(consumer, 'package.json'), {
  name: 'seshat-local-consumer',
  version: '0.0.0',
  private: true,
  scripts: {assurance: 'seshat'},
});
await run('registry-install', 'npm', [
  'install', '--save-dev', '--save-exact', `${entryArchiveManifest.name}@${version}`,
  ...commonNpmOptions, '--registry', registryUrl,
], consumer);

const rootInstalled = join(consumer, 'node_modules/@binary-balance/seshat');
const nativeInstalled = join(consumer, 'node_modules', targetForHost);
const launcher = join(rootInstalled, 'bin/seshat.mjs');
const npmBin = join(consumer, 'node_modules/.bin');
const npmBinEntries = readdirSync(npmBin).filter(name => name.startsWith('seshat'));
if (process.platform === 'win32') {
  assert.ok(npmBinEntries.includes('seshat.cmd'));
  const commandShim = readFileSync(join(npmBin, 'seshat.cmd'), 'utf8')
    .replaceAll('\\', '/').toLowerCase();
  assert.match(commandShim, /@binary-balance\/seshat\/bin\/seshat\.mjs/);
  assert.doesNotMatch(commandShim, /seshat-(linux|darwin|win32)/);
} else {
  assert.deepEqual(npmBinEntries, ['seshat']);
  assert.equal(realpathSync(join(npmBin, 'seshat')), realpathSync(launcher));
}
const installedManifest = read(join(rootInstalled, 'package.json'));
assert.equal(installedManifest.name, entryArchiveManifest.name);
assert.equal(installedManifest.version, version);
assert.deepEqual(installedManifest.optionalDependencies, entryArchiveManifest.optionalDependencies);
assert.equal(installedManifest.dependencies, undefined);
assert.equal(installedManifest.scripts, undefined);
assert.deepEqual(readdirSync(rootInstalled).sort(), ['LICENSE', 'README.md', 'bin', 'package.json'].sort());
const nativeManifest = read(join(nativeInstalled, 'package.json'));
assert.equal(nativeManifest.name, targetForHost);
assert.equal(nativeManifest.version, version);
assert.equal(nativeManifest.bin, undefined);
assert.deepEqual(nativeManifest.os, nativeArchiveManifest.os);
assert.deepEqual(nativeManifest.cpu, nativeArchiveManifest.cpu);
assert.deepEqual(nativeManifest.libc, nativeArchiveManifest.libc);
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
assert.equal(nativeVersion, `seshat ${version} (candidate)\n`);
const launcherVersion = (await run('launcher-version', process.execPath, [launcher, '--version'], consumer)).stdout;
assert.equal(launcherVersion, nativeVersion);
await run('npm-exec', 'npm', ['exec', '--offline', ...commonNpmOptions, '--', 'seshat', '--help'], consumer);
await run('package-script', 'npm', ['run', '--silent', 'assurance', '--', '--version'], consumer);

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
assert.match(argumentReport.result.error, /missing|configuration|no such file/i);
assert.equal(existsSync(shellMarker), false, 'launcher interpreted a user argument as shell input');

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

// The native CLI owns cancellation; this child proves the launcher forwards the
// signal and preserves its report, exit status and scratch cleanup.
const signalProject = join(work, 'signal project 🎸');
const signalScratch = join(work, 'signal scratch');
const signalReady = join(work, 'signal-ready.json');
mkdirSync(signalProject);
mkdirSync(signalScratch);
writeFileSync(join(signalProject, 'package.json'), '{"type":"module"}\n');
writeFileSync(join(signalProject, 'subject.ts'), 'export const value = (input: number) => input >= 0;\n');
writeFileSync(join(signalProject, 'hang.mjs'), [
  "import {test} from 'node:test';",
  "import {writeFileSync} from 'node:fs';",
  `test('launcher cancellation', async () => { writeFileSync(${JSON.stringify(signalReady)}, JSON.stringify({cwd: process.cwd(), pid: process.pid})); await new Promise(() => {}); });`,
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
const signalChild = spawn(process.execPath, [launcher, 'crap', '--config', signalConfigPath,
  '--scratch', signalScratch, '--json', '--no-progress'], {
  cwd: signalProject,
  env,
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
const waitFor = async (predicate, label) => {
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
};
let signalExit;
try {
  await waitFor(() => existsSync(signalReady), 'launcher native test readiness');
  const ready = read(signalReady);
  assert.ok(ready.cwd.includes('capture-'));
  signalChild.kill('SIGTERM');
  signalExit = await signalClosed;
  assert.equal(signalExit.signal, null);
  assert.equal(signalExit.code, process.platform === 'win32' ? 2 : 143);
  assert.equal(signalStderr, '');
  assert.equal(signalStdout.trim().split('\n').length, 1);
  const signalReport = JSON.parse(signalStdout);
  assert.equal(signalReport.schemaVersion, 1);
  assert.equal(signalReport.command, 'crap');
  assert.equal(signalReport.complete, false);
  assert.equal(signalReport.cancelled, true);
  assert.ok(Array.isArray(signalReport.result.setups));
  await waitFor(() => readdirSync(signalScratch).length === 0, 'launcher scratch cleanup');
  evidence['signal-lifecycle'] = {status: signalExit.code, ms: 0, stdout: signalStdout, stderr: signalStderr};
} finally {
  if (!signalExit && signalChild.exitCode === null) signalChild.kill('SIGKILL');
  if (!signalExit) signalExit = await signalClosed;
}

// Keep the lockfile from the registry install, remove installed files, and make
// npm ci prove that its cache is sufficient while the registry is unavailable.
rmSync(join(consumer, 'node_modules'), {recursive: true, force: true});
const offline = await run('offline-ci', 'npm', [
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
  entryArchive: {path: entryArchive, sha256: sha256(entryArchiveBytes), bytes: entryArchiveBytes.length},
  nativeArchive: {path: nativeArchive, sha256: sha256(nativeArchiveBytes), bytes: nativeArchiveBytes.length},
  nativeNotices: {
    bytes: Buffer.byteLength(nativeNotices),
    hasCopyright: /\nCOPYRIGHT\n/.test(nativeNotices),
    hasUnlicense: /\nUNLICENSE\n/.test(nativeNotices),
  },
  installedEntry: rootInstalled,
  installedNative: nativeInstalled,
  build,
  cachePrerequisite: 'registry-install populated the disposable npm cache before offline ci',
  checks: evidence,
};
const resultPath = process.env.SESHAT_PROOF_OUTPUT ?? join(work, 'result.json');
json(join(work, 'result.json'), result);
if (process.env.SESHAT_PROOF_OUTPUT) json(resultPath, result);
await new Promise(resolveServer => server.close(resolveServer));
console.log(`npm release package passed: ${Object.keys(evidence).length} checks. Results: ${resultPath}`);
