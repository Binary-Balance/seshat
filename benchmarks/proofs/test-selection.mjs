// Compare whole-file selection with full mutation jobs in disposable Vitest projects.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {nodeCommand, runProcess} from './process.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const {values} = parseArgs({options:{cli:{type:'string'}, deps:{type:'string'}, cases:{type:'string'}}});
const cli = resolve(values.cli ?? join(repo, 'crates/seshat/target/release', process.platform === 'win32' ? 'seshat.exe' : 'seshat'));
assert.ok(existsSync(cli), 'build the Seshat CLI first, or pass --cli PATH');
mkdirSync(join(repo, 'work/assurance-proofs'), {recursive:true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/test-selection-'));
const project = join(work, 'input 🎸');
const scratch = join(work, 'scratch');
mkdirSync(project); mkdirSync(scratch);
cpSync(resolve(values.deps ?? join(repo, 'benchmarks/proofs/node_modules')), join(project, 'node_modules'), {recursive:true, verbatimSymlinks:true});
if (!existsSync(join(project, 'node_modules/typescript'))) {
  cpSync(join(repo, 'benchmarks/node_modules/typescript'), join(project, 'node_modules/typescript'), {recursive:true});
}
const write = (name, value) => writeFileSync(join(project, name), value);
const json = (name, value) => write(name, JSON.stringify(value, null, 2) + '\n');
json('package.json', {name:'seshat-selection-fixture', private:true, type:'module'});
json('tsconfig.json', {compilerOptions:{target:'ES2022', module:'NodeNext', moduleResolution:'NodeNext',
  strict:true, noEmit:true, skipLibCheck:true}, include:['*.ts'], exclude:['*.test.ts']});
const source = 'export function decision(value: number): boolean { return value > 0; }\nexport function equivalent(value: number): number { return value + 0; }\n';
const tests = `import {expect,test} from 'vitest';
import {decision,equivalent} from './target.ts';
test('duplicate',()=>{expect(decision(2)).toBe(true);});
test('duplicate',()=>{expect(equivalent(2)).toBe(2);});\n`;
const unrelated = `import {test} from 'vitest';test('unrelated',()=>new Promise(resolve=>setTimeout(resolve,100)));\n`;
const args = [nodeCommand, 'node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.mjs',
  '--maxWorkers=1', '--no-file-parallelism', '--maxConcurrency=1', '--reporter={seshatReporter}'];
const base = {source:{include:['target.ts','uncovered.ts']}, capture:['package.json','tsconfig.json',
  'target.ts','uncovered.ts','a.test.ts','b.test.ts','vitest.config.mjs','node_modules'],
  mutationOperators:['comparison','arithmetic'], setups:[{name:'unit',runner:'vitest',cwd:'.',timeoutMs:15000,
    typecheck:[nodeCommand,'node_modules/typescript/bin/tsc','--project','tsconfig.json'],
    test:args,coverage:{command:[...args,'--coverage'],report:'coverage/coverage-final.json'}}]};
function reset({body=source, test=tests, extra='', isolated=true, coverageSources=['target.ts','uncovered.ts']} = {}) {
  write('target.ts', body);
  write('uncovered.ts', 'export function unused(value: number): boolean { return value > 10; }\n');
  write('a.test.ts', test); write('b.test.ts', unrelated);
  write('vitest.config.mjs', `export default {test:{runner:process.env.SESHAT_VITEST_RUNNER,
    isolate:${isolated},include:['a.test.ts','b.test.ts'${extra}],coverage:{provider:'istanbul',
    include:${JSON.stringify(coverageSources)},reporter:['json'],reportsDirectory:'coverage'}}};\n`);
}
// Run the coverage command, then remove its file attribution from the receipt.
const dropAttribution = `import {spawnSync} from 'node:child_process';import {readFileSync,writeFileSync} from 'node:fs';
      const child=spawnSync(process.execPath,process.argv.slice(2),{stdio:'inherit'});
      if(child.status===0){const receipt=JSON.parse(readFileSync(process.env.SESHAT_RECEIPT,'utf8'));
        delete receipt.fileCoverage;writeFileSync(process.env.SESHAT_RECEIPT,JSON.stringify(receipt));}
      process.exit(child.status??2);\n`;
const runs = [];
const comparisons = [];
const normalize = value => JSON.parse(JSON.stringify(value).replaceAll(project, '<project>').replaceAll(work, '<work>'));
async function run(name, config, switching=false) {
  json('seshat.json', config);
  const invocation = ['check','--config',join(project,'seshat.json'),'--scratch',scratch,'--json','--no-progress'];
  if (switching) invocation.push('--experimental-switching');
  const child = await runProcess(cli, invocation, repo, {}, 180000);
  assert.equal(child.timedOut, false, name);
  assert.equal(child.overflow, false, name);
  assert.ok([0,2].includes(child.status), `${name}: ${child.status}\n${child.stderr}\n${child.stdout}`);
  const report = JSON.parse(child.stdout);
  assert.ok(report.result.mutation?.outcomes, `${name}: assessment did not reach mutations: ${report.result.error}`);
  const evidence = normalize(report);
  writeFileSync(join(work, `${name}.json`), JSON.stringify(evidence, null, 2)+'\n');
  runs.push({name,status:child.status,report:evidence});
  return report;
}
const outcomes = report => ['pseudoTesting','mutation'].flatMap(key =>
  (report.result[key]?.outcomes ?? []).map(row => [key,row.path,row.localId,row.verdict]));
async function pair(name, config=base, switching=false) {
  const full = await run(`${name}-full`, {...config,testSelection:false}, switching);
  const selected = await run(`${name}-selected`, config, switching);
  assert.deepEqual(outcomes(selected), outcomes(full), `${name}: changed verdicts`);
  assert.equal(selected.complete, full.complete, name);
  assert.equal(selected.result.mutation.score, full.result.mutation.score, name);
  const measurements = report => ({complete:report.complete,score:report.result.mutation.score,
    phases:report.result.phaseTimings,mutationWallMs:report.result.mutation.mutationWallMs,
    jobsAttempted:report.result.mutation.jobsAttempted,
    perOperatorJobs:report.result.mutation.perOperator.reduce((sum,row)=>sum+row.jobsAttempted,0)});
  for (const report of [full,selected]) {
    assert.equal(measurements(report).perOperatorJobs, report.result.mutation.jobsAttempted, `${name}: job counters disagree`);
  }
  comparisons.push({name,verdictsMatch:true,outcomes:outcomes(selected),full:measurements(full),selected:measurements(selected)});
  return {full,selected};
}
const rows = report => ['pseudoTesting','mutation'].flatMap(key => report.result[key]?.outcomes ?? []);
const choices = report => rows(report).flatMap(row => row.setups.map(setup => setup.selection)).filter(Boolean);
const valid = ['normal','parallel','switching','module','hooks','concurrent','missing','filter','timeout','query','cleanup','assertion-cleanup',
  'exclude','exclude-equals','unsupported','extra-coverage','job-deadline','setups'];
const requested = new Set((values.cases ?? valid.join(',')).split(','));
assert.ok([...requested].every(name => valid.includes(name)), 'unknown proof case');

for (const name of requested) {
  reset();
  const config = structuredClone(base);
  if (name === 'job-deadline') {
    reset({body:'export function decision(value: number): boolean { return value > 0; }\n',
      test:"import {expect,test} from 'vitest';import {decision} from './target.ts';test('positive',()=>expect(decision(2)).toBe(true));\n",
      coverageSources:['target.ts']});
    config.source.include=['target.ts'];
    config.mutationOperators=['comparison'];
    const originalConfig = readFileSync(join(project,'vitest.config.mjs'),'utf8');
    write('vitest.config.mjs', `import {basename} from 'node:path';
if(process.argv.some(arg=>basename(arg)==='a.test.ts') && /-(extreme|mutant)-0-0$/.test(process.env.SESHAT_EXECUTION_ID??'')) {
  while(true) {}
}
${originalConfig}`);
    const full = await run(`${name}-full`, {...config,testSelection:false});
    assert.equal(full.complete,true, 'the full command is a successful retry control');
    const selected = await run(`${name}-selected`,config);
    assert.equal(selected.complete,false, 'a full retry must not replace a job deadline');
    assert.equal(selected.result.mutation.score,null);
    for (const phase of ['pseudoTesting','mutation']) {
      const measured = selected.result[phase], first = measured.outcomes[0];
      assert.equal(measured.notRun,0, 'later mutants must still run');
      assert.equal(first.verdict,'timed-out');
      assert.equal(first.setups[0].timedOut,true);
      assert.equal(first.setups[0].selection.mode,'selected');
      assert.equal(first.setups[0].jobsAttempted,1, 'a deadline must not trigger a full retry');
    }
    assert.equal(selected.result.mutation.outcomes[1].verdict,'killed');
    continue;
  }
  let switching = false;
  if (name === 'parallel' || name === 'switching') config.workers = 2;
  if (name === 'switching') switching = true;
  if (name === 'module') reset({body:source+'export const atLoad = decision(1);\n',
    test:tests+"test('load',()=>{expect(decision(1)).toBe(true);});\n"});
  if (name === 'hooks') reset({test:`import {beforeAll,expect,test} from 'vitest';
    import {decision} from './target.ts';let value: boolean;
    beforeAll(()=>{value=decision(2);});test('hook result',()=>{expect(value).toBe(true);});\n`});
  if (name === 'concurrent') {
    config.setups[0].test = args.filter(arg => arg !== '--no-file-parallelism').map(arg => arg === '--maxWorkers=1' ? '--maxWorkers=2' : arg);
    config.setups[0].coverage.command = [...config.setups[0].test,'--coverage'];
  }
  if (name === 'missing') {
    write('coverage-wrapper.mjs', dropAttribution);
    config.capture.push('coverage-wrapper.mjs');
    config.setups[0].coverage.command = [nodeCommand,'coverage-wrapper.mjs',...args.slice(1),'--coverage'];
  }
  if (name === 'filter') {
    write('a.test.ts.extra.test.ts', unrelated);
    reset({extra:",'a.test.ts.extra.test.ts'"});
    config.capture.push('a.test.ts.extra.test.ts');
  }
  if (name === 'exclude' || name === 'exclude-equals') {
    reset({extra:",'a.test.ts.db.test.ts'"});
    write('a.test.ts.db.test.ts', "import {test} from 'vitest';test('excluded database test',()=>{throw Error('excluded test ran');});\n");
    config.capture.push('a.test.ts.db.test.ts');
    const exclude = name === 'exclude' ? ['--exclude','**/*.db.test.ts'] : ['--exclude=**/*.db.test.ts'];
    config.setups[0].test = [...args,...exclude];
    config.setups[0].coverage.command = [...config.setups[0].test,'--coverage'];
  }
  if (name === 'unsupported') {
    config.setups[0].test = [...args,'--passWithNoTests'];
    config.setups[0].coverage.command = [...config.setups[0].test,'--coverage'];
  }
  if (name === 'extra-coverage') {
    reset({coverageSources:['target.ts','uncovered.ts','extra-source.ts']});
    write('extra-source.ts', 'export const extra = 1;\n');
    write('b.test.ts', "import {expect,test} from 'vitest';import {extra} from './extra-source.ts';test('extra source',()=>expect(extra).toBe(1));\n");
    config.capture.push('extra-source.ts');
  }
  if (name === 'timeout') {
    reset({body:'export function decision(): boolean { return true; }\n',
      test:"import {test} from 'vitest';import {decision} from './target.ts';test('bounded timeout',()=>decision()?Promise.resolve():new Promise(()=>{}),50);\n"});
    config.mutationOperators=['boolean'];
  }
  if (name === 'setups') {
    // Only the unit setup imports target.ts; the other setup runs b.test.ts alone.
    reset({body:source+'export const limit = 1 + 1;\n'});
    write('vitest.other.config.mjs', `import config from './vitest.config.mjs';
export default {test:{...config.test,include:['b.test.ts'],coverage:{...config.test.coverage,reportsDirectory:'coverage-other'}}};\n`);
    config.capture.push('vitest.other.config.mjs');
    const test = args.map(arg => arg === 'vitest.config.mjs' ? 'vitest.other.config.mjs' : arg);
    config.setups.push({...structuredClone(config.setups[0]), name:'other', test,
      coverage:{command:[...test,'--coverage'], report:'coverage-other/coverage-final.json'}});
  }
  if (name === 'query') {
    write('b.test.ts', "import {expect,test} from 'vitest';import {decision} from './target.ts?variant';test('boundary via query',()=>expect(decision(0)).toBe(false));\n");
  }
  if (name === 'cleanup' || name === 'assertion-cleanup') {
    reset({body:'export function decision(): boolean { return true; }\n',
      test:`import {afterEach,expect,test} from 'vitest';import {decision} from './target.ts';
        afterEach(()=>{if(!decision())throw Error('cleanup marker');});
        test('cleanup after callback',()=>{${name === 'assertion-cleanup' ? 'expect(decision()).toBe(true);' : ''}});\n`});
    config.mutationOperators=['boolean'];
    config.setups[0].test = [...args,'--reporter=default'];
    config.setups[0].coverage.command = [...config.setups[0].test,'--coverage'];
  }
  const result = await pair(name, config, switching);
  assert.deepEqual(result.full.result.setups[0].selection, {state:'unavailable',reason:'disabled'});
  const targetRows = rows(result.selected).filter(row => row.path === 'target.ts');
  const modes = targetRows.flatMap(row => row.setups.map(setup => setup.selection)).filter(Boolean);
  if (name === 'module') {
    assert.ok(modes.length && modes.every(choice => choice.mode === 'full'), 'module-load coverage must fall back');
  } else if (['missing','query','unsupported','extra-coverage'].includes(name)) {
    assert.ok(choices(result.selected).every(choice => choice.mode === 'full'), 'missing attribution must fall back');
  } else if (name === 'filter') {
    assert.ok(modes.some(choice => choice.reason === 'selection-not-confirmed'), 'expanded substring filter must fall back');
  } else {
    assert.ok(modes.some(choice => choice.mode === 'selected'), `${name}: no verified file selection`);
    for (const choice of modes.filter(choice => choice.mode === 'selected')) assert.deepEqual(choice.files, ['a.test.ts']);
  }
  const unavailable = ['missing','query','unsupported','extra-coverage'].includes(name);
  const status = result.selected.result.setups[0].selection;
  if (unavailable) {
    const reason = name === 'unsupported' ? 'unsupported-test-command' : 'attribution-unavailable';
    assert.deepEqual(status, {state:'unavailable',reason,...(name === 'unsupported' ? {option:'--passWithNoTests'} : {})});
    const human = await runProcess(cli, ['check','--config',join(project,'seshat.json'),
      '--scratch',scratch,'--no-progress'], repo, {}, 180000);
    assert.equal(human.status, 0, `${name}: human output assessment failed`);
    assert.equal(human.stdout.split('Test selection unavailable:').length - 1, 1, `${name}: fallback must appear once`);
    assert.ok(human.stdout.includes(reason), `${name}: missing fallback reason`);
    if (name === 'unsupported') assert.ok(human.stdout.includes('--passWithNoTests'));
  } else {
    assert.deepEqual(status, {state:'available'});
  }
  if (name === 'normal') {
    assert.ok(rows(result.selected).some(row => row.verdict === 'killed'));
    assert.ok(rows(result.selected).some(row => row.path === 'target.ts' && row.verdict === 'survived'));
    assert.ok(choices(result.selected).some(choice => choice.mode === 'no-coverage'), 'proved zero coverage should skip jobs');
    assert.ok(result.selected.result.mutation.jobsAttempted < result.full.result.mutation.jobsAttempted);
  }
  if (name === 'setups') {
    assert.deepEqual(result.selected.result.setups[1].selection, {state:'available'});
    const jobs = row => row.setups.map(setup => [setup.selection.mode, setup.jobsAttempted]);
    const moduleLevel = targetRows.filter(row => row.setups[0].selection.reason === 'module-level-code');
    assert.ok(moduleLevel.length > 0 && moduleLevel.length < targetRows.length, 'fixture needs both mutant kinds');
    for (const row of targetRows) {
      if (moduleLevel.includes(row)) {
        assert.deepEqual(jobs(row), [['full',1],['full',1]], 'module-level mutants run every setup');
      } else {
        assert.deepEqual(jobs(row), [['selected',1],['no-coverage',0]], 'zero coverage skips only that setup');
        assert.equal(row.setups[1].state, 'no-coverage');
      }
    }
    // Incomplete attribution in the other setup must keep its full command.
    write('coverage-wrapper.mjs', dropAttribution);
    const unattributed = structuredClone(config);
    unattributed.capture.push('coverage-wrapper.mjs');
    unattributed.setups[1].coverage.command = [nodeCommand,'coverage-wrapper.mjs',...unattributed.setups[1].test.slice(1),'--coverage'];
    const report = await run(`${name}-unattributed`, unattributed);
    assert.deepEqual(outcomes(report), outcomes(result.full), `${name}: changed verdicts without attribution`);
    assert.deepEqual(report.result.setups[1].selection, {state:'unavailable',reason:'attribution-unavailable'});
    for (const row of rows(report)) assert.deepEqual(jobs(row)[1], ['full',1]);
    assert.ok(report.result.pseudoTesting.outcomes.length > 0, 'extreme mutants must run');
    // uncovered.ts puts the zero-coverage setup first.
    const zeroFirst = rows(report).filter(row => row.path === 'uncovered.ts');
    assert.ok(zeroFirst.length > 0, 'fixture needs a zero-coverage first setup');
    for (const row of zeroFirst) assert.deepEqual(jobs(row), [['no-coverage',0],['full',1]]);
  }
  if (name === 'timeout') assert.ok(targetRows.some(row => row.verdict === 'timed-out'));
  if (name === 'cleanup' || name === 'assertion-cleanup') {
    assert.equal(result.selected.complete, false);
    assert.equal(result.selected.result.mutation.score, null);
    const failed = targetRows.find(row => row.verdict === 'execution-error');
    assert.ok(failed && failed.setups[0].report.errors > 0, 'cleanup must retain execution-error evidence');
    assert.equal(failed.setups[0].selection.mode, 'selected');
    assert.equal(failed.setups[0].jobsAttempted, 1, 'unresolved evidence must not trigger a full-command retry');
    assert.match(failed.setups[0].diagnostic, /cleanup marker/);
    if (name === 'assertion-cleanup') assert.match(failed.setups[0].diagnostic, /AssertionError/);
  }
}
const summary = {node:process.version,platform:process.platform,arch:process.arch,
  vitest:JSON.parse(readFileSync(join(project,'node_modules/vitest/package.json'),'utf8')).version,
  binarySha256:createHash('sha256').update(readFileSync(cli)).digest('hex'),checks:[...requested],comparisons,runs,
  timings:runs.map(({name,report})=>({name,phaseTimings:report.result.phaseTimings,
    mutationWallMs:report.result.mutation?.mutationWallMs,jobs:report.result.mutation?.jobsAttempted}))};
writeFileSync(join(work,'result.json'),JSON.stringify(summary,null,2)+'\n');
if (process.env.SESHAT_PROOF_OUTPUT) {
  const {runs,timings,...portable} = summary;
  writeFileSync(process.env.SESHAT_PROOF_OUTPUT,JSON.stringify(portable,null,2)+'\n');
}
console.log(`Whole-file selection: ${requested.size} cases; ${relative(repo,join(work,'result.json'))}`);
