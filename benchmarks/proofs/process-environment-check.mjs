import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {killTree, nodeCommand, runProcess, rustFreeEnvironment} from './process.mjs';

const names = ['CARGO_HOME', 'RUSTUP_HOME', 'CARGO_TARGET_DIR', 'NODE_OPTIONS', 'SESHAT_MUTANT_ID'];
const ambient = Object.fromEntries(names.map(name => [name, `ambient-${name.toLowerCase()}`]));
const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
const script = `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify([...names, 'SESHAT_ENVIRONMENT_OVERRIDE'])}.map(name => [name, process.env[name]]))));setTimeout(() => {}, 50)`;

try {
  // Shared CLI fixtures keep their launcher attached, so Unix cleanup targets the retained leader.
  const child = spawn(nodeCommand, ['-e', "process.stdout.write('ready');setInterval(() => {}, 1000)"], {detached: false, stdio: ['ignore', 'pipe', 'ignore']});
  let closed = false;
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (status, signal) => { closed = true; resolve({status, signal}); });
  });
  try {
    const ready = once(child.stdout, 'data');
    await once(child, 'spawn');
    await ready;
    if (process.platform === 'win32') killTree(child.pid); else child.kill('SIGKILL');
    let timer;
    try {
      const stopped = await Promise.race([done, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('non-detached child did not stop after emergency cleanup')), 5000);
      })]);
      assert.notEqual(stopped.status, 0, `unexpected clean exit after forced stop (${stopped.signal})`);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    if (!closed) {
      if (process.platform === 'win32') killTree(child.pid); else child.kill('SIGKILL');
      await done.catch(() => {});
    }
  }

  // runProcess owns a detached group; keep its timeout path covered separately.
  const timedOut = await runProcess(nodeCommand, ['-e', 'setInterval(() => {}, 1000)'], process.cwd(), {}, 100);
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.overflow, false);
  assert.notEqual(timedOut.status, 0);

  Object.assign(process.env, ambient);
  const launch = extraEnv => runProcess(nodeCommand, ['-e', script], process.cwd(), extraEnv, 5000);
  const sanitized = await launch({...rustFreeEnvironment(), SESHAT_ENVIRONMENT_OVERRIDE: 'explicit'});
  assert.equal(sanitized.status, 0, sanitized.stderr);
  const observed = JSON.parse(sanitized.stdout);
  for (const name of names) assert.equal(observed[name], undefined, `${name} leaked into child`);
  assert.equal(observed.SESHAT_ENVIRONMENT_OVERRIDE, 'explicit');

  const overridden = await launch({
    ...rustFreeEnvironment(),
    NODE_OPTIONS: '--no-warnings',
    SESHAT_MUTANT_ID: 'explicit-mutant',
  });
  assert.equal(overridden.status, 0, overridden.stderr);
  const explicit = JSON.parse(overridden.stdout);
  assert.equal(explicit.NODE_OPTIONS, '--no-warnings');
  assert.equal(explicit.SESHAT_MUTANT_ID, 'explicit-mutant');
  for (const name of names.slice(0, 3)) assert.equal(explicit[name], undefined, `${name} leaked into child`);
  console.log('Process environment, non-detached cleanup and detached timeout regressions passed.');
} finally {
  for (const name of names) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
}
