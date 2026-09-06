// Same mutants and checks as run.mjs, without a separate build process.
import assert from 'node:assert/strict';
import {copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const binary = join(repo, 'benchmarks/rust/target/release/seshat-proofs');
const modules = join(here, 'node_modules');
const tsRoot = join(repo, 'benchmarks/node_modules/typescript');
const scratch = join(repo, 'work/assurance-proofs');
mkdirSync(scratch, {recursive:true});
const work = mkdtempSync(join(scratch, 'direct-'));
const samples = Number(process.env.SESHAT_PROOF_SAMPLES ?? 3);
assert.ok(Number.isInteger(samples) && samples >= 1 && samples <= 7);
const json = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const originalHash = hash(join(here, 'mutation-subject.tsx'));
const expected = Array.from({length:20}, (_, id) => [id, [12,17].includes(id) ? 'survived' : 'killed']);
const setups = {};

for (const runner of ['node','jest','vitest']) {
  const project = join(work, runner);
  mkdirSync(project);
  // Node's built-in loader accepts .ts, not .tsx. This mutation fixture has no JSX.
  const source = runner === 'node' ? 'subject.ts' : 'subject.tsx';
  copyFileSync(join(here, 'mutation-subject.tsx'), join(project, source));
  copyFileSync(join(here, 'checks.cjs'), join(project, 'checks.cjs'));
  json(join(project, 'package.json'), {private:true, type:runner === 'node' ? 'module' : 'commonjs'});
  const failSetup = `if (process.env.SESHAT_PROOF_SCENARIO === 'setup-error' && Number(process.env.SESHAT_MUTANT_ID) >= 0) throw Error('controlled setup failure');\n`;
  let test;
  if (runner === 'node') {
    writeFileSync(join(project, 'checks.node.mjs'), `import {test} from 'node:test';\nimport * as subject from './subject.ts';\nimport checks from './checks.cjs';\n${failSetup}test('mutation', () => checks.mutation(subject));\n`);
    test = [process.execPath, '--test', `--test-reporter=${join(here,'node-reporter.mjs')}`, '@ROOT@/checks.node.mjs'];
  } else if (runner === 'vitest') {
    writeFileSync(join(project, 'checks.vitest.mjs'), `import {test} from ${JSON.stringify(join(modules,'vitest/dist/index.js'))};\nimport * as subject from './subject.tsx';\nimport checks from './checks.cjs';\n${failSetup}test('mutation', () => checks.mutation(subject));\n`);
    writeFileSync(join(project, 'vitest.config.mjs'), `export default {test:{include:['checks.vitest.mjs']}};\n`);
    test = [process.execPath, join(modules,'vitest/vitest.mjs'), 'run', '--config', '@ROOT@/vitest.config.mjs', '--reporter=json', '--outputFile=@ROOT@/receipt.json', '--maxWorkers=1', '--no-file-parallelism'];
  } else {
    writeFileSync(join(project, 'checks.jest.cjs'), `${failSetup}const subject = require('./subject.tsx');\ntest('mutation', () => require('./checks.cjs').mutation(subject));\n`);
    // Let Jest cache transformations by source content inside this disposable session.
    writeFileSync(join(project, 'transform.cjs'), `module.exports = {process(source, fileName) { const ts = require(${JSON.stringify(join(tsRoot,'lib/typescript.js'))}); return {code:ts.transpileModule(source, {fileName, compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS}}).outputText}; }};\n`);
    writeFileSync(join(project, 'jest.config.cjs'), `module.exports = {rootDir:__dirname, testEnvironment:'node', testMatch:['**/checks.jest.cjs'], transform:{'^.+\\.tsx?$':'<rootDir>/transform.cjs'}, cacheDirectory:'<rootDir>/.jest-cache'};\n`);
    test = [process.execPath, join(modules,'jest/bin/jest.js'), '--config', '@ROOT@/jest.config.cjs', '--runInBand', '--json', '--outputFile=@ROOT@/receipt.json'];
  }
  setups[runner] = {template:project, scratch:work, source, runner, test, timeoutMs:10000,
    typecheck:[process.execPath, join(tsRoot,'bin/tsc'), '--ignoreConfig', '--strict', '--noEmit', '--skipLibCheck', '--target','es2022', `@ROOT@/${source}`]};
}

function execute(config, strategy) {
  const path = join(work, 'execution.json');
  json(path, config);
  const start = performance.now();
  const child = spawnSync(binary, ['execute',path,strategy], {encoding:'utf8', timeout:300000, maxBuffer:8*1024*1024});
  assert.ifError(child.error);
  const wallMs = performance.now() - start;
  const result = JSON.parse(child.stdout);
  assert.equal(child.status, result.complete ? 0 : 2, child.stderr + child.stdout);
  return {wallMs, ...result};
}

const versions = Object.fromEntries(['jest','vitest'].map(name => [name, JSON.parse(readFileSync(join(modules,name,'package.json'),'utf8')).version]));
const results = {environment:{node:process.version, platform:process.platform, arch:process.arch, typescript:JSON.parse(readFileSync(join(tsRoot,'package.json'),'utf8')).version, tools:versions}, work, sourceHash:originalHash, mutation:[], negativeChecks:[]};
for (let sample=0; sample<samples; sample++) {
  // Rotate runner order too; no two measured executions overlap.
  const runners = ['node','jest','vitest'];
  for (const runner of [...runners.slice(sample%3), ...runners.slice(0,sample%3)]) {
    for (const strategy of sample%2 ? ['switch','replace'] : ['replace','switch']) {
      const result = execute(setups[runner], strategy);
      assert.equal(result.complete,true,JSON.stringify(result));
      assert.equal(result.builds,0);
      assert.equal(result.typecheck.state,'passed');
      assert.equal(result.baseline.state,'passed');
      if (strategy==='switch') assert.equal(result.preparedBaseline.state,'passed');
      assert.deepEqual(result.outcomes.map(({id,verdict})=>[id,verdict]),expected);
      results.mutation.push({sample,...result});
      console.log(`${runner}/${strategy} sample ${sample+1}: ${Math.round(result.wallMs)}ms, typecheck ${Math.round(result.typecheck.ms)}ms, 18 killed, 2 survived, zero builds`);
    }
  }
}

const invalid = join(work,'invalid-types');
cpSync(setups.node.template,invalid,{recursive:true});
writeFileSync(join(invalid,'subject.ts'),readFileSync(join(invalid,'subject.ts'),'utf8')+'\nconst invalid: number = "not a number";\n');
for (const strategy of ['replace','switch']) {
  const failed = execute({...setups.node,template:invalid},strategy);
  assert.equal(failed.complete,false);
  assert.equal(failed.phase,'original-typecheck');
  assert.match(failed.evidence.diagnostic,/TS2322/);
  assert.equal(failed.outcomes,undefined);
  results.negativeChecks.push({scenario:'invalid-original-types',strategy,...failed});
  for (const scenario of ['setup-error','timeout']) {
    const failed = execute({...setups.node,scenario,limit:1,timeoutMs:5000},strategy);
    assert.equal(failed.complete,false);
    assert.equal(failed.outcomes[0].verdict,scenario==='timeout'?'timed-out':'execution-error');
    assert.equal(failed.score,null);
    results.negativeChecks.push({scenario,...failed});
  }
}
assert.equal(hash(join(here,'mutation-subject.tsx')),originalHash);
for (const config of Object.values(setups)) assert.equal(hash(join(config.template,config.source)),originalHash);
assert.equal(readdirSync(work).filter(p=>p.startsWith('session-')).length,0);
results.sourcePreserved = true;
results.sessionCleanup = true;
const destination = resolve(process.env.SESHAT_PROOF_OUTPUT ?? join(repo,'outputs/direct-load-proofs.json'));
json(destination,results);
console.log(`Results: ${destination}`);
