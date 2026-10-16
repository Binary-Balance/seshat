// Synthetic compiler cost probe; no consuming-project inputs or dependencies.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const compiler = process.argv[2] || require.resolve('typescript/bin/tsc');
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const helper = join(repo, 'crates/seshat/src/execution/project/compiler-strictness.cjs');
const work = mkdtempSync(join(tmpdir(), 'seshat-inferred-any-cost-'));
const samples = [];
try {
  for (const files of [10, 500]) {
    const root = join(work, String(files));
    mkdirSync(root);
    const sources = [];
    let sourceBytes = 0;
    for (let index = 0; index < files; index++) {
      const source = Array.from({ length: 20 }, (_, id) =>
        `export function parse${id}(text: string) { const value = JSON.parse(text); return value.field; }\n`).join('');
      const name = `source-${index}.ts`;
      sources.push(name);
      sourceBytes += Buffer.byteLength(source);
      writeFileSync(join(root, name), source);
    }
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      strict: true, noEmit: true, skipLibCheck: true,
    }, files: sources }));
    for (let sample = -1; sample < 3; sample++) {
      for (const collect of sample % 2 ? [true, false] : [false, true]) {
        const context = join(root, 'context.json');
        const receipt = join(root, 'receipt.json');
        writeFileSync(context, JSON.stringify({ compiler, root, args: ['-p', '.'],
          ...(collect ? { sources } : {}) }));
        const started = performance.now();
        const child = spawnSync(process.execPath, ['-e',
          'require(process.argv[1]); console.log(JSON.stringify(process.resourceUsage()));',
          helper, context, receipt], { cwd: root, timeout: 60000, encoding: 'utf8' });
        const wallMs = performance.now() - started;
        assert.equal(child.status, 0, child.stderr);
        const result = JSON.parse(readFileSync(receipt, 'utf8'));
        assert.equal(result.state, 'known', result.error);
        if (collect) {
          assert.equal(result.inferredAny.state, 'known', result.inferredAny.error);
          assert.equal(result.inferredAny.sources.length, files);
          assert(result.inferredAny.sources.every(source => source.state === 'known' && source.locations.length === 60));
        }
        if (sample >= 0) samples.push({ files, functions: files * 20, sourceBytes, sample,
          mode: collect ? 'inferred-any' : 'metadata-only', wallMs,
          checkerMs: result.inferredAny?.ms ?? null,
          maxRssBytes: JSON.parse(child.stdout).maxRSS * 1024,
          compilerVersion: result.compilerVersion });
      }
    }
  }
  const report = { helperSha256: createHash('sha256').update(readFileSync(helper)).digest('hex'),
    environment: { node: process.version, platform: process.platform,
    arch: process.arch, cpu: cpus()[0]?.model }, warmups: 1, samples };
  mkdirSync(join(repo, 'work/issue134-validation'), { recursive: true });
  writeFileSync(join(repo, 'work/issue134-validation/compiler-cost.json'), JSON.stringify(report, null, 2) + '\n');
  for (const files of [10, 500]) for (const mode of ['metadata-only', 'inferred-any']) {
    const rows = samples.filter(sample => sample.files === files && sample.mode === mode);
    const median = key => rows.map(row => row[key]).sort((a, b) => a - b)[1];
    console.log(`${files} files, ${mode}: median ${median('wallMs').toFixed(1)}ms, RSS ${(median('maxRssBytes') / 1048576).toFixed(1)}MiB`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
