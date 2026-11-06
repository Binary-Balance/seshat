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
const [major, minor] = process.versions.node.split('.').map(Number);
assert.ok(major === 24 && minor >= 20);
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
  ['jest-hook-errors', []],
  ['jest-expo-check', ['--tarball', payload.tarball, '--deps', jestDeps,
    '--cases', 'normal-1,assertion-kill,expect-assertions,assertion-error,survivor,before-all,automatic-cleanup,mixed-load-hook,import-failure,test-timeout,hook-timeout,before-all-timeout']],
  ['vitest-check', ['--tarball', payload.tarball, '--deps', join(repo, 'benchmarks/proofs'),
    '--cases', 'stack,assertion,survived,before-all,import-error,timeout,hook-timeout']],
  ['jest-node-selection', ['--cli', payload.binaryPath, '--deps', jestDeps,
    '--cases', 'normal,parallel,cleanup,empty,filter,changed,reset,late-delete']],
]) {
  console.log(`Node ${process.versions.node}: ${name}`);
  // Jest on Intel macOS and twenty Windows cancellation checks can exceed ten minutes.
  const longSuite = ['jest-expo-check', 'jest-node-selection'].includes(name)
    || (name === 'parallel' && process.platform === 'win32');
  const timeoutMs = longSuite ? 1_800_000 : 600_000;
  const child = spawnSync(process.execPath, [join(repo, 'benchmarks/proofs', `${name}.mjs`), ...args], {
    cwd: repo, env: {...env, SESHAT_CLI_BINARY: args.includes('--tarball') ? '' : payload.binaryPath,
      SESHAT_PROOF_OUTPUT: join(output, `${name}.json`)},
    encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024,
  });
  writeFileSync(join(output, `${name}.log`), (child.stdout + child.stderr).replaceAll(repo, '<repo>'));
  let passed = !child.error && child.status === 0;
  if (name === 'node-load-failure' && passed) {
    const proof = JSON.parse(readFileSync(join(output, `${name}.json`), 'utf8'));
    const guard = proof['module-guard'].outcomes[0];
    evidence.importFailureObserver = {
      node: guard.evidence.report.node,
      state: guard.evidence.report.moduleFailures.length === 1 ? 'active' : 'inactive',
      verdict: guard.verdict,
    };
    passed = evidence.importFailureObserver.node === process.versions.node
      && evidence.importFailureObserver.state === 'active' && guard.verdict === 'killed';
  }
  evidence.checks.push({name, passed});
  writeFileSync(join(output, 'summary.json'), JSON.stringify(evidence, null, 2) + '\n');
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.ok(passed, 'latest supported Node must prove an active import-failure observer');
}
console.log(`Compatibility passed: ${output}`);
