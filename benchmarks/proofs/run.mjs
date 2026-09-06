// Throwaway architecture proofs. Generated projects stay under ignored work/.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, readdirSync, statSync} from 'node:fs';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const binary = join(repo, 'benchmarks/rust/target/release/seshat-proofs');
const scratch = join(repo, 'work/assurance-proofs');
mkdirSync(scratch, {recursive: true});
const work = mkdtempSync(join(scratch, 'run-'));
const modules = join(here, 'node_modules');
const jest = join(modules, 'jest/bin/jest.js');
const vitest = join(modules, 'vitest/vitest.mjs');
const c8 = join(modules, 'c8/bin/c8.js');
const compiler = join(here, 'compile.mjs');
const nodeReporter = join(here, 'node-reporter.mjs');
const samples = Number(process.env.SESHAT_PROOF_SAMPLES ?? 3);
assert.ok(Number.isInteger(samples) && samples >= 1 && samples <= 7);
const json = (p, value) => writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
function invoke(command, args, options = {}) {
  const start = performance.now();
  const child = spawnSync(command, args, {encoding: 'utf8', timeout: 300000, maxBuffer: 8*1024*1024, ...options});
  assert.ifError(child.error);
  return {status: child.status, wallMs: performance.now()-start, stdout: child.stdout, stderr: child.stderr};
}
function native(args) {
  const child = invoke(binary, args);
  let result;
  try { result = JSON.parse(child.stdout); } catch { throw Error(child.stderr + child.stdout); }
  return {...child, data: result};
}
function template(kind) {
  const project = join(work, kind);
  mkdirSync(project);
  copyFileSync(join(here, `${kind}-subject.tsx`), join(project, 'subject.tsx'));
  copyFileSync(join(here, 'checks.cjs'), join(project, 'checks.cjs'));
  json(join(project, 'package.json'), {private: true, type: 'commonjs'});
  const setupError = `if (process.env.SESHAT_PROOF_SCENARIO === 'setup-error' && Number(process.env.SESHAT_MUTANT_ID) >= 0) throw Error('controlled setup failure');\n`;
  writeFileSync(join(project, 'checks.node.cjs'), setupError + `const subject=require('./subject.cjs'); require('node:test')('${kind}', () => require('./checks.cjs').${kind}(subject));\n`);
  writeFileSync(join(project, 'checks.jest.cjs'), setupError + `const subject=require('./subject.cjs'); test('${kind}', () => require('./checks.cjs').${kind}(subject));\n`);
  const importSubject = kind==='coverage' ? `import * as subject from './subject.tsx';` : `import subject from './subject.cjs';`;
  writeFileSync(join(project, 'checks.vitest.mjs'), `import {test} from ${JSON.stringify(join(modules, 'vitest/dist/index.js'))};\nimport checks from './checks.cjs';\n${importSubject}\n${setupError}test('${kind}', () => checks.${kind}(subject));\n`);
  writeFileSync(join(project, 'jest.config.cjs'), `module.exports = {rootDir:__dirname, testEnvironment:'node', testMatch:['**/checks.jest.cjs'], coverageProvider:'babel', collectCoverageFrom:['subject.cjs'], coverageReporters:['json'], coverageDirectory:'coverage-jest'};\n`);
  writeFileSync(join(project, 'vitest.config.mjs'), `export default {test:{include:['checks.vitest.mjs'], coverage:{provider:'v8', include:['subject.tsx'], excludeAfterRemap:false, reporter:['json'], reportsDirectory:'coverage-vitest'}}};\n`);
  return project;
}
const commands = {
  node: [process.execPath, '--test', `--test-reporter=${nodeReporter}`, '@ROOT@/checks.node.cjs'],
  jest: [process.execPath, jest, '--config', '@ROOT@/jest.config.cjs', '--runInBand', '--json', '--outputFile=@ROOT@/receipt.json'],
  vitest: [process.execPath, vitest, 'run', '--config', '@ROOT@/vitest.config.mjs', '--reporter=json', '--outputFile=@ROOT@/receipt.json', '--maxWorkers=1', '--no-file-parallelism'],
};
const versions = Object.fromEntries(['c8','jest','vitest','@vitest/coverage-v8'].map(name => [name, JSON.parse(readFileSync(join(modules,name,'package.json'),'utf8')).version]));
const results = {environment: {node:process.version, platform:process.platform, arch:process.arch, tools:versions}, work,
  coverage: {}, negativeChecks: {}, mutation: [], binaryBytes: statSync(binary).size};
