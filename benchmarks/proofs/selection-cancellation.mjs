// Cancel a real selected Node job and prove its descendant and scratch are removed.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {alive} from './liveness.mjs';
import {nodeCommand} from './process.mjs';

const here=dirname(fileURLToPath(import.meta.url)), repo=resolve(here,'../..');
const cli=resolve(process.argv[2] ?? join(repo,'crates/seshat/target/debug/seshat'));
assert.notEqual(process.platform,'win32','use the Windows console cancellation proofs on Windows');
assert.ok(existsSync(cli),'build CLI first');
mkdirSync(join(repo,'work/assurance-proofs'),{recursive:true});
const work=mkdtempSync(join(repo,'work/assurance-proofs/selection-cancellation-'));
const results=[];
for(const signal of ['SIGINT','SIGTERM']) for(const selection of [false,true]) {
  const name=`${signal}-${selection?'selected':'full'}`, project=join(work,name), scratch=join(work,`${name}-scratch`);
  mkdirSync(project); mkdirSync(scratch);
  const marker=join(work,`${name}-ready`);
  const write=(name,value)=>writeFileSync(join(project,name),value);
  const source='export function decision(value: number): boolean { return value > 0; }\n';
  write('target.ts',source); write('package.json',JSON.stringify({name:'seshat-cancellation',private:true,type:'module'}));
  write('tsconfig.json',JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,noEmit:true,skipLibCheck:true},include:['target.ts']}));
  write('a.test.mjs',`import {test} from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {existsSync,writeFileSync} from 'node:fs';
import {decision} from './target.ts';
test('cancellable body',async()=>{
  if(process.env.SESHAT_EXECUTION_ID?.includes('-mutant-')){
    process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});
    spawn(process.execPath,['-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(marker+'.descendant')},String(process.pid));process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`)}],{stdio:'inherit'});
    const timer=setInterval(()=>{if(existsSync(${JSON.stringify(marker+'.descendant')})){writeFileSync(${JSON.stringify(marker)},String(process.pid));clearInterval(timer);}},10);
    await new Promise(()=>{});
  }
  assert.equal(decision(2),true);
});\n`);
  write('b.test.mjs',"import {test} from 'node:test';test('unrelated',()=>{});\n");
  const test=[nodeCommand,'--test','--test-concurrency=1','--test-reporter={seshatReporter}','a.test.mjs','b.test.mjs'];
  write('seshat.json',JSON.stringify({testSelection:selection,source:{include:['target.ts']},
    capture:['target.ts','a.test.mjs','b.test.mjs','package.json','tsconfig.json'],mutationOperators:['comparison'],
    setups:[{name:'node',runner:'node',cwd:'.',timeoutMs:60000,mutantTimeoutMinMs:30000,
      typecheck:[nodeCommand,join(repo,'benchmarks/node_modules/typescript/bin/tsc'),'--project','tsconfig.json'],test,
      coverage:{command:[nodeCommand,join(here,'collect-node.mjs'),'a.test.mjs','b.test.mjs'],report:'coverage/coverage-final.json'}}]}));
  const child=spawn(cli,['check','--config',join(project,'seshat.json'),'--scratch',scratch,'--json','--no-progress'],{cwd:repo,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',exit;
  child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(status,signal)=>{exit={status,signal};resolve();});});
  try {
    const deadline=performance.now()+30000;
    while(!existsSync(marker)) {
      assert.equal(exit,undefined,`${name} ended before cancellation: ${stderr}\n${stdout}`);
      assert.ok(performance.now()<deadline,`${name} did not enter mutant`);
      await delay(20);
    }
    child.kill(signal);
    await closed;
    const report=JSON.parse(stdout), first=report.result.mutation.outcomes[0], job=first.setups[0];
    assert.equal(report.complete,false);assert.equal(first.verdict,'cancelled');
    assert.equal(job.jobsAttempted,1,'cancellation must not retry a full command');
    assert.equal(job.selection.mode,selection?'selected':'full');
    assert.equal(report.result.mutation.jobsAttempted,1);
    assert.equal(report.result.mutation.score,null);
    assert.equal(alive(Number(readFileSync(marker,'utf8'))),false,'test process survived');
    assert.equal(alive(Number(readFileSync(marker+'.descendant','utf8'))),false,'descendant survived');
    assert.deepEqual(readdirSync(scratch),[],'scratch retained');
    assert.equal(readFileSync(join(project,'target.ts'),'utf8'),source,'original source changed');
    results.push({name,signal,mode:job.selection.mode,verdict:first.verdict,jobsAttempted:job.jobsAttempted,descendantsRemoved:true,scratchRemoved:true});
    console.log(`${name}: cancelled cleanly`);
  } finally {
    if(!exit) { child.kill('SIGTERM'); await closed; }
  }
}
const report={node:process.version,platform:process.platform,arch:process.arch,results};
writeFileSync(join(work,'result.json'),JSON.stringify(report,null,2)+'\n');
if(process.env.SESHAT_PROOF_OUTPUT) writeFileSync(process.env.SESHAT_PROOF_OUTPUT,JSON.stringify(report,null,2)+'\n');
