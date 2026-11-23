import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {afterEach, mock, test} from 'node:test';
import {alive} from './liveness.mjs';

afterEach(() => {
  mock.restoreAll();
  syncBuiltinESMExports();
});

test('the current process is alive', () => {
  assert.equal(alive(process.pid), true);
});

if (process.platform === 'linux') {
  function statError(code) {
    mock.method(fs, 'readFileSync', () => {throw Object.assign(new Error(code), {code});});
    syncBuiltinESMExports();
  }

  test('an exiting Linux task can disappear during its stat read', () => {
    statError('ESRCH');
    const kill = mock.method(process, 'kill', () => {throw new Error('unexpected fallback');});
    assert.equal(alive(123), false);
    assert.equal(kill.mock.callCount(), 0);
  });

  for (const [code, expected] of [['ESRCH', false], ['EPERM', true], [null, true]]) {
    test(`missing proc entry retains the POSIX probe: ${code ?? 'success'}`, () => {
      statError('ENOENT');
      mock.method(process, 'kill', () => {
        if (code) throw Object.assign(new Error(code), {code});
        return true;
      });
      assert.equal(alive(123), expected);
    });
  }

  test('unexpected proc errors remain visible', () => {
    statError('EACCES');
    assert.throws(() => alive(123), {code:'EACCES'});
  });
}