const coverageProject = template('coverage');
const mutationProject = template('mutation');
const coverageSource = join(coverageProject, 'subject.tsx');
const originalMutationHash = createHash('sha256').update(readFileSync(join(mutationProject,'subject.tsx'))).digest('hex');
const build = invoke(process.execPath, [compiler, coverageSource, join(coverageProject,'subject.cjs')]);
assert.equal(build.status,0,build.stderr);
const facts = native(['inspect',coverageSource]);
assert.equal(facts.status,0,JSON.stringify(facts.data));
const named = Object.fromEntries(facts.data.scopes.map(s => [s.name,s]));
for (const [name, expected] of Object.entries({covered:2,partial:2,never:1,empty:1,defaults:4,outer:2,inner:2,containingClass:1})) {
  assert.equal(named[name]?.complexity,expected,`complexity: ${name}`);
}
assert.deepEqual(facts.data.scopes.filter(s => s.implicit).map(s=>s.complexity),[2,2]);
console.log('Hand-checked complexity passed, including optional/default and class scopes.');

for (const runner of ['node','jest','vitest']) {
  let command = commands[runner].map(s=>s.replaceAll('@ROOT@',coverageProject));
  if (runner==='node') command = [process.execPath,c8,'--reporter=json','--reports-dir=coverage-node','--include=subject.cjs',...command];
  else command.push('--coverage');
  const run = invoke(command[0],command.slice(1),{cwd:coverageProject,env:{...process.env,SESHAT_RECEIPT:join(coverageProject,'receipt.json')}});
  assert.equal(run.status,0,`${runner} coverage failed:\n${run.stderr}\n${run.stdout}`);
  const report = join(coverageProject,`coverage-${runner}/coverage-final.json`);
  const score = native(['score',coverageSource,report]);
  results.coverage[runner] = {collectionMs:run.wallMs, analysisMs:score.wallMs, report, result:score.data};
  console.log(`${runner} coverage: ${score.data.complete ? 'measured' : 'unsupported mapping'}`);
}
assert.equal(results.coverage.node.result.complete, false, 'c8 line counters must not become statement scores');
assert.ok(results.coverage.vitest.result.problems.some(p => p.startsWith('statement escapes owning scope')));
assert.equal(results.coverage.jest.result.complete, true);
const measured = Object.fromEntries(results.coverage.jest.result.functions.map(f => [f.name, f]));
for (const [name, covered, total] of [['covered',3,3],['partial',2,3],['never',0,1],['defaults',1,1],['outer',3,3],['inner',2,3]]) {
  assert.deepEqual([measured[name].covered, measured[name].total], [covered,total], `statement attribution: ${name}`);
}
assert.equal(measured.empty.status, 'not-applicable');
assert.ok(Math.abs(measured.partial.crap - (2 + 4/27)) < 1e-12);
assert.ok(results.coverage.jest.result.functions.filter(f => f.name.startsWith('arrow@')).every(f => f.total === 1));
const sameReport = native(['score',coverageSource,results.coverage.jest.report,results.coverage.jest.report]);
assert.deepEqual(sameReport.data, results.coverage.jest.result, 'compatible reports merge without double counting');
results.negativeChecks.compatibleMerge = true;
const report = results.coverage.node.report;
const missing = native(['score',coverageSource]);
assert.equal(missing.status,2); assert.equal(missing.data.complete,false);
results.negativeChecks.missingCoverage = true;
const badReport = JSON.parse(readFileSync(report,'utf8'));
const original = badReport[coverageSource];
assert.ok(original, `Report keys: ${Object.keys(badReport)}`);
const firstId = Object.keys(original.statementMap)[0];
original.statementMap[firstId].start.column = 100000;
const invalidPath = join(work,'invalid-coverage.json'); json(invalidPath,badReport);
assert.equal(native(['score',coverageSource,invalidPath]).status,2);
assert.equal(native(['score',coverageSource,results.coverage.jest.report,invalidPath]).status,2);
results.negativeChecks.invalidPosition = true;
const combined = native(['score',coverageSource,...Object.values(results.coverage).map(c=>c.report)]);
assert.equal(combined.status,2);
results.coverage.combined = combined.data;
console.log(`Cross-provider merge: ${combined.data.complete ? 'compatible' : 'rejected as incompatible'}`);

