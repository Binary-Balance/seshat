import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPackWork, finishPack, ownedPackWork, retainRepeatFailure} from './repeat-pack-evidence.mjs';

const tarCommand = process.platform === 'win32' ? 'tar.exe' : 'tar';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = mkdtempSync(join(tmpdir(), 'seshat-repeat-pack-check-'));
const common = {sourceCommit:'a'.repeat(40), host:{platform:process.platform}, toolchain:{node:process.version}, input:{mode:'synthetic'}, inspected:[], comparisons:null};
function fixture() {
  const ownership = createPackWork(join(root, 'work'));
  const work = ownership.directory;
  const stage = join(work, 'package');
  mkdirSync(join(stage, 'bin'), {recursive:true});
  mkdirSync(join(work, 'target'));
  mkdirSync(join(work, 'sysroot'));
  const bytes = Buffer.from('synthetic CLI');
  writeFileSync(join(stage, 'bin/seshat'), bytes);
  writeFileSync(join(stage, 'BUILD.json'), '{}');
  const proofBinary = join(work, 'target/seshat-proofs');
  const consoleHelper = join(work, 'target/windows-console-helper.exe');
  writeFileSync(proofBinary, 'proof helper');
  writeFileSync(consoleHelper, 'console helper');
  const tarball = join(work, 'package.tgz');
  execFileSync(tarCommand, ['-czf', tarball, '-C', work, 'package']);
  return {ownership, result:{packageStage:stage, proofBinary, consoleHelper, binary:hash(bytes), tarball, tarballSha256:hash(readFileSync(tarball))}};
}
try {
  const unrelated = createPackWork(join(root, 'work'));
  mkdirSync(join(unrelated.directory, 'target'));
  writeFileSync(join(unrelated.directory, 'target/active'), 'leave active work alone');
  const completed = fixture();
  const output = join(root, 'result.json');
  finishPack(completed.ownership, completed.result, output);
  assert.equal(existsSync(join(completed.ownership.directory, 'target')), false);
  assert.equal(existsSync(join(completed.ownership.directory, 'sysroot')), false);
  const retained = JSON.parse(readFileSync(output));
  assert.equal(readFileSync(retained.proofBinary, 'utf8'), 'proof helper');
  assert.equal(readFileSync(retained.consoleHelper, 'utf8'), 'console helper');
  assert.equal(hash(readFileSync(retained.proofBinary)), retained.helperHashes.proofBinary);
  assert.equal(hash(readFileSync(retained.binaryPath)), retained.binary);
  assert.ok(existsSync(retained.tarball));

  const invalid = fixture();
  assert.throws(() => finishPack({...invalid.ownership, token:'not-the-owner'}, invalid.result), /ownership record differs/);
  assert.ok(existsSync(join(invalid.ownership.directory, 'target')));
  const unwritable = fixture();
  assert.throws(() => finishPack(unwritable.ownership, unwritable.result, join(root, 'missing/result.json')), /ENOENT/);
  assert.ok(existsSync(join(unwritable.ownership.directory, 'target')), 'failed manifest retention must prevent cleanup');

  if (process.platform === 'linux' && process.arch === 'x64') {
    const early = createPackWork(join(root, 'work'));
    const resultPath = join(root, 'early-result.json');
    const failed = spawnSync(process.execPath, [fileURLToPath(new URL('./pack.mjs', import.meta.url)), join(root, 'missing-archives')], {
      encoding:'utf8', env:{...process.env, PATH:'', SESHAT_PACK_OWNERSHIP:JSON.stringify(early), SESHAT_PACK_RESULT:resultPath},
    });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /rustc/);
    assert.deepEqual(JSON.parse(readFileSync(`${resultPath}.work.json`)), early);
    assert.equal(existsSync(resultPath), false);
    assert.ok(existsSync(early.directory), 'early pack failure must preserve its recorded work');
  }

  const attempts = [];
  for (let index = 0; index < 2; index++) {
    const failureDirectory = mkdtempSync(join(root, 'attempt-'));
    attempts.push(failureDirectory);
    const early = createPackWork(join(root, 'work'));
    mkdirSync(join(early.directory, 'target'));
    writeFileSync(join(early.directory, 'target/partial'), 'possibly active');
    const ownedWork = [completed.ownership, early];
    const record = join(failureDirectory, 'owned-work.json');
    writeFileSync(record, JSON.stringify({attempt:failureDirectory, ownedWork}));
    // A child can fail or die before writing result.json. The parent's exact record survives.
    const failed = spawnSync(process.execPath, ['-e', index ? "process.kill(process.pid, 'SIGTERM')" : "throw Error('before result.json')"], {encoding:'utf8'});
    assert.ok(failed.status !== 0 || failed.signal);
    writeFileSync(join(failureDirectory, 'pack-1.log'), failed.stderr ?? '');
    const report = retainRepeatFailure({...common, failureDirectory, ownedWork, results:[retained], error:new Error(index ? 'interrupted' : 'before result.json')});
    assert.equal(report.runs[1].packResult, null);
    assert.deepEqual(report.runs[1].ownership, early);
    assert.deepEqual(JSON.parse(readFileSync(record)).ownedWork, ownedWork);
    assert.ok(existsSync(join(early.directory, 'target/partial')), 'potentially active failed work must remain');
    const archive = join(failureDirectory, report.runs[0].archive.file);
    assert.equal(hash(readFileSync(archive)), retained.tarballSha256);
    assert.match(execFileSync(tarCommand, ['-tzf', archive], {encoding:'utf8'}), /package\/bin\/seshat/);
    assert.ok(existsSync(join(failureDirectory, 'repeat-pack-failure.json')));
  }
  assert.notEqual(attempts[0], attempts[1]);
  assert.match(readFileSync(join(attempts[0], 'repeat-pack-failure.json'), 'utf8'), /before result.json/);
  assert.equal(ownedPackWork(unrelated), unrelated.directory);
  assert.equal(readFileSync(join(unrelated.directory, 'target/active'), 'utf8'), 'leave active work alone');
  console.log('repeat-pack success, early/interrupted failure, repeated failure and ownership checks passed');
} finally {
  rmSync(root, {recursive:true, force:true});
}
