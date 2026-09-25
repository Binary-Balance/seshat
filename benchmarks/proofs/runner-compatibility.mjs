// Reuse one native package to check a second Node runtime without rebuilding it.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
assert.ok(process.argv.length === 3 || process.argv.length === 4,
  'usage: node runner-compatibility.mjs PACKAGE_RESULT [JEST_DEPENDENCIES]');
assert.ok(['24.20.0', '24.21.0'].includes(process.versions.node));
const input = resolve(process.argv[2]);
const payload = JSON.parse(readFileSync(input, 'utf8'));
const output = join(dirname(input), `node-${process.versions.node}`);
const jestDeps = resolve(process.argv[3] ?? join(repo, 'benchmarks/proofs/fixtures/jest-expo'));
mkdirSync(output, {recursive: true});
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
assert.equal(hash(payload.binaryPath), payload.binary);
assert.equal(hash(payload.tarball), payload.tarballSha256);
const evidence = {
  node: process.versions.node, platform: process.platform, arch: process.arch,
  binarySha256: payload.binary, tarballSha256: payload.tarballSha256, checks: [],
};
const env = {...process.env, SESHAT_CLI_TARBALL: '',
  SESHAT_PROOF_BINARY: payload.proofBinary, SESHAT_PARALLEL_CLI: '1',
  ...(payload.consoleHelper ? {SESHAT_CONSOLE_HELPER_BINARY: payload.consoleHelper} : {})};
for (const [name, args] of [
  ['cli', []],
  ['parallel', []],
  ['node-load-failure', []],
  ['jest-expo-check', ['--tarball', payload.tarball, '--deps', jestDeps,
    '--cases', 'normal-1,assertion-kill,survivor,before-all,import-failure,test-timeout,hook-timeout']],
  ['vitest-check', ['--tarball', payload.tarball, '--deps', join(repo, 'benchmarks/proofs'),
    '--cases', 'stack,assertion,survived,before-all,import-error,timeout,hook-timeout']],
]) {
  console.log(`Node ${process.versions.node}: ${name}`);
  const child = spawnSync(process.execPath, [join(repo, 'benchmarks/proofs', `${name}.mjs`), ...args], {
    cwd: repo, env: {...env, SESHAT_CLI_BINARY: args.includes('--tarball') ? '' : payload.binaryPath,
      SESHAT_PROOF_OUTPUT: join(output, `${name}.json`)},
    encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024,
  });
  writeFileSync(join(output, `${name}.log`), (child.stdout + child.stderr).replaceAll(repo, '<repo>'));
  evidence.checks.push({name, passed: !child.error && child.status === 0});
  writeFileSync(join(output, 'summary.json'), JSON.stringify(evidence, null, 2) + '\n');
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stdout + child.stderr);
}
console.log(`Compatibility passed: ${output}`);
