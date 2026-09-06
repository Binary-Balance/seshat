import {lstatSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, dirname, join} from 'node:path';

function loadFailures() {
  if (!process.env.SESHAT_LOAD_CONTEXT) return [];
  try {
    const context = JSON.parse(readFileSync(process.env.SESHAT_LOAD_CONTEXT, 'utf8'));
    const receipt = process.env.SESHAT_RECEIPT;
    return readdirSync(dirname(receipt)).filter(name => name.startsWith(`${basename(receipt)}.load-`)).flatMap(name => {
      const path = join(dirname(receipt), name), info = lstatSync(path);
      if (!info.isFile() || info.nlink !== 1 || info.size > 16384) return [];
      const proof = JSON.parse(readFileSync(path, 'utf8'));
      return proof.version === 1 && proof.executionId === process.env.SESHAT_EXECUTION_ID
        && proof.executionId === context.executionId && proof.source === context.source
        && typeof proof.entry === 'string' && Number.isInteger(proof.line) && Number.isInteger(proof.column)
        && context.sites.some(([sl,sc,el,ec]) => (proof.line > sl || proof.line === sl && proof.column >= sc)
          && (proof.line < el || proof.line === el && proof.column < ec)) ? [proof] : [];
    });
  } catch { return []; }
}

export default async function* reporter(events) {
  let passed = 0, failed = 0, errors = 0;
  let summary;
  const moduleFailures = [];
  for await (const event of events) {
    // Preserve load-failure diagnostics and let the supervisor bound test output.
    if (event.type === 'test:stdout' || event.type === 'test:stderr') yield event.data.message;
    if (event.type === 'test:summary' && event.data.file === undefined) summary = event.data;
    if (event.type === 'test:pass' && event.data.details.type !== 'suite') passed++;
    if (event.type === 'test:fail') {
      const error = event.data.details.error;
      // A failed describe() repeats its children's failures; it is not a crashed setup.
      if (event.data.details.type === 'suite' && error.failureType === 'subtestsFailed') continue;
      // Node uses testCodeFailure for a crashed file too; its exitCode is process evidence.
      if (error.failureType === 'testCodeFailure' && error.exitCode === undefined) failed++;
      else {
        const proof = error.failureType === 'testCodeFailure' && error.exitCode === 1 && !error.signal
          ? loadFailures().filter(proof => proof.entry === event.data.file) : [];
        if (proof.length === 1) { failed++; moduleFailures.push(proof[0]); }
        else errors++;
      }
    }
  }
  const complete = summary !== undefined && (summary.success || failed + errors > 0);
  writeFileSync(process.env.SESHAT_RECEIPT, JSON.stringify({version:1, executionId:process.env.SESHAT_EXECUTION_ID, node:process.versions.node, complete, passed, failed, errors, moduleFailures}));
}
