import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {retainRepeatFailure} from './repeat-pack-evidence.mjs';

const root = mkdtempSync(join(tmpdir(), 'seshat-repeat-pack-check-'));
try {
  const repo = join(root, 'repo');
  const packWork = join(repo, 'work', 'npm-pack-test');
  const failureDirectory = join(root, 'repeat-pack-failure');
  const results = [0, 1].map(index => {
    const stage = join(packWork, `stage-${index}`, 'package');
    mkdirSync(join(stage, 'bin'), {recursive:true});
    writeFileSync(join(stage, 'bin', 'seshat'), Buffer.from([index, 0x42]));
    writeFileSync(join(stage, 'BUILD.json'), JSON.stringify({binarySha256:`${index}`.repeat(64), binaryBytes:2}) + '\n');
    const tarball = join(packWork, `run-${index}.tgz`);
    execFileSync('tar', ['-czf', tarball, '-C', join(packWork, `stage-${index}`), 'package']);
    return {tarball, standalone:{path:tarball}, binary:`${index}`.repeat(64), binaryBytes:2};
  });
  const inspected = results.map((result, index) => ({
    binary:{sha256:`${index}`.repeat(64), bytes:2},
    build:{sha256:'b'.repeat(64), bytes:2},
    npmArchive:{sha256:'c'.repeat(64), bytes:1},
    standaloneArchive:{sha256:'c'.repeat(64), bytes:1},
    files:['BUILD.json', 'bin/seshat'],
  }));
  const comparisons = {
    binary:{hash:false, bytes:true, passed:false},
    build:{hash:true, bytes:true, passed:true},
    npmArchive:{hash:true, bytes:true, passed:true},
    standaloneArchive:{hash:true, bytes:true, passed:true},
  };
  const sourceArchives = results.map(result => readFileSync(result.tarball));
  const report = retainRepeatFailure({
    repo,
    failureDirectory,
    sourceCommit:'a'.repeat(40),
    host:{platform:'linux', arch:'x64'},
    toolchain:{node:'v24.20.0', npm:'11.0.0', rustc:'rustc 1.98.1', cargo:'cargo 1.98.1'},
    input:{mode:'--synthetic', archives:[]},
    results,
    inspected,
    comparisons,
    error:new Error('repeat pack outputs differ'),
  });
  assert.equal(report.validation.passed, false);
  assert.equal(report.comparisons.binary.passed, false);
  for (const index of results.keys()) {
    const retained = join(failureDirectory, `run-${index}.tgz`);
    assert.deepEqual(readFileSync(retained), sourceArchives[index]);
    const listing = execFileSync('tar', ['-tzf', retained], {encoding:'utf8'});
    assert.match(listing, /package\/bin\/seshat/);
    assert.match(listing, /package\/BUILD\.json/);
  }
  assert.equal(existsSync(packWork), false);
  assert.equal(existsSync(join(failureDirectory, 'repeat-pack-failure.json')), true);
  console.log('repeat-pack failure retention self-check passed');
} finally {
  rmSync(root, {recursive:true, force:true});
}
