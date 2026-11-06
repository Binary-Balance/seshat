// Compare selected and full mutant verdicts in disposable Jest/Expo and Node projects.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {nodeCommand, runProcess} from './process.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '../..');
const {values} = parseArgs({options:{cli:{type:'string'},runner:{type:'string'},cases:{type:'string'},deps:{type:'string'}}});
let cli = resolve(values.cli ?? join(repo, 'crates/seshat/target/debug', process.platform === 'win32' ? 'seshat.exe' : 'seshat'));
assert.ok(existsSync(cli), 'build the CLI first or pass --cli');
const runners = (values.runner ?? 'node,jest').split(',');
assert.ok(runners.every(runner => ['node','jest'].includes(runner)));
const aliases={query:'target.ts?variant',fragment:'target.ts#variant','encoded-query':'%74arget.ts?variant','module-query':'target.ts?variant'};
const valid = ['normal','module','hooks','parallel','concurrent','missing','filter','changed','empty','timeout','cleanup','assertion-cleanup','suite-cleanup','assertion-suite-cleanup','reset','late-delete','artifact-cleanup','process-error',...Object.keys(aliases)];
const cases = (values.cases ?? valid.join(',')).split(',');
assert.ok(cases.every(name => valid.includes(name)));
mkdirSync(join(repo, 'work/assurance-proofs'), {recursive:true});
const work = mkdtempSync(join(repo, 'work/assurance-proofs/jest-node-selection-'));
// A long proof must keep using one binary even if another task rebuilds the CLI.
const candidate = join(work, process.platform === 'win32' ? 'seshat.exe' : 'seshat');
cpSync(cli, candidate); cli = candidate;
const runs = [], comparisons = [];
const source = 'export function decision(value: number): boolean { return value > 0; }\nexport function equivalent(value: number): number { return value + 0; }\n';
const rows = report => ['pseudoTesting','mutation'].flatMap(phase => (report.result[phase]?.outcomes ?? []).map(row => ({...row,phase})));
const verdicts = report => rows(report).map(row => [row.phase,row.path,row.localId,row.verdict]);
const normalize = value => JSON.parse(JSON.stringify(value).replaceAll(work, '<work>'));

