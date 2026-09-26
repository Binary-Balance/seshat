import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {writeNodeWorkspace, nodeWorkspaceSeshatConfig, NODE_WORKSPACE_EXPECTED} from '../proofs/node-workspace-fixture.mjs';

const [binaryJson, work, dependencies, output] = process.argv.slice(2);
const binaries = JSON.parse(binaryJson);
const project = join(work, 'project');
const scratch = join(work, 'scratch');
mkdirSync(project, {recursive: true}); mkdirSync(scratch);
writeNodeWorkspace(project);
// An ordinary captured asset tree exercises worker copying without changing source scope.
mkdirSync(join(project, 'assets'));
const asset = 'fixture\n'.repeat(16384);
for (let i = 0; i < 100; i++) writeFileSync(join(project, `assets/${i}.txt`), asset);
const originals = ['src/compare.ts', 'packages/rules/index.ts'].map(path => [path, readFileSync(join(project, path))]);
const runs = [];
let semanticReference;
const conditions = Object.keys(binaries).flatMap(lto => [1, 2].flatMap(workers => ['replace', 'switch'].map(strategy => ({lto, workers, strategy}))));
for (let sample = 0; sample <= 3; sample++) {
  for (const condition of sample % 2 ? [...conditions].reverse() : conditions) {
    const {lto, workers, strategy} = condition;
    const config = nodeWorkspaceSeshatConfig({collector:join(dependencies, 'benchmarks/proofs/collect-node.mjs'), compiler:join(dependencies, 'benchmarks/node_modules/typescript/bin/tsc'), nodeCommand:process.execPath, workers});
    config.capture.push('assets');
    writeFileSync(join(project, 'seshat.json'), JSON.stringify(config));
    const start = performance.now();
    const result = spawnSync(binaries[lto], ['check', '--config', join(project, 'seshat.json'), '--scratch', scratch, '--json', '--no-progress', ...(strategy === 'switch' ? ['--experimental-switching'] : [])], {encoding:'utf8', timeout:60000});
    const wallMs = performance.now() - start;
    assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.complete, true); assert.equal(report.cancelled, false);
    assert.deepEqual(report.scope.files, ['packages/rules/index.ts', 'src/compare.ts']);
    assert.equal(report.result.mutation.score, 100);
    assert.equal(report.result.mutation.completed, 2);
    const outcomes = report.result.mutation.outcomes.map(({id,localId,offset,path,original,replacement,verdict}) => ({id,localId,offset,path,original,replacement,verdict}));
    assert.deepEqual(outcomes, NODE_WORKSPACE_EXPECTED.mutants);
    for (const source of report.result.sources) {
      for (const row of source.result.functions) {
        assert.equal(row.status, 'measured'); assert.equal(row.covered, 1); assert.equal(row.total, 1); assert.equal(row.crap, 1);
      }
    }
    const semantic = {scope:report.scope, sources:report.result.sources, outcomes};
    if (semanticReference) assert.deepEqual(semantic, semanticReference);
    else semanticReference = semantic;
    assert.deepEqual(readdirSync(scratch), []);
    for (const [path, bytes] of originals) assert.deepEqual(readFileSync(join(project, path)), bytes);
    const mutation = report.result.mutation;
    runs.push({...condition, phase: sample ? 'measured':'warmup', sample, wallMs,
      timings:report.timings, phases:report.result.phaseTimings,
      mutation:Object.fromEntries(Object.entries(mutation).filter(([key]) => key.endsWith('Ms'))),
      originalRunnerJobs:report.result.setups.map(({typecheck,baseline,coverage}) => ({typecheckMs:typecheck.ms,baselineMs:baseline.ms,coverageMs:coverage.ms})),
      mutationOutcomes:mutation.outcomes,
    });
  }
}
let evidence = JSON.stringify({fixture:{assetFiles:100, assetBytes:100*Buffer.byteLength(asset), sourceFiles:2, mutants:2}, semantic:semanticReference, semanticSha256:createHash('sha256').update(JSON.stringify(semanticReference)).digest('hex'), runs}, null, 2);
for (const [path, label] of [[work,'<work>'], [dependencies,'<dependencies>'], [process.execPath,'<node>']]) evidence = evidence.replaceAll(path, label);
writeFileSync(output, evidence + '\n');
