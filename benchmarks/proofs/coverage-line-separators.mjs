// Run with SESHAT_PROOF_BINARY pointing to a freshly built seshat-proofs binary.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import instrument from 'istanbul-lib-instrument';

const binary = resolve(process.env.SESHAT_PROOF_BINARY ?? 'crates/seshat/target/release/seshat-proofs');
const work = mkdtempSync(join(tmpdir(), 'seshat-coverage-lines-'));
try {
  for (const [name, separator, supported] of [
    ['LF', '\n', true], ['CRLF', '\r\n', true],
    ['U+2028', '\u2028', false], ['U+2029', '\u2029', false], ['CR', '\r', false],
  ]) {
    for (const prefix of ['', '/* 🎸 */ ']) {
      const path = join(work, 'subject.ts');
      const source = `function f() {${separator}${prefix}return 1;\nreturn 2; }\nconst outside = 3;\n// padding long enough to accept mapped columns\n`;
      writeFileSync(path, source);
      const tool = instrument.createInstrumenter();
      const context = {};
      runInNewContext(tool.instrumentSync(source, path) + '\nf();', context);
      const report = context.__coverage__;
      assert.deepEqual(Object.values(report[path].s), [1, 0, 1]);
      const coveragePath = join(work, 'coverage.json');
      writeFileSync(coveragePath, JSON.stringify(report));
      const child = spawnSync(binary, ['score', path, coveragePath], {
        encoding: 'utf8', timeout: 10000,
      });
      assert.ifError(child.error);
      const result = JSON.parse(child.stdout);
      assert.equal(result.complete, supported, `${name}: ${child.stdout}`);
      assert.equal(child.status, supported ? 0 : 2, child.stderr);
      const row = result.functions.find(row => row.name === 'f');
      assert.equal(row.status, supported ? 'measured' : 'unknown');
      assert.equal(row.coverage, supported ? 0.5 : null);
      assert.equal(row.crap, supported ? 1.125 : null);
      if (supported) {
        assert.equal(row.covered, 1);
        assert.equal(row.total, 2);
        assert.deepEqual(result.problems, []);
      } else {
        assert.ok(result.problems.includes('unsupported source line separator: coverage requires LF or CRLF'));
      }
    }
    console.log(`${name}: ${supported ? '50% coverage' : 'incomplete with diagnostic'}`);
  }
} finally {
  rmSync(work, {recursive: true, force: true});
}
