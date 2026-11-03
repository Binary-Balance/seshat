import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {basename, dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'runner-compatibility.mjs'), 'utf8');
// Exercise the real wrapper with elapsed suite times instead of waiting ten minutes.
const suites = source.slice(source.indexOf('for (const [name, args]'), source.lastIndexOf('\nconsole.log('));
assert.match(suites, /spawnSync\(/);

for (const platform of ['win32', 'linux', 'darwin']) {
  test(`${platform} compatibility budgets allow the full parallel proof`, () => {
    const evidence = {checks: []};
    const calls = [];
    runInNewContext(suites, {
      assert, join, repo: dirname(here), output: '<output>', jestDeps: '<jest-deps>',
      payload: {binaryPath: '<binary>', tarball: '<archive>'}, env: {}, evidence,
      process: {platform, execPath: '<node>', versions: {node: '24.22.2'}},
      console: {log() {}}, writeFileSync() {},
      spawnSync(command, args, options) {
        const name = basename(args[0], '.mjs');
        calls.push(name);
        // A healthy Windows run passed 19/20 cancellation checks before its 600 s cutoff.
        const elapsedMs = platform === 'win32' && name === 'parallel' ? 610_000 : 1_000;
        if (options.timeout < elapsedMs) {
          return {status: null, stdout: '', stderr: '',
            error: Object.assign(new Error('spawnSync ETIMEDOUT'), {code: 'ETIMEDOUT'})};
        }
        if (name !== 'parallel' || platform !== 'win32') {
          assert.equal(options.timeout, name === 'jest-expo-check' ? 1_800_000 : 600_000);
        }
        assert.ok(options.timeout <= 1_800_000, 'suite remains bounded');
        return {status: 0, stdout: '', stderr: ''};
      },
    });
    assert.deepEqual(calls, ['cli', 'parallel', 'node-load-failure', 'jest-hook-errors',
      'jest-expo-check', 'vitest-check']);
    assert.equal(evidence.checks.length, calls.length);
    assert.ok(evidence.checks.every(check => check.passed));
  });
}
