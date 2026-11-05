import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

test('collector preserves old evidence and stops on a failed baseline', {skip: process.platform !== 'linux'}, () => {
  const root = mkdtempSync(join(tmpdir(), 'seshat-self-assessment-'));
  try {
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'rustc'), '#!/bin/sh\necho "rustc 1.98.1 (fixture)"\n', {mode: 0o755});
    writeFileSync(join(bin, 'cargo'), `#!/bin/sh
case "$1 $2" in
  'llvm-cov --version') echo 'cargo-llvm-cov 0.9.1';;
  'crap --version') echo 'cargo-crap 0.9.0';;
  'mutants --version') echo 'cargo-mutants 27.1.0';;
  'llvm-cov show-env') :;;
  'test --locked') echo 'controlled baseline failure'; exit 9;;
  *) echo 'unexpected later command'; exit 70;;
esac
`, {mode: 0o755});
    const invoke = output => spawnSync('bash', [join(dirname(fileURLToPath(import.meta.url)),
      'rust-self-assessment.sh'), output], {env: {...process.env, PATH: `${bin}:${process.env.PATH}`}, encoding: 'utf8'});
    const existing = join(root, 'existing');
    mkdirSync(existing);
    writeFileSync(join(existing, 'keep'), 'retained evidence');
    const refused = invoke(existing);
    assert.ifError(refused.error);
    assert.notEqual(refused.status, 0);
    assert.equal(readFileSync(join(existing, 'keep'), 'utf8'), 'retained evidence');
    const failed = join(root, 'failed');
    const result = invoke(failed);
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /controlled baseline failure/);
    assert.equal(existsSync(join(failed, 'evidence')), false);
    assert.equal(existsSync(join(failed, 'build.log')), false);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
