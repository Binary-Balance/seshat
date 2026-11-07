import './node-load-observer.test.mjs';
import './process.test.mjs';
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
      readFileSync() {
        return JSON.stringify({'module-guard': {outcomes: [{verdict: 'killed', evidence: {
          report: {node: '24.22.2', moduleFailures: [{}]},
        }}]}});
      },
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
          assert.equal(options.timeout, ['jest-expo-check','jest-node-selection'].includes(name) ? 1_800_000 : 600_000);
        }
        assert.ok(options.timeout <= 1_800_000, 'suite remains bounded');
        return {status: 0, stdout: '', stderr: ''};
      },
    });
    assert.deepEqual(calls, ['cli', 'parallel', 'node-load-failure', 'jest-hook-errors',
      'jest-check', 'jest-expo-check', 'vitest-check', 'jest-node-selection']);
    assert.equal(evidence.checks.length, calls.length);
    assert.ok(evidence.checks.every(check => check.passed));
    assert.deepEqual(JSON.parse(JSON.stringify(evidence.importFailureObserver)),
      {node: '24.22.2', state: 'active', verdict: 'killed'});
  });
}

for (const [name, node, verdict, moduleFailures] of [
  ['inactive observer', '24.22.2', 'execution-error', []],
  ['wrong runtime', '24.21.0', 'killed', [{}]],
]) {
  test(`compatibility fails for ${name} despite a successful child process`, () => {
    const evidence = {checks: []};
    const summaries = [];
    assert.throws(() => runInNewContext(suites, {
      assert, join, repo: dirname(here), output: '<output>', jestDeps: '<jest-deps>',
      payload: {binaryPath: '<binary>', tarball: '<archive>'}, env: {}, evidence,
      process: {platform: 'linux', execPath: '<node>', versions: {node: '24.22.2'}},
      console: {log() {}},
      spawnSync() { return {status: 0, stdout: '', stderr: ''}; },
      readFileSync() {
        return JSON.stringify({'module-guard': {outcomes: [{verdict, evidence: {
          report: {node, moduleFailures},
        }}]}});
      },
      writeFileSync(path, contents) {
        if (basename(path) === 'summary.json') summaries.push(JSON.parse(contents));
      },
    }), /must prove an active import-failure observer/);
    assert.equal(evidence.checks.at(-1).name, 'node-load-failure');
    assert.equal(evidence.checks.at(-1).passed, false);
    assert.equal(summaries.at(-1).checks.at(-1).passed, false);
  });
}
