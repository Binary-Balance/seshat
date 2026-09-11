// Local standalone installation proof. Every extracted consumer is disposable.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
assert.ok(process.argv.length === 3 || process.argv.length === 4,
  'usage: node benchmarks/proofs/standalone.mjs <archive> [legacy proof binary]');
const archive = realpathSync(process.argv[2]);
assert.ok(statSync(archive).isFile());
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const archiveSha256 = hash(readFileSync(archive));
if (process.env.SESHAT_STANDALONE_SHA256) assert.equal(archiveSha256, process.env.SESHAT_STANDALONE_SHA256);
const legacy = realpathSync(process.argv[3] ?? process.env.SESHAT_PROOF_BINARY ?? '');
assert.ok(statSync(legacy).isFile());
mkdirSync(join(repo, 'work/assurance-proofs'), {recursive: true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/standalone-'));
const consumer = join(work, 'consumer 🎸');
mkdirSync(consumer);
const checks = {};
function run(name, command, args, env = process.env, status = 0) {
  const started = performance.now();
  const child = spawnSync(command, args, {cwd: repo, env, encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024});
  checks[name] = {status: child.status, ms: performance.now() - started, stdout: child.stdout, stderr: child.stderr};
  writeFileSync(join(work, 'checks.json'), JSON.stringify(checks, null, 2) + '\n');
  assert.ifError(child.error);
  assert.equal(child.status, status, child.stdout + child.stderr);
  return child;
}

const listing = run('archive-list', 'tar', ['-tzf', archive]).stdout.trim().split('\n').filter(Boolean).sort();
const files = ['BUILD.json', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.txt', 'bin/seshat', 'package.json'];
assert.deepEqual(listing, files.map(path => `package/${path}`).sort());
assert.ok(listing.every(path => !path.startsWith('/') && !path.split('/').includes('..')));
run('extract', 'tar', ['-xzf', archive, '-C', consumer, '--strip-components=1', '--no-same-owner']);
assert.ok(consumer.includes('🎸'));
const installed = join(consumer, 'bin/seshat');
const manifest = JSON.parse(readFileSync(join(consumer, 'package.json'), 'utf8'));
const build = JSON.parse(readFileSync(join(consumer, 'BUILD.json'), 'utf8'));
const binary = readFileSync(installed);
assert.ok(statSync(installed).mode & 0o111);
assert.ok(process.platform === 'linux' || process.platform === 'darwin');
assert.equal(manifest.os?.[0], process.platform);
assert.deepEqual(manifest.cpu, [process.arch]);
if (process.platform === 'linux') assert.deepEqual(manifest.libc, ['glibc']);
else assert.equal(manifest.libc, undefined);
if (process.arch === 'arm64') assert.equal(build.cpu, process.arch);
const expectedTarget = process.platform === 'darwin'
  ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
  : `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-gnu`;
assert.equal(build.target, expectedTarget);
if (process.platform === 'darwin') {
  assert.equal(build.minimumMacos, '15.0');
  assert.equal(build.deploymentTarget, '15.0');
}
const binarySha256 = hash(binary);
assert.equal(binarySha256, build.binarySha256);
if (process.env.SESHAT_BINARY_SHA256) assert.equal(binarySha256, process.env.SESHAT_BINARY_SHA256);
assert.equal(binary.length, build.binaryBytes);
assert.ok(readFileSync(join(consumer, 'LICENSE'), 'utf8').length);
assert.match(readFileSync(join(consumer, 'THIRD_PARTY_NOTICES.txt'), 'utf8'), /VoidZero/);

const tools = join(work, 'tools');
mkdirSync(tools);
symlinkSync(process.execPath, join(tools, 'node'));
symlinkSync('/bin/sh', join(tools, 'sh'));
const env = {...process.env, PATH: tools, SESHAT_CLI_BINARY: installed, SESHAT_PROOF_BINARY: legacy};
delete env.CARGO_HOME;
delete env.RUSTUP_HOME;
delete env.CARGO_TARGET_DIR;
for (const command of ['cargo', 'rustc']) assert.equal(spawnSync(command, ['--version'], {env}).error?.code, 'ENOENT');

const cli = run('installed-cli', process.execPath, [join(repo, 'benchmarks/proofs/cli.mjs')], env, 0);
const cliSummary = cli.stdout.match(/CLI passed: (\d+) scenarios plus legacy parity/);
assert.ok(cliSummary && Number(cliSummary[1]) === 43, cli.stdout);
const parallel = run('installed-parallel', process.execPath, [join(repo, 'benchmarks/proofs/parallel.mjs')],
  {...env, SESHAT_PARALLEL_CLI: '1'});
const parallelPath = parallel.stdout.match(/Parallel evidence: (.+)/)?.[1];
assert.ok(parallelPath);
const parallelChecks = JSON.parse(readFileSync(parallelPath, 'utf8'));
assert.equal(Object.keys(parallelChecks).length, 11);

const result = {
  archive,
  archiveSha256,
  archiveBytes: statSync(archive).size,
  installedBinary: installed,
  build,
  cliScenarios: Number(cliSummary[1]),
  parallelChecks,
  checks,
};
const resultPath = process.env.SESHAT_PROOF_OUTPUT ?? join(work, 'result.json');
writeFileSync(join(work, 'result.json'), JSON.stringify(result, null, 2) + '\n');
if (process.env.SESHAT_PROOF_OUTPUT) writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n');
console.log(`Standalone installed proof passed: ${result.cliScenarios} CLI scenarios and 11 parallel controls. Results: ${resultPath}`);