for (const runner of runners) {
  const project = join(work, `${runner} input 🎸`), scratch = join(work, `${runner}-scratch`);
  mkdirSync(project); mkdirSync(scratch);
  const write = (name, text) => writeFileSync(join(project,name), text);
  const json = (name, value) => write(name, JSON.stringify(value,null,2)+'\n');
  const jest = runner === 'jest';
  if (jest) cpSync(join(resolve(values.deps ?? join(here,'fixtures/jest-expo')),'node_modules'), join(project,'node_modules'), {recursive:true,verbatimSymlinks:true});
  json('package.json', jest ? JSON.parse(readFileSync(join(here,'fixtures/jest-expo/package.json'),'utf8')) : {name:'seshat-node-selection',private:true,type:'module'});
  json('tsconfig.json', {compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,noEmit:true,skipLibCheck:true},include:['target.ts','uncovered.ts']});
  if (jest) write('babel.config.cjs', "module.exports={presets:['babel-preset-expo']};\n");
  const extension = jest ? 'test.tsx' : 'test.mjs';
  const first = `a.${extension}`, second = `b.${extension}`;
  const imports = jest ? "import {decision,equivalent} from './target';\n" : "import {test,before,after,afterEach} from 'node:test';import assert from 'node:assert/strict';import {decision,equivalent} from './target.ts';\n";
  const check = expression => jest ? `expect(${expression}).toBe(true);` : `assert.equal(${expression},true);`;
  const tests = imports + `test('duplicate',()=>{${check('decision(2)')}});test('duplicate',()=>{${check('equivalent(2)===2')}});\n`;
  const unrelated = jest ? "test('unrelated',()=>new Promise(resolve=>setTimeout(resolve,40)));\n" : "import {test} from 'node:test';test('unrelated',()=>new Promise(resolve=>setTimeout(resolve,40)));\n";
  const test = jest ? [nodeCommand,'node_modules/jest/bin/jest.js','--config','jest.config.cjs','--runInBand',
    '--reporters={seshatReporter}','--env={seshatEnvironment}'] : [nodeCommand,'--test','--test-concurrency=1','--test-reporter={seshatReporter}',first,second];
  const base = {source:{include:['target.ts','uncovered.ts']},capture:['package.json','tsconfig.json','target.ts','uncovered.ts',first,second],
    mutationOperators:['comparison','arithmetic'],setups:[{name:runner,runner,cwd:'.',timeoutMs:60000,mutantTimeoutMinMs:15000,
      typecheck:[nodeCommand,join(repo,'benchmarks/node_modules/typescript/bin/tsc'),'--project','tsconfig.json'],test,
      coverage:{command:jest ? [...test,'--coverage','--coverageProvider=babel','--coverageReporters=json',
        '--coverageDirectory=coverage','--collectCoverageFrom=target.ts','--collectCoverageFrom=uncovered.ts'] :
        [nodeCommand,join(here,'collect-node.mjs'),first,second],report:'coverage/coverage-final.json'}}]};
  if (jest) base.capture.push('babel.config.cjs','jest.config.cjs','node_modules');
  async function run(name, config) {
    json('seshat.json',config);
    const child = await runProcess(cli,['check','--config',join(project,'seshat.json'),'--scratch',scratch,'--json','--no-progress'],repo,{},240000);
    assert.equal(child.timedOut,false,`${runner}/${name} timed out`);
    assert.equal(child.overflow,false,`${runner}/${name} overflow`);
    assert.ok([0,2].includes(child.status),`${runner}/${name}: ${child.status}\n${child.stderr}\n${child.stdout}`);
    const report = JSON.parse(child.stdout);
    writeFileSync(join(work,`${runner}-${name}.json`),JSON.stringify(normalize(report),null,2)+'\n');
    runs.push({runner,name,status:child.status,report:normalize(report)});
    return report;
  }
  for (const name of cases) {
    if(jest && Object.hasOwn(aliases,name)) continue; // Node URL identities are separate from Jest resolution.
    write('target.ts',source); write('uncovered.ts','export function unused(value: number): boolean { return value > 10; }\n');
    write(first,tests); write(second,unrelated);
    if (jest) write('jest.config.cjs',`module.exports={preset:'jest-expo',rootDir:__dirname,testMatch:['<rootDir>/*.test.tsx'],maxWorkers:1};\n`);
    const config = structuredClone(base);
    if(Object.hasOwn(aliases,name)) {
      write(first,tests.replace("'./target.ts'",JSON.stringify(`./${aliases[name]}`)));
      if(name==='module-query') write('target.ts',source+'export const loaded=decision(2);\n');
    }
    if (name === 'module') write('target.ts',source+'export const loaded=decision(2);\n');
    if (name === 'hooks') write(first,imports+`${jest?'beforeAll':'before'}(()=>{decision(2);});test('hook',()=>{${check('decision(2)')}});\n`);
    if (name === 'parallel') {
      if (jest) {
        config.setups[0].test=test.filter(arg=>arg!=='--runInBand').concat('--maxWorkers=2');
        config.setups[0].coverage.command=config.setups[0].coverage.command.filter(arg=>arg!=='--runInBand').concat('--maxWorkers=2');
      } else config.setups[0].test=test.map(arg=>arg==='--test-concurrency=1'?'--test-concurrency=2':arg);
    }
    if (name === 'concurrent') write(first,jest ? imports+`test.concurrent('concurrent',async()=>{${check('decision(2)')}});\n` :
      imports+`test('parent',{concurrency:true},async t=>{await Promise.all([t.test('duplicate',()=>{${check('decision(2)')}}),t.test('duplicate',()=>{${check('equivalent(2)===2')}})]);});\n`);
    if (name === 'filter') {
      const flag=jest?'--testNamePattern=duplicate':'--test-name-pattern=duplicate';
      config.setups[0].test.push(flag);
      // The coverage workload must match the baseline for the option fallback control.
      if (jest) config.setups[0].coverage.command.push(flag);
    }
    if (name === 'timeout' || name.endsWith('cleanup') && name!=='artifact-cleanup') {
      write('target.ts','export function decision(): boolean { return true; }\n');
      config.source.include=['target.ts']; config.mutationOperators=['boolean'];
      if (jest) config.setups[0].coverage.command=config.setups[0].coverage.command.filter(arg=>arg!=='--collectCoverageFrom=uncovered.ts');
      const head=imports.replace('decision,equivalent','decision');
      if (name==='timeout') write(first,head+(jest ? "test('timeout',()=>decision()?Promise.resolve():new Promise(()=>{}),25);\n" :
        "test('timeout',{timeout:25},()=>decision()?Promise.resolve():new Promise(()=>{}));\n"));
      else {
        const hook=name.includes('suite') ? jest?'afterAll':'after' : 'afterEach';
        write(first,head+`${hook}(()=>{if(!decision())throw Error('cleanup marker');});test('cleanup',()=>{${name.startsWith('assertion-')?check('decision()'):''}});\n`);
      }
    }
    if (name === 'reset' || name === 'late-delete') {
      const damage = name==='reset' ? 'Object.values(globalThis.__coverage__??{}).forEach(entry=>{for(const key of Object.keys(entry.f))entry.f[key]=0;});' : 'delete globalThis.__coverage__;';
      write(first,tests+(jest ? `afterAll(()=>{${damage}});\n` : `process.on('exit',()=>{${damage}});\n`));
    }
    if (name==='missing') {
      write('drop-coverage.mjs',"import {spawnSync} from 'node:child_process';import {readFileSync,writeFileSync} from 'node:fs';const run=spawnSync(process.execPath,process.argv.slice(2),{stdio:'inherit'});if(run.status===0){const path=process.env.SESHAT_RECEIPT;const value=JSON.parse(readFileSync(path,'utf8'));delete value.fileCoverage;writeFileSync(path,JSON.stringify(value));}process.exit(run.status??2);\n");
      config.capture.push('drop-coverage.mjs'); config.setups[0].coverage.command=[nodeCommand,'drop-coverage.mjs',...config.setups[0].coverage.command.slice(1)];
    }
    if (name==='empty') { write(first,''); write(second,''); }
    if (name==='changed') write(first,"import {readFileSync} from 'node:fs';\n"+tests+
      "if(readFileSync('target.ts','utf8').includes('>='))test('extra mutant test',()=>{});\n");
    if (name==='artifact-cleanup' || name==='process-error') {
      config.source.include=['target.ts'];
      if(jest) config.setups[0].coverage.command=config.setups[0].coverage.command.filter(arg=>arg!=='--collectCoverageFrom=uncovered.ts');
      const action=name==='artifact-cleanup' ? "mkdirSync(process.env.SESHAT_RECEIPT+'.events-failure');" : 'process.exit(2);';
      write(first,"import {mkdirSync} from 'node:fs';\n"+tests.replace("test('duplicate',()=>{",`test('duplicate',()=>{if(process.env.SESHAT_EXECUTION_ID?.includes('-mutant-')){${action}}`));
    }
    const full=await run(`${name}-full`,{...config,testSelection:false});
    const selected=await run(`${name}-selected`,config);
    assert.deepEqual(verdicts(selected),verdicts(full),`${runner}/${name}: verdicts differ`);
    assert.equal(selected.complete,full.complete,`${runner}/${name}: completeness differs`);
    assert.equal(selected.result.mutation?.score,full.result.mutation?.score,`${runner}/${name}: score differs`);
    if(name==='empty') {
      assert.equal(selected.complete,false,'empty tests must not pass');
      assert.ok(rows(selected).every(row=>row.setups.every(setup=>setup.state==='not-run')),
        'empty tests must stop before mutation');
      assert.equal(selected.result.mutation?.jobsAttempted ?? 0,0);
    } else {
      assert.ok(selected.result.mutation?.outcomes,`${runner}/${name}: no mutation phase: ${selected.result.error}`);
      const choices=rows(selected).filter(row=>row.path==='target.ts').flatMap(row=>row.setups.map(setup=>setup.selection)).filter(Boolean);
      const fallback=['missing','reset','late-delete','filter'].includes(name) || Object.hasOwn(aliases,name) || (jest && name==='concurrent');
      if(fallback) assert.ok(choices.length && choices.every(choice=>choice.mode==='full'),`${runner}/${name}: unsafe selection`);
      else if(['module','hooks'].includes(name)) assert.ok(choices.length && choices.every(choice=>choice.mode==='full'),`${runner}/${name}: early calls require full command`);
      else if(jest && ['timeout','cleanup','assertion-cleanup'].includes(name)) {
        assert.ok(choices.length && choices.every(choice=>choice.mode==='selected'||choice.reason==='selection-not-confirmed'),
          'a continuable failed run without identities needs a full retry');
        assert.ok(choices.some(choice=>choice.reason==='selection-not-confirmed'));
        for(const row of rows(selected)) for(const setup of row.setups) {
          if(setup.selection?.reason==='selection-not-confirmed') {
            assert.equal(setup.jobsAttempted,2);
            assert.deepEqual(setup.selection.requestedFiles,[first]);
            assert.ok(setup.selection.selectedAttempt.report.failed>0);
          }
        }
      } else {
        assert.ok(choices.some(choice=>choice.mode==='selected'),`${runner}/${name}: no selected jobs`);
        for(const choice of choices.filter(choice=>choice.mode==='selected')) assert.deepEqual(choice.files,[first]);
      }
      if(name==='normal') assert.ok(selected.result.mutation.jobsAttempted<full.result.mutation.jobsAttempted,'zero coverage must save jobs');
      if(Object.hasOwn(aliases,name)) {
        assert.deepEqual(selected.result.setups[0].selection,{state:'unavailable',reason:'attribution-unavailable'});
        assert.ok(rows(selected).some(row=>row.path==='target.ts'&&row.verdict==='killed'),'aliases must retain mutant kills');
        assert.ok(selected.result.sources.find(row=>row.path==='target.ts').result.functions.some(fn=>fn.coverage>0),
          'the collector must retain real source coverage for URL variants');
      }
      if(name==='changed') {
        const retries=rows(selected).flatMap(row=>row.setups).filter(setup=>setup.selection?.reason==='selection-not-confirmed');
        assert.ok(retries.length,'changed test identities must trigger a full retry');
        for(const setup of retries) {
          assert.equal(setup.jobsAttempted,2);
          assert.deepEqual(setup.selection.requestedFiles,[first]);
          assert.ok(setup.selection.selectedAttempt.report.tests.some(test=>test.id.includes('extra mutant test')));
          assert.ok(setup.report.tests.some(test=>test.file.endsWith(second)),'full retry must include unrelated files');
        }
      }
      if(name==='timeout') assert.ok(rows(selected).some(row=>jest ? row.verdict==='timed-out' :
        row.verdict==='execution-error' && row.setups.some(setup=>setup.report?.errors>0)),
        'fixture must retain the runner timeout verdict');
      if(name.endsWith('cleanup') && name!=='artifact-cleanup') {
        // Retain each runner's existing distinction between attributable test failures and suite errors.
        const killed=jest && !name.includes('suite') || !jest && name==='assertion-cleanup';
        assert.equal(selected.complete,killed);
        if(killed) assert.ok(rows(selected).some(row=>row.verdict==='killed'));
        else {
          assert.equal(selected.result.mutation.score,null);
          assert.ok(rows(selected).some(row=>row.verdict==='execution-error' && row.setups.some(setup=>setup.report?.errors>0)),
            'suite/uncertain cleanup must remain an infrastructure failure');
        }
      }
      if(name==='artifact-cleanup'||name==='process-error') {
        assert.equal(selected.complete,false); assert.equal(selected.result.mutation.score,null);
        const failed=rows(selected).find(row=>row.phase==='mutation' && row.verdict==='execution-error');
        assert.ok(failed,'fixture must fail execution');
        assert.equal(failed.setups[0].selection.mode,'selected');
        assert.equal(failed.setups[0].jobsAttempted,1,'failed execution must not retry the full command');
        if(name==='artifact-cleanup') assert.equal(typeof failed.setups[0].cleanupError,'string');
      }
    }
    const measurement=report=>({complete:report.complete,score:report.result.mutation?.score,phaseTimings:report.result.phaseTimings,
      mutationWallMs:report.result.mutation?.mutationWallMs,jobsAttempted:report.result.mutation?.jobsAttempted});
    comparisons.push({runner,name,verdictsMatch:true,outcomes:verdicts(selected),full:measurement(full),selected:measurement(selected)});
    console.log(`${runner}/${name}: matched`);
  }
}
const portable={node:process.version,platform:process.platform,arch:process.arch,
  binarySha256:createHash('sha256').update(readFileSync(cli)).digest('hex'),comparisons};
writeFileSync(join(work,'result.json'),JSON.stringify({...portable,runs},null,2)+'\n');
if(process.env.SESHAT_PROOF_OUTPUT) writeFileSync(process.env.SESHAT_PROOF_OUTPUT,JSON.stringify(portable,null,2)+'\n');
console.log(`Jest/Node whole-file selection: ${comparisons.length} cases; ${relative(repo,join(work,'result.json'))}`);
