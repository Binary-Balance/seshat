import {copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {basename, dirname, join, resolve} from 'node:path';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function cleanupPackWork(repo, result) {
  if (typeof result?.tarball !== 'string') return;
  const directory = resolve(dirname(result.tarball));
  if (dirname(directory) !== resolve(join(repo, 'work')) || !basename(directory).startsWith('npm-pack-')) return;
  rmSync(directory, {recursive:true, force:true});
}

export function retainRepeatFailure({repo, failureDirectory, sourceCommit, host, toolchain, input, results, inspected, comparisons, error}) {
  mkdirSync(failureDirectory, {recursive:true});
  const retainedRuns = results.map((result, index) => {
    if (typeof result?.tarball !== 'string' || !existsSync(result.tarball)) {
      return {index, packResult: result ?? null, evidence: inspected[index] ?? null, archive: null};
    }
    const archive = join(failureDirectory, `run-${index}.tgz`);
    copyFileSync(result.tarball, archive);
    const bytes = readFileSync(archive);
    return {
      index,
      packResult: result,
      evidence: inspected[index] ?? null,
      archive: {file:basename(archive), sha256:sha256(bytes), bytes:bytes.length},
    };
  });
  const report = {
    schemaVersion:1,
    sourceCommit,
    host,
    toolchain,
    input,
    runs:retainedRuns,
    comparisons,
    validation:{passed:false, reason:error instanceof Error ? error.message : String(error)},
  };
  // Keep the small npm payloads and metadata report, then discard each packer's large target tree.
  writeFileSync(join(failureDirectory, 'repeat-pack-failure.json'), JSON.stringify(report, null, 2) + '\n');
  for (const result of results) cleanupPackWork(repo, result);
  return report;
}
