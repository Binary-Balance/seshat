// Plain Jest: resolved environments, coverage locations, verdict parity and rejection controls.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {npmArgs, npmCommand, runProcess} from './process.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const {values} = parseArgs({options:{cli:{type:'string'}, deps:{type:'string'}}});
const cli = resolve(values.cli ?? process.env.SESHAT_CLI_BINARY ?? 'crates/seshat/target/debug/seshat');
const fixture = join(repo, 'examples/jest');
mkdirSync(join(repo, 'work/assurance-proofs'), {recursive:true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/jest-check-'));
const project = join(work, 'input 🎸'), scratch = join(work, 'scratch');
cpSync(fixture, project, {recursive:true, filter:path => !['node_modules','coverage'].includes(path.split(/[\\/]/).pop())});
mkdirSync(scratch);
if (values.deps) cpSync(join(resolve(values.deps), 'node_modules'), join(project, 'node_modules'), {recursive:true, verbatimSymlinks:true});
else {
  const install = await runProcess(npmCommand, [...npmArgs, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], project, {}, 180000);
  assert.equal(install.timedOut || install.overflow, false, 'dependency install exceeded its bounds');
  assert.equal(install.status, 0, install.stdout + install.stderr);
}
assert.equal(existsSync(join(project, 'node_modules/jest-expo')), false, 'plain proof must have no Expo dependency');
const base = JSON.parse(readFileSync(join(project, 'seshat.json'), 'utf8'));
// A trailing test path must not become another value of Jest's variadic --reporters.
writeFileSync(join(project, 'tests/other.test.ts'), "test('other file', () => expect(2).toBe(2));\n");
base.setups[0].test.push('tests/other.test.ts');
const coverageArgs = base.setups[0].coverage.command;
coverageArgs.splice(coverageArgs.findIndex(argument => argument.includes('{seshatEnvironment}')) + 1,
  0, 'tests/other.test.ts');
const originalTests = readFileSync(join(project, 'tests/rules.test.ts'), 'utf8');
const source = readFileSync(join(project, 'src/rules.ts'));
const portable = value => {
  if (typeof value === 'string') return value.replaceAll(repo, '<repo>').replaceAll(repo.replaceAll('\\','/'), '<repo>');
  if (Array.isArray(value)) return value.map(portable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [portable(key),portable(entry)]));
  return value;
};
const evidence = {node:process.versions.node, platform:process.platform, arch:process.arch,
  cliSha256:createHash('sha256').update(readFileSync(cli)).digest('hex'), cases:{}};
function config(extra = {}) {
  writeFileSync(join(project, 'jest.config.cjs'), `module.exports=${JSON.stringify({
    testMatch:['<rootDir>/tests/*.test.ts'], transform:{'^.+\\.tsx?$':'babel-jest'},
    coverageProvider:'babel', ...extra,
  })};\n`);
}
async function run(name, {switching = false, supported = true, setup = base} = {}) {
  writeFileSync(join(project, 'seshat.json'), JSON.stringify(setup));
  const args = ['check','--config',join(project,'seshat.json'),'--scratch',scratch,'--json','--no-progress'];
  if (switching) args.push('--experimental-switching');
  const child = await runProcess(cli, args, repo, {}, 180000);
  assert.equal(createHash('sha256').update(readFileSync(cli)).digest('hex'), evidence.cliSha256, 'proof executable changed during the run');
  assert.equal(child.timedOut, false, `${name}: deadline`);
  assert.equal(child.overflow, false, `${name}: output limit`);
  assert.equal(child.status, supported ? 0 : 2, `${name}: ${child.stdout}\n${child.stderr}`);
  const report = JSON.parse(child.stdout);
  assert.equal(report.complete, supported, name);
  if (!supported) {
    assert.equal(report.result.mutation.killed, 0, 'untrusted execution became a kill');
    assert.ok(report.result.mutation.outcomes.every(outcome => outcome.verdict === 'unassessed'));
  }
  assert.deepEqual(readFileSync(join(project, 'src/rules.ts')), source, 'original source changed');
  assert.deepEqual(readdirSync(scratch), [], 'capture was not removed');
  evidence.cases[name] = portable(report);
  console.log(`${name}: exit ${child.status}, complete=${report.complete}`);
  return report;
}
function stable(report) {
  const result = report.result;
  return {functions:result.sources[0].result.functions.map(({name,coverage,covered,total,crap,status}) => ({name,coverage,covered,total,crap,status})),
    mutation:result.mutation.outcomes.map(({original,replacement,verdict}) => ({original,replacement,verdict})),
    extreme:result.pseudoTesting.outcomes.map(({verdict}) => verdict)};
}
for (const environment of ['node','jsdom']) {
  config(environment === 'node' ? {} : {testEnvironment:'jsdom'});
  writeFileSync(join(project, 'tests/rules.test.ts'), originalTests + (environment === 'node'
    ? "\ntest('uses the default node environment', () => expect('document' in globalThis).toBe(false));\n"
    : "\ntest('uses the configured DOM environment', () => { const element = document.createElement('div'); element.textContent = 'hello'; expect(element.textContent).toBe('hello'); });\n"));
  const replacement = await run(`${environment}-replacement`);
  const switching = await run(`${environment}-switching`, {switching:true});
  assert.deepEqual(stable(replacement), stable(switching), 'replacement/switching verdicts differ');
  assert.deepEqual(stable(replacement).functions, [
    {name:'classify',coverage:1,covered:3,total:3,crap:2,status:'measured'},
    {name:'isPositive',coverage:1,covered:1,total:1,crap:1,status:'measured'},
  ]);
  for (const report of [replacement,switching]) {
    assert.equal(report.result.mutation.killed, 3);
    assert.equal(report.result.mutation.survived, 1);
    assert.equal(report.result.mutation.score, 75);
    assert.equal(report.result.pseudoTesting.killed, 2);
    assert.equal(report.result.jobsAttempted, report === switching ? 10 : 9);
    assert.equal(report.result.mutation.workerBaselineJobs, 0);
    for (const phase of ['baseline','coverage']) {
      const receipt = report.result.setups[0][phase].report;
      assert.equal(receipt.environment.name, `jest-environment-${environment}`);
      assert.equal(receipt.environment.version, '29.7.0');
      assert.deepEqual(receipt.actual, {jest:'29.7.0'});
      assert.equal(receipt.errors, 0);
    }
    assert.deepEqual(report.result.setups[0].selection, {state:'unavailable',reason:'missing-test-files'});
    for (const outcome of report.result.mutation.outcomes) {
      assert.equal(outcome.setups[0].selection.mode, 'full');
      assert.equal(outcome.setups[0].jobsAttempted, 1);
    }
  }
}
writeFileSync(join(project, 'tests/rules.test.ts'), originalTests);
config();
const npmSetup = structuredClone(base);
for (const command of [npmSetup.setups[0].test, npmSetup.setups[0].coverage.command]) {
  // The fixture's npm script already supplies --config jest.config.cjs.
  command.splice(0, 4, npmCommand, ...npmArgs, 'test', '--');
}
const wrapped = await run('npm-wrapper', {setup:npmSetup});
assert.equal(wrapped.result.mutation.killed, 3);
assert.equal(wrapped.result.mutation.survived, 1);
assert.equal(wrapped.result.pseudoTesting.killed, 2);
assert.equal(wrapped.result.setups[0].baseline.report.environment.name, 'jest-environment-node');
for (const [name, extra] of [
  ['v8',{coverageProvider:'v8'}],
  ['custom-transform',{transform:{'^.+\\.tsx?$':'<rootDir>/transform.cjs'}}],
  ['custom-environment',{testEnvironment:'<rootDir>/environment.cjs'}],
  ['multiple-projects',{projects:[{displayName:'one'},{displayName:'two'}]}],
]) {
  writeFileSync(join(project, 'transform.cjs'), 'module.exports={process(){throw Error("unsupported")}};');
  writeFileSync(join(project, 'environment.cjs'), "module.exports=require('jest-environment-node').TestEnvironment;");
  const setup = structuredClone(base);
  setup.capture.push('environment.cjs','transform.cjs');
  config(extra);
  await run(name, {supported:false, setup});
}
config();
writeFileSync(join(project, 'tests/rules.test.ts'), '/** @jest-environment node */\n' + originalTests);
await run('docblock-bypasses-evidence', {supported:false});
writeFileSync(join(project, 'tests/rules.test.ts'), originalTests + "\ntest('baseline failure', () => expect(1).toBe(2));\n");
await run('failing-baseline', {supported:false});
writeFileSync(join(project, 'tests/rules.test.ts'), originalTests);
for (const [name, relative] of [['unsupported-jest','jest'],['unsupported-environment','jest-environment-node']]) {
  const path = join(project, 'node_modules', relative, 'package.json');
  const original = readFileSync(path, 'utf8');
  const value = JSON.parse(original); value.version = '30.0.0';
  writeFileSync(path, JSON.stringify(value));
  try { await run(name, {supported:false}); }
  finally { writeFileSync(path, original); }
}
const output = resolve(process.env.SESHAT_PROOF_OUTPUT ?? join(work, 'result.json'));
mkdirSync(dirname(output), {recursive:true});
writeFileSync(output, JSON.stringify(evidence,null,2) + '\n');
console.log(`Plain Jest checks passed: ${Object.keys(evidence.cases).length} cases; ${output}`);
