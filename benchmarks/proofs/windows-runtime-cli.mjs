// Focused native Windows CLI proof. Package installation and publication are separate slices.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const binary = resolve(
  process.env.SESHAT_CLI_BINARY ?? join(repo, 'benchmarks/rust/target/release/seshat.exe'),
);
const consoleHelper = resolve(
  process.env.SESHAT_CONSOLE_HELPER_BINARY ??
    join(repo, 'benchmarks/rust/target/release/windows-console-helper.exe'),
);
assert.ok(existsSync(binary), `Windows CLI binary is missing: ${binary}`);
assert.ok(existsSync(consoleHelper), `Windows console helper is missing: ${consoleHelper}`);

const work = mkdtempSync(join(tmpdir(), 'seshat-windows-runtime-'));
const project = join(work, 'input path 🎸');
const scratch = join(work, 'scratch');
mkdirSync(join(project, 'src'), {recursive: true});
mkdirSync(join(project, 'packages', 'rules'), {recursive: true});
mkdirSync(join(project, 'node_modules', '@fixture'), {recursive: true});
mkdirSync(join(project, 'tests'));
mkdirSync(scratch);

const originals = {
  'package.json': '{"type":"module","workspaces":["packages/*"]}\n',
  'src/subject.ts': 'export const value = (input: number) => input >= 0;\n',
  'packages/rules/package.json': '{"name":"@fixture/rules","type":"module","exports":"./index.ts"}\n',
  'packages/rules/index.ts': 'export const answer = () => 42;\n',
  'tests/check.mjs': [
    "import {test} from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import {value} from '../src/subject.ts';",
    "import {answer} from '@fixture/rules';",
    "test('native Windows capture', () => { assert.equal(value(1), true); assert.equal(answer(), 42); });",
  ].join(''),
};
for (const [relative, content] of Object.entries(originals)) {
  writeFileSync(join(project, relative), content);
}

// npm represents a Windows workspace package with a junction. The runtime must recognize it
// as a link and rewrite it into the private captured copy without falling back to a directory copy.
const workspaceLink = join(project, 'node_modules', '@fixture', 'rules');
symlinkSync(join(project, 'packages', 'rules'), workspaceLink, 'junction');

const configPath = join(project, 'seshat.json');
const config = {
  source: {include: ['src/**/*.ts']},
  capture: ['package.json', 'src', 'packages', 'node_modules', 'tests'],
  setups: [{
    name: 'node',
    runner: 'node',
    cwd: '.',
    timeoutMs: 30_000,
    typecheck: [
      process.execPath,
      join(repo, 'benchmarks/node_modules/typescript/bin/tsc'),
      '--ignoreConfig', '--strict', '--noEmit', '--skipLibCheck', 'src/subject.ts',
    ],
    test: [process.execPath, '--test', '--test-reporter={seshatReporter}', 'tests/check.mjs'],
    coverage: {
      command: [process.execPath, join(here, 'collect-node.mjs'), 'tests/check.mjs'],
      report: 'coverage/coverage-final.json',
    },
  }],
};
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
const evidencePath = resolve(
  process.env.SESHAT_WINDOWS_EVIDENCE_PATH ?? join(repo, 'windows-runtime-cli-evidence.json'),
);
const evidence = {
  schemaVersion: 1,
  kind: 'seshat-windows-runtime-cli',
  capturedAt: new Date().toISOString(),
  scenarios: {},
};

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function processAlive(pid) {
  const result = spawnSync('tasklist.exe', ['/fi', `PID eq ${pid}`], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024,
  });
  return result.status === 0 && new RegExp(`\\b${pid}\\b`).test(result.stdout ?? '');
}

function waitForExit(pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!processAlive(pid)) return true;
    sleep(20);
  }
  return false;
}

function stopSentinel(sentinel) {
  if (processAlive(sentinel.pid)) sentinel.kill();
  assert.ok(waitForExit(sentinel.pid), 'sentinel cleanup timed out');
}

function fixtureScript(scenario) {
  return `
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const receipt = {version: 1, executionId: process.env.SESHAT_EXECUTION_ID,
  node: process.versions.node, complete: true, passed: 1, failed: 0, errors: 0};
fs.writeFileSync(process.env.SESHAT_RECEIPT, JSON.stringify(receipt), {flag: 'wx'});
const ready = process.env.SESHAT_WINDOWS_READY ?? process.env.SESHAT_CONSOLE_READY;
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  detached: true, stdio: 'inherit', windowsHide: true,
});
fs.writeFileSync(process.env.SESHAT_WINDOWS_MARKER, String(child.pid), {flag: 'w'});
if (ready) fs.writeFileSync(ready, 'ready\\n', {flag: 'w'});
if (${JSON.stringify(scenario)}.startsWith('leader-exit')) process.exit(0);
if (${JSON.stringify(scenario)} === 'overflow') process.stdout.write('x'.repeat(5 * 1024 * 1024));
setInterval(() => {}, 1000);
`;
}

function scenarioConfig(scenario, timeoutMs) {
  return {
    ...config,
    setups: [{
      ...config.setups[0],
      timeoutMs,
      test: [process.execPath, '-e', fixtureScript(scenario)],
    }],
  };
}

