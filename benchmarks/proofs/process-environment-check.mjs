import assert from 'node:assert/strict';
import {nodeCommand, runProcess, rustFreeEnvironment} from './process.mjs';

const names = ['CARGO_HOME', 'RUSTUP_HOME', 'CARGO_TARGET_DIR', 'NODE_OPTIONS', 'SESHAT_MUTANT_ID'];
const ambient = Object.fromEntries(names.map(name => [name, `ambient-${name.toLowerCase()}`]));
const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
const script = `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify([...names, 'SESHAT_ENVIRONMENT_OVERRIDE'])}.map(name => [name, process.env[name]]))));setTimeout(() => {}, 50)`;

Object.assign(process.env, ambient);
try {
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
  console.log('Process environment launch regression passed.');
} finally {
  for (const name of names) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
}
