// Pause the real generated fixture after file creation to expose partial receipts.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const directory = mkdtempSync(join(tmpdir(), 'seshat-readiness-'));
const signalReady = join(directory, 'ready.json');
const signalStop = join(directory, 'stop');
const releaseWrite = join(directory, 'release-write');
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'npm-package.mjs'), 'utf8');
const fixture = source.slice(source.indexOf('const fixtureCleanup ='), source.indexOf('const signalConfig ='));
assert.ok(fixture.startsWith('const fixtureCleanup ='));
new Function('writeFileSync', 'join', 'signalProject', 'signalStop', 'signalReady', fixture)(
  writeFileSync, join, directory, signalStop, signalReady,
);
const preload = join(directory, 'pause-write.mjs');
writeFileSync(preload, `
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const original = fs.writeFileSync;
fs.writeFileSync = (path, ...args) => {
  if (String(path).startsWith(${JSON.stringify(signalReady)})) {
    fs.closeSync(fs.openSync(path, 'w'));
    fs.writeSync(1, 'readiness-write-opened\\n');
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(${JSON.stringify(releaseWrite)}) && Date.now() < deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  return original(path, ...args);
};
syncBuiltinESMExports();
`);
const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, join(directory, 'hang.mjs')], {
  cwd: directory, stdio: ['ignore', 'pipe', 'pipe'],
});
const closed = new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
const deadline = Date.now() + 5000;
const waitFor = async predicate => {
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'fixture did not reach readiness');
    await new Promise(done => setTimeout(done, 5));
  }
};
let output = '';
child.stdout.on('data', bytes => { output += bytes; });
try {
  await waitFor(() => output.includes('readiness-write-opened'));
  assert.equal(existsSync(signalReady), false, 'readiness became visible before its JSON was written');
  writeFileSync(releaseWrite, 'continue');
  await waitFor(() => existsSync(signalReady));
  const ready = JSON.parse(readFileSync(signalReady, 'utf8'));
  assert.equal(ready.cwd, directory);
  assert.equal(ready.pid, child.pid);
  assert.ok(ready.descendant > 0);
  console.log('Readiness receipt is absent during writing and complete when visible');
} finally {
  writeFileSync(releaseWrite, 'continue');
  writeFileSync(signalStop, 'stop');
  await closed;
  rmSync(directory, {recursive: true, force: true});
}
