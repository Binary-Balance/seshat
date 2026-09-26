// Cancel only disposable proof sessions and verify their owned children and scratch are gone.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {alive} from './liveness.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const windows = process.platform === 'win32';
const binary = resolve(process.env.SESHAT_PROOF_BINARY ?? join(repo, 'crates/seshat/target/release/seshat-proofs'));
assert.ok(existsSync(binary), 'Proof executable is required: ' + binary);
const helper = process.env.SESHAT_CONSOLE_HELPER_BINARY;
if (windows) assert.ok(helper && existsSync(helper), 'Windows console helper is required');
const work = mkdtempSync(join(tmpdir(), 'seshat-execute-cancellation-'));
const input = join(work, 'input');
mkdirSync(input);
const source = 'export const adult = (age: number) => age >= 18;\nexport const initial = 2 < 3;\n';
writeFileSync(join(input, 'subject.ts'), source);
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

// External markers survive scratch cleanup. A blocked job ignores ordinary signals and owns
// a descendant, so a cancelled report alone cannot make this proof pass.
writeFileSync(join(input, 'job.cjs'), `
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const [marker, role, target, ordinal] = process.argv.slice(2);
process.on('SIGINT', () => {});
process.on('SIGTERM', () => {});
process.on('SIGBREAK', () => {});
if (role === 'descendant') {
  fs.writeFileSync(marker + '.descendant.tmp', String(process.pid));
  fs.renameSync(marker + '.descendant.tmp', marker + '.descendant');
  setInterval(() => {}, 1000);
} else {
  const calls = fs.existsSync(marker + '.calls') ? JSON.parse(fs.readFileSync(marker + '.calls')) : [];
  const call = {role, id: Number(process.env.SESHAT_MUTANT_ID)};
  const occurrence = calls.filter(c => c.role === role).length;
  calls.push(call);
  fs.writeFileSync(marker + '.calls', JSON.stringify(calls));
  if (role === target && occurrence === Number(ordinal)) {
    fs.writeFileSync(marker + '.leader', String(process.pid));
    spawn(process.execPath, [__filename, marker, 'descendant'], {stdio: 'inherit'});
    const timer = setInterval(() => {
      if (!fs.existsSync(marker + '.descendant')) return;
      fs.writeFileSync(marker + '.ready', 'ready');
      if (process.env.SESHAT_CONSOLE_READY) fs.writeFileSync(process.env.SESHAT_CONSOLE_READY, 'ready');
      clearInterval(timer);
      setInterval(() => {}, 1000);
    }, 10);
  } else if (role === 'test') {
    fs.writeFileSync(process.env.SESHAT_RECEIPT, JSON.stringify({complete: true, passed: 1, failed: 0, errors: 0, timeouts: 0}));
  }
}
`);

async function until(predicate, label, timeout = 10_000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  throw Error('Timed out waiting for ' + label);
}

const cases = [
  ['replace', 'original-typecheck', 'typecheck', 0],
  ['replace', 'original-build', 'build', 0],
  ['replace', 'original-baseline', 'test', 0],
  ['switch', 'prepared-build', 'build', 1],
  ['switch', 'prepared-baseline', 'test', 1],
  ['replace', 'mutant-build', 'build', 2],
  ['replace', 'mutant-test', 'test', 2],
  ['switch', 'mutant-test', 'test', 3],
];
const results = {};
const signals = windows ? ['CTRL_C', 'CTRL_BREAK'] : ['SIGINT', 'SIGTERM'];
for (const signal of signals) for (const [strategy, phase, target, ordinal] of cases) {
  const name = `${signal}-${strategy}-${phase}`;
  const marker = join(work, name);
  const scratch = marker + '-scratch';
  mkdirSync(scratch);
  const command = role => [process.execPath, '@ROOT@/job.cjs', marker, role, target, String(ordinal)];
  const config = {template: input, scratch, source: 'subject.ts', runner: 'observed', limit: 4,
    timeoutMs: 60_000, typecheck: command('typecheck'), build: command('build'), test: command('test')};
  json(marker + '.json', config);
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'});
  const sentinelDone = new Promise(resolve => sentinel.once('close', resolve));
  const args = ['execute', marker + '.json', strategy];
  const child = spawn(windows ? helper : binary, windows ? [
    ...(signal === 'CTRL_C' ? ['--ctrl-c'] : []), marker + '.console-ready',
    marker + '.stdout', marker + '.stderr', binary, ...args,
  ] : args, {stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '', stderr = '', exit;
  child.stdout.on('data', data => stdout += data);
  child.stderr.on('data', data => stderr += data);
  const done = new Promise(resolve => {
    child.once('error', error => {stderr += String(error); exit = {code: null}; resolve();});
    child.once('close', (code, signal) => {exit = {code, signal}; resolve();});
  });
  try {
    await until(() => existsSync(marker + '.ready') || exit, 'blocked job readiness', 30_000);
    assert.ok(existsSync(marker + '.ready'), 'proof exited before readiness: ' + stderr + stdout);
    const calls = read(marker + '.calls');
    if (!windows) child.kill(signal);
    await until(() => exit, 'cancelled proof exit', windows ? 40_000 : 10_000);
    const leader = Number(readFileSync(marker + '.leader', 'utf8'));
    const descendant = Number(readFileSync(marker + '.descendant', 'utf8'));
    await until(() => !alive(leader) && !alive(descendant), 'owned process cleanup');
    assert.deepEqual(readdirSync(scratch), [], 'cancelled proof left scratch files');
    assert.equal(readFileSync(join(input, 'subject.ts'), 'utf8'), source);
    assert.ok(alive(sentinel.pid), 'cleanup killed an unrelated sentinel');
    assert.deepEqual(read(marker + '.calls'), calls, 'another job started after cancellation');
    assert.equal(exit.code, windows ? 2 : signal === 'SIGINT' ? 130 : 143, stderr);
    const report = JSON.parse(stdout);
    assert.equal(report.complete, false);
    assert.equal(report.cancelled, true);
    assert.equal(report.signal, windows || signal === 'SIGINT' ? 2 : 15);
    assert.equal(report.score ?? null, null);
    if (phase.startsWith('mutant-')) {
      assert.deepEqual(report.outcomes.map(o => o.verdict), ['survived', 'cancelled', 'not-run', 'not-run']);
      assert.equal(report.outcomes[0].evidence.state, 'passed');
      assert.equal(report.outcomes[1].evidence.state, 'cancelled');
      assert.equal(report.survived, 1);
    } else {
      assert.equal(report.phase, phase);
      assert.equal(report.evidence.state, 'cancelled');
    }
    results[name] = {exit, complete: report.complete, cancelled: report.cancelled,
      verdicts: report.outcomes?.map(o => o.verdict), calls, cleanup: true};
    console.log(name + ': passed');
  } finally {
    if (!exit) {
      if (windows) spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f']);
      else child.kill('SIGKILL');
    }
    await done;
    // Failure cleanup targets only this fixture's recorded children.
    for (const role of ['leader', 'descendant']) {
      if (!existsSync(marker + '.' + role)) continue;
      const pid = Number(readFileSync(marker + '.' + role, 'utf8'));
      assert.ok(Number.isInteger(pid) && pid > 1, 'invalid fixture PID');
      if (alive(pid)) {
        if (windows) spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f']);
        else process.kill(pid, 'SIGKILL');
      }
    }
    sentinel.kill('SIGKILL');
    await sentinelDone;
  }
}
results.completed = true;
const output = process.env.SESHAT_PROOF_OUTPUT ?? join(work, 'result.json');
json(output, results);
console.log('Proof execute cancellation evidence: ' + output);
