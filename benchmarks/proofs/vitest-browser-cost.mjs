// Matched cost experiment for #293; this does not change runtime defaults.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {cpus, loadavg, platform, release} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {nodeCommand, runProcess} from './process.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '../..');
const {values} = parseArgs({options: {cli: {type: 'string'}, deps: {type: 'string'}, samples: {type: 'string', default: '3'}}});
assert.ok(values.cli, 'usage: node benchmarks/proofs/vitest-browser-cost.mjs --cli PATH [--deps DIR] [--samples 3]');
const samples = Number(values.samples);
assert.ok(Number.isInteger(samples) && samples > 0);
const cli = resolve(values.cli);
const parent = join(repo, 'work/assurance-proofs');
mkdirSync(parent, {recursive: true});
const work = mkdtempSync(join(parent, 'vitest-browser-cost-'));
const report = {version: 1, revision: process.env.SESHAT_COST_REVISION ?? null,
  proofSha256: Object.fromEntries(['vitest-browser-cost.mjs', 'vitest-browser-cost-reporter.mjs', 'vitest-browser-check.mjs']
    .map(name => [name, createHash('sha256').update(readFileSync(join(here, name))).digest('hex')])),
  cliSha256: createHash('sha256').update(readFileSync(cli)).digest('hex'),
  environment: {node: process.version, platform: platform(), release: release(), arch: process.arch,
    cpu: cpus()[0].model, cpus: cpus().length},
  samples, runs: []};
const save = () => writeFileSync(join(work, 'result.json'), JSON.stringify(report, null, 2) + '\n');
const signature = phase => phase.outcomes.map(({setups, executionMs, ...row}) => row);
let reference;

// Rotate browser and variant order to avoid giving one variant every early run.
for (let sample = 0; sample < samples; sample++) {
  for (const browser of sample % 2 ? ['firefox', 'chromium'] : ['chromium', 'firefox']) {
    const modes = ['default', 'cold', 'no-screenshots'];
    for (const mode of [...modes.slice(sample % 3), ...modes.slice(0, sample % 3)]) {
      const name = `${browser}-${mode}-${sample + 1}`;
      const args = [join(here, 'vitest-browser-check.mjs'), '--cli', cli, '--browser', browser, '--cost', mode,
        '--cases', mode === 'default' ? 'stack,workers,assertion,node-reference' : 'stack'];
      if (values.deps) args.push('--deps', resolve(values.deps));
      const loadBefore = loadavg();
      const startedAt = new Date().toISOString();
      const run = await runProcess(nodeCommand, args, repo, {}, 900000);
      writeFileSync(join(work, `${name}.log`), run.stdout + run.stderr);
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.equal(run.timedOut, false);
      assert.equal(run.overflow, false);
      const match = run.stdout.match(/vitest-browser-check: .*; ([^\r\n]+)/);
      assert.ok(match, 'proof did not report its evidence directory');
      const proof = join(repo, match[1]);
      const raw = JSON.parse(readFileSync(join(proof, 'result.json'), 'utf8'));
      const traces = readFileSync(join(proof, 'cache.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const row = {sample: sample + 1, browser, mode, startedAt, finishedAt: new Date().toISOString(),
        loadBefore, loadAfter: loadavg(), environment: raw.environment, cases: {}};
      for (const [name, {result, wallMs}] of Object.entries(raw.runs)) {
        assert.equal(result.complete, true);
        assert.equal(result.cleanupError ?? null, null);
        if (name === 'stack' || name === 'workers') {
          const actual = {mutation: signature(result.mutation), pseudoTesting: signature(result.pseudoTesting),
            sources: result.sources.map(source => ({path: source.path, result: source.result}))};
          reference ??= actual;
          assert.deepEqual(actual, reference, `${browser}/${mode}/${name}: assessment changed`);
        }
        const jobs = result.mutation.outcomes.flatMap(outcome => outcome.setups);
        const trace = traces.filter(trace => trace.case === name);
        assert.ok(trace.length > 0);
        const cache = trace.map(({id, before, after, screenshots, temporary}) => {
          const metadata = list => list.filter(file => file.metadata).map(file => ({path: file.path,
            modifiedMs: file.modifiedMs, hash: file.metadata.hash, configHash: file.metadata.configHash,
            optimized: Object.keys(file.metadata.optimized)}));
          const previous = metadata(before), next = metadata(after);
          return {id, beforeFiles: before.length, afterFiles: after.length,
            beforeConfigHashes: previous.map(file => file.configHash), afterConfigHashes: next.map(file => file.configHash),
            reused: next.length > 0 && JSON.stringify(previous) === JSON.stringify(next),
            newScreenshotFiles: screenshots.length, newScreenshotBytes: screenshots.reduce((sum, file) => sum + file.bytes, 0),
            temporaryFiles: temporary.length, temporaryBytes: temporary.reduce((sum, file) => sum + file.bytes, 0)};
        });
        if (mode === 'cold') assert.ok(cache.every(job => job.beforeFiles === 0));
        if (mode === 'no-screenshots') assert.ok(cache.every(job => job.newScreenshotFiles === 0));
        row.cases[name] = {wallMs, phaseTimings: result.phaseTimings,
          mutationWallMs: result.mutation.mutationWallMs, jobMs: jobs.map(job => job.ms),
          killed: result.mutation.killed, survived: result.mutation.survived,
          pseudoKilled: result.pseudoTesting.killed, pseudoSurvived: result.pseudoTesting.survived,
          cache, retries: trace.filter(job => job.id.endsWith('-retry')).length};
      }
      report.runs.push(row);
      save();
      // Retain raw proof reports and traces; disposable dependency copies are reproducible.
      for (const file of ['result.json', 'summary.json', 'cache.jsonl']) cpSync(join(proof, file), join(work, `${name}-${file}`));
      for (const directory of ['input', 'scratch', 'tmp']) rmSync(join(proof, directory), {recursive: true, force: true});
      console.log(`${name}: ${Math.round(row.cases.stack.wallMs)}ms; ${relative(repo, work)}`);
    }
  }
}
assert.equal(report.runs.length, samples * 6);
assert.deepEqual(readdirSync(work).filter(name => name.endsWith('.log')).length, samples * 6);
console.log(`vitest-browser-cost: ${report.runs.length} matched runs passed; ${relative(repo, work)}`);
