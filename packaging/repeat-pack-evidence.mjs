import assert from 'node:assert/strict';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {basename, join, resolve} from 'node:path';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

export function createPackWork(parent) {
  mkdirSync(parent, {recursive:true});
  const ownership = {directory:mkdtempSync(join(resolve(parent), 'npm-pack-')), token:randomUUID()};
  json(join(ownership.directory, 'ownership.json'), ownership);
  return ownership;
}

export function ownedPackWork(ownership) {
  assert.deepEqual(JSON.parse(readFileSync(join(ownership.directory, 'ownership.json'), 'utf8')), ownership,
    'pack work ownership record differs');
  return ownership.directory;
}

export function finishPack(ownership, result, output) {
  const work = ownedPackWork(ownership);
  const retained = join(work, 'helpers');
  mkdirSync(retained);
  result.helperHashes = {};
  for (const key of ['proofBinary', 'consoleHelper']) {
    if (!result[key]) continue;
    const original = readFileSync(result[key]);
    const path = join(retained, basename(result[key]));
    copyFileSync(result[key], path);
    assert.deepEqual(readFileSync(path), original, `retained ${key} differs`);
    result[key] = path;
    result.helperHashes[key] = sha256(original);
  }
  result.binaryPath = join(result.packageStage, 'bin', result.binaryName ?? 'seshat');
  assert.equal(sha256(readFileSync(result.binaryPath)), result.binary, 'retained CLI differs');
  assert.equal(sha256(readFileSync(result.tarball)), result.tarballSha256, 'retained archive differs');
  json(join(work, 'result.json'), result);
  if (output) json(resolve(output), result);
  // Only this invocation's completed build trees are disposable. Products stay at stable paths.
  for (const name of ['target', 'sysroot']) rmSync(join(work, name), {recursive:true, force:true});
}

export function retainRepeatFailure({failureDirectory, ownedWork, sourceCommit, host, toolchain, input, results, inspected, comparisons, error}) {
  const retainedRuns = ownedWork.map((ownership, index) => {
    const work = ownedPackWork(ownership);
    const manifest = join(work, 'result.json');
    const result = results[index] ?? (existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : null);
    let archive = null;
    if (result?.tarball && existsSync(result.tarball)) {
      assert.equal(resolve(result.tarball), join(work, basename(result.tarball)), 'archive is outside owned pack work');
      const file = `run-${index}.tgz`;
      copyFileSync(result.tarball, join(failureDirectory, file));
      const bytes = readFileSync(join(failureDirectory, file));
      archive = {file, sha256:sha256(bytes), bytes:bytes.length};
    }
    return {index, ownership, packResult:result, evidence:inspected[index] ?? null, archive};
  });
  const report = {
    schemaVersion:1, sourceCommit, host, toolchain, input, runs:retainedRuns, comparisons,
    validation:{passed:false, reason:error instanceof Error ? error.message : String(error)},
  };
  // Failed work may still have active descendants. Preserve exact ownership, never guess cleanup authority.
  json(join(failureDirectory, 'repeat-pack-failure.json'), report);
  return report;
}