function assertProjectUnchanged() {
  assert.deepEqual(readdirSync(scratch), [], 'captured scratch must be cleaned');
  for (const [relative, content] of Object.entries(originals)) {
    assert.equal(readFileSync(join(project, relative), 'utf8'), content, relative);
  }
  assert.ok(existsSync(workspaceLink), 'original workspace junction must survive');
}

function runCleanupScenario(name, timeoutMs, expectedState) {
  const marker = join(work, `${name}-descendant.pid`);
  writeFileSync(configPath, JSON.stringify(scenarioConfig(name, timeoutMs)) + '\n');
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  try {
    const result = spawnSync(binary, ['crap', '--config', configPath, '--scratch', scratch, '--json', '--no-progress'], {
      cwd: project,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
      env: {...process.env, SESHAT_WINDOWS_MARKER: marker},
    });
    assert.ifError(result.error);
    assert.equal(result.status, expectedState === 'passed' ? 0 : 2, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assertProjectUnchanged();
    const descendant = Number(readFileSync(marker, 'utf8'));
    assert.ok(waitForExit(descendant), `${name} descendant survived cleanup`);
    assert.equal(sentinel.exitCode, null, `${name} killed an unrelated sentinel`);
    assert.ok(processAlive(sentinel.pid), `${name} sentinel is no longer alive`);
    assert.equal(report.result.setups[0].baseline.state, expectedState);
    if (name === 'timeout') assert.equal(report.result.setups[0].baseline.timedOut, true);
    if (name === 'overflow') assert.equal(report.result.setups[0].baseline.overflow, true);
    return report;
  } finally {
    stopSentinel(sentinel);
    if (existsSync(marker)) {
      const descendant = Number(readFileSync(marker, 'utf8'));
      if (processAlive(descendant)) spawnSync('taskkill.exe', ['/pid', String(descendant), '/t', '/f']);
    }
  }
}

function runConsoleCancellation() {
  const marker = join(work, 'cancel-descendant.pid');
  const ready = join(work, 'cancel-ready');
  const childStdout = join(work, 'cancel-cli.stdout');
  const childStderr = join(work, 'cancel-cli.stderr');
  writeFileSync(configPath, JSON.stringify(scenarioConfig('cancel', 30_000)) + '\n');
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  try {
    const result = spawnSync(
      consoleHelper,
      [ready, childStdout, childStderr, binary, 'crap', '--config', configPath, '--scratch', scratch, '--json', '--no-progress'],
      {
        cwd: project,
        encoding: 'utf8',
        timeout: 60_000,
        maxBuffer: 16 * 1024 * 1024,
        env: {...process.env, SESHAT_WINDOWS_MARKER: marker},
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.equal(report.cancelled, true, result.stdout);
    assert.equal(report.signal, 2, result.stdout);
    assert.equal(report.result.setups[0].baseline.state, 'cancelled', result.stdout);
    assertProjectUnchanged();
    const descendant = Number(readFileSync(marker, 'utf8'));
    assert.ok(waitForExit(descendant), 'console cancellation left descendant alive');
    assert.equal(sentinel.exitCode, null, 'console cancellation killed an unrelated sentinel');
    assert.ok(processAlive(sentinel.pid), 'console cancellation sentinel is no longer alive');
    return report;
  } finally {
    stopSentinel(sentinel);
    if (existsSync(marker)) {
      const descendant = Number(readFileSync(marker, 'utf8'));
      if (processAlive(descendant)) spawnSync('taskkill.exe', ['/pid', String(descendant), '/t', '/f']);
    }
  }
}

try {
  const result = spawnSync(
    binary,
    ['check', '--config', configPath, '--scratch', scratch, '--json', '--no-progress'],
    {cwd: project, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024},
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.complete, true, JSON.stringify(report));
  assert.deepEqual(report.scope.files, ['src/subject.ts']);
  assert.ok(report.result.jobsAttempted >= 3);
  assert.deepEqual(readdirSync(scratch), [], 'captured scratch must be cleaned');
  for (const [relative, content] of Object.entries(originals)) {
    assert.equal(readFileSync(join(project, relative), 'utf8'), content, relative);
  }
  assert.ok(existsSync(workspaceLink), 'original workspace junction must survive');
  evidence.scenarios.baseline = report;
  evidence.scenarios.timeout = runCleanupScenario('timeout', 100, 'timed-out');
  evidence.scenarios.overflow = runCleanupScenario('overflow', 30_000, 'execution-error');
  evidence.scenarios.leaderExit = runCleanupScenario('leader-exit', 30_000, 'passed');
  evidence.scenarios.leaderExitRepeat = runCleanupScenario('leader-exit-repeat', 30_000, 'passed');
  evidence.scenarios.consoleCancellation = runConsoleCancellation();
  evidence.validation = {passed: true};
  console.log('Windows native lifecycle proof passed: timeout, overflow, leader exit, repeated spawn, console cancellation, descendant cleanup and sentinel survival');
  console.log('Windows native CLI proof passed: junction capture, Unicode/space paths, Node/TypeScript jobs, coverage and cleanup');
} catch (error) {
  evidence.validation = {passed: false, error: String(error)};
  throw error;
} finally {
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  rmSync(work, {recursive: true, force: true});
}
