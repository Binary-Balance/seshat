// Generate real Istanbul mappings, including controls for nearby syntax.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import instrument from 'istanbul-lib-instrument';

const binary = resolve(process.env.SESHAT_PROOF_BINARY ?? 'crates/seshat/target/release/seshat-proofs');
const work = mkdtempSync(join(tmpdir(), 'seshat-statement-starts-'));
try {
  for (const [name, source, totals] of [
    ['label', 'function f() { outer: for (let i = 0; i < 1; i++) { break outer; } }', [4]],
    ['debugger', 'function f() { debugger; }', [1]],
    ['block', 'function f() { { return 1; } }', [1]],
    ['class', 'function f() { class C { method() { return 1; } } return new C().method(); }', [1, 1]],
    ['export-default-expression', 'export default (function f() { return 1; })();', [1]],
  ]) {
    const path = join(work, `${name}.ts`);
    const coveragePath = join(work, 'coverage.json');
    writeFileSync(path, source);
    const tool = instrument.createInstrumenter();
    tool.instrumentSync(source, path);
    // The provider's initial zero counters describe instrumented, unexecuted code.
    const file = tool.lastFileCoverage();
    const score = () => {
      writeFileSync(coveragePath, JSON.stringify({[path]: file}));
      const child = spawnSync(binary, ['score', path, coveragePath], {
        encoding: 'utf8', timeout: 10000,
      });
      assert.ifError(child.error);
      const result = JSON.parse(child.stdout);
      assert.equal(child.status, result.complete ? 0 : 2, child.stderr);
      return result;
    };
    const result = score();
    assert.equal(result.complete, true, `${name}: ${JSON.stringify(result)}`);
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.functions.map(row => row.total), totals);
    assert.ok(result.functions.every(row => row.status === 'measured' && row.coverage === 0));

    // Moving a real mapping one character inside its token must remain invalid.
    const first = Object.values(file.statementMap)[0];
    first.start.column++;
    const invalid = score();
    assert.equal(invalid.complete, false, name);
    assert.ok(invalid.problems.includes(
      `coverage is not mapped to an executable statement start: ${first.start.column}`));
    assert.ok(invalid.functions.every(row => row.coverage === null && row.crap === null));
    console.log(`${name}: valid mappings accepted; interior coordinate rejected`);
  }
} finally {
  rmSync(work, {recursive: true, force: true});
}