// Compile-only checks expose whether runtime switching also works with strict TS build commands.
const switched = join(work,'switched.tsx');
assert.equal(native(['prepare',join(mutationProject,'subject.tsx'),switched]).status,0);
const tsc = join(repo,'benchmarks/node_modules/typescript/bin/tsc');
for (const [label,path] of [['original',join(mutationProject,'subject.tsx')],['switched',switched]]) {
  const check = invoke(process.execPath,[tsc,'--ignoreConfig','--strict','--noEmit','--skipLibCheck','--target','es2022',path]);
  results[`${label}Typecheck`] = {status:check.status,diagnostic:check.stdout+check.stderr};
}
console.log(`Strict TypeScript: original=${results.originalTypecheck.status}, switched=${results.switchedTypecheck.status}`);
assert.equal(results.originalTypecheck.status,0);
assert.equal(results.switchedTypecheck.status,2);
assert.match(results.switchedTypecheck.diagnostic,/TS18048/);

if (!process.argv.includes('--coverage-only')) {
  const expected = Array.from({length:20}, (_, id) => [id, [12,17].includes(id) ? 'survived' : 'killed']);
  for (let sample=0;sample<samples;sample++) for (const runner of ['node','jest','vitest']) {
    for (const strategy of sample%2 ? ['switch','replace'] : ['replace','switch']) {
      const configPath = join(work,`execution-${runner}.json`);
      json(configPath,{template:mutationProject,scratch:work,runner,
        build:[process.execPath,compiler,'@ROOT@/subject.tsx','@ROOT@/subject.cjs'],test:commands[runner],timeoutMs:10000});
      const run = native(['execute',configPath,strategy]);
      assert.equal(run.status,0,JSON.stringify(run.data));
      const outcomes = run.data.outcomes.map(({id,verdict})=>[id,verdict]);
      assert.deepEqual(outcomes,expected,`${runner}/${strategy} outcome mismatch`);
      results.mutation.push({sample,runner,strategy,wallMs:run.wallMs,...run.data});
      console.log(`${runner}/${strategy} sample ${sample+1}: ${Math.round(run.wallMs)}ms, ${run.data.killed} killed, ${run.data.survived} survived, ${run.data.builds} builds`);
    }
  }
  for (const scenario of ['setup-error','timeout']) {
    const p=join(work,`negative-${scenario}.json`);
    json(p,{template:mutationProject,scratch:work,runner:'node',scenario,limit:1,timeoutMs:scenario==='timeout'?1000:10000,
      build:[process.execPath,compiler,'@ROOT@/subject.tsx','@ROOT@/subject.cjs'],test:commands.node});
    const result=native(['execute',p,'switch']);
    assert.equal(result.status,2,JSON.stringify(result.data));
    assert.equal(result.data.outcomes[0].verdict,scenario==='timeout'?'timed-out':'execution-error');
    assert.equal(result.data.score,null);
    results.negativeChecks[scenario]=result.data;
  }
  assert.equal(readdirSync(work).filter(p=>p.startsWith('session-')).length,0);
  results.negativeChecks.sessionCleanup = true;
}
assert.equal(createHash('sha256').update(readFileSync(join(mutationProject,'subject.tsx'))).digest('hex'),originalMutationHash);
results.negativeChecks.sourcePreserved=true;
const destination=join(repo,'outputs/bounded-proofs.json'); json(destination,results);
console.log(`Results: ${destination}`);
