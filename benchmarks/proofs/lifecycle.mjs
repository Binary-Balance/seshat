// Signal only disposable processes created by this proof. Never use global pkill.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {alive} from './liveness.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const proofBinary = process.env.SESHAT_PROOF_BINARY ?? join(repo,'benchmarks/rust/target/release/seshat-proofs');
const work = mkdtempSync(join(repo,'work/assurance-proofs/lifecycle-'));
const input = join(work,'input');
mkdirSync(input);
const json = (path,value) => writeFileSync(path,JSON.stringify(value,null,2)+'\n');
const read = path => JSON.parse(readFileSync(path,'utf8'));
const source = 'export function adult(age: number) { return age >= 18; }\nexport const initial = 2 < 3;\n';
writeFileSync(join(input,'subject.ts'),source);
writeFileSync(join(input,'package.json'),'{"type":"module"}');
for(const [name,age] of [['high',20],['low',10]]) {
  writeFileSync(join(input,name+'.mjs'),`import {test} from 'node:test';import assert from 'node:assert/strict';import {adult,initial} from './subject.ts';test('age',()=>{assert.equal(adult(${age}),${age>=18});assert.equal(initial,true);});`);
}
writeFileSync(join(input,'job.cjs'),`const {spawn,spawnSync}=require('node:child_process');const fs=require('node:fs');
const role=process.argv[2],out=process.argv[3],mode=process.argv[4];
process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});
if(role==='leader')spawn(process.execPath,[__filename,'descendant',out],{stdio:'inherit'});
const group=Number(spawnSync('/bin/ps',['-o','pgid=','-p',String(process.pid)],{encoding:'utf8'}).stdout.trim());
fs.writeFileSync(out+'.'+role+'.tmp',JSON.stringify({pid:process.pid,group,cwd:process.cwd()}));
fs.renameSync(out+'.'+role+'.tmp',out+'.'+role);
setInterval(()=>{if(role==='leader'&&fs.existsSync(out+'.descendant')){
  if(mode==='leader-exit')process.exit(0);
  if(mode==='overflow')process.stdout.write('x'.repeat(5*1024*1024));
}},10);\n`);
async function until(predicate,label,timeout=5000) {
  const deadline=performance.now()+timeout;
  while(performance.now()<deadline){if(predicate())return;await delay(10);}
  throw Error('Timed out waiting for '+label);
}
const results={};
const signals=(process.env.SESHAT_LIFECYCLE_SIGNALS??'SIGINT,SIGTERM').split(',');
const cases=signals.flatMap(signal=>{
  assert.ok(['SIGINT','SIGTERM','SIGKILL'].includes(signal));
  return (signal==='SIGKILL'?['baseline']:['typecheck','baseline','coverage','mutation']).map(phase=>({name:signal+'-'+phase,phase,signal}));
});
cases.push(...['timeout','overflow','leader-exit'].map(name=>({name,phase:'baseline'})));
for(const {name,phase,signal} of cases) {
  const marker=join(work,name),scratch=join(work,name+'-scratch');mkdirSync(scratch);
  const command=[process.execPath,'job.cjs','leader',marker,name];
  const setups=['high','low','low'].map((test,index)=>({
    name:'setup-'+index,runner:'node',cwd:'.',timeoutMs:name==='timeout'?1000:30000,
    typecheck:[process.execPath,join(repo,'benchmarks/node_modules/typescript/bin/tsc'),'--ignoreConfig','--strict','--noEmit','--skipLibCheck','subject.ts'],
    test:[process.execPath,'--test','--test-reporter={seshatReporter}',test+'.mjs'],
    coverage:{command:[process.execPath,join(repo,'benchmarks/proofs/collect-node.mjs'),test+'.mjs'],report:'coverage-'+index+'/final.json'}
  }));
  // These controls measure job shutdown, not compiler startup under a short deadline.
  if(!signal)for(const setup of setups)delete setup.typecheck;
  if(phase==='mutation') {
    setups[1].test=[process.execPath,'-e',`const fs=require('node:fs');const {spawnSync}=require('node:child_process');
      const args=fs.readFileSync('subject.ts','utf8').includes('age < 18')?${JSON.stringify(command.slice(1))}:['--test','--test-reporter='+process.env.SESHAT_NODE_REPORTER,'low.mjs'];
      const result=spawnSync(process.execPath,args,{stdio:'inherit'});process.exit(result.status??2);`];
  } else if(phase==='coverage') setups[0].coverage.command=command;
  else setups[0][phase==='baseline'?'test':'typecheck']=command;
  json(join(input,'seshat.json'),{source:{include:['subject.ts']},capture:['subject.ts','package.json','job.cjs','high.mjs','low.mjs'],setups});
  const sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  const sentinelDone=new Promise(resolve=>sentinel.once('close',resolve));
  const child=spawn(proofBinary,[phase==='mutation'?'check':'collect',join(input,'seshat.json'),scratch],{detached:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  let exit;
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,exitSignal)=>{exit={code,signal:exitSignal};resolve();});});
  let leader,descendant;
  try {
    await until(()=>existsSync(marker+'.leader')&&existsSync(marker+'.descendant'),'owned job readiness',30000);
    leader=read(marker+'.leader');descendant=read(marker+'.descendant');
    assert.ok(leader.cwd.startsWith(scratch+'/'));assert.equal(descendant.cwd,leader.cwd);
    assert.ok(leader.group>1&&leader.group!==child.pid&&leader.group!==sentinel.pid);
    assert.equal(descendant.group,leader.group);
    const started=performance.now();if(signal)child.kill(signal);
    await until(()=>exit,'Seshat exit');
    await delay(100);
    const result={exit,ms:performance.now()-started,stdout,stderr,leaderAlive:alive(leader.pid),descendantAlive:alive(descendant.pid),remainingScratch:readdirSync(scratch)};
    results[name]=result;json(join(work,'result.json'),results);
    if (process.env.SESHAT_DEBUG_CLEANUP === '1') {
      console.error(`[DEBUG-macos-cleanup] ${name}: ${JSON.stringify(result)}`);
    }
    assert.equal(readFileSync(join(input,'subject.ts'),'utf8'),source);
    assert.equal(alive(sentinel.pid),true,'cleanup affected an unrelated process');
    if(signal!=='SIGKILL') {
      assert.equal(result.leaderAlive,false,'cancelled Seshat left its test process running');
      assert.equal(result.descendantAlive,false,'cancelled Seshat left its descendant running');
      assert.deepEqual(result.remainingScratch,[]);
      const report=JSON.parse(stdout);assert.equal(report.complete,false);
      if(signal) {
        assert.equal(report.cancelled,true);assert.equal(exit.code,signal==='SIGINT'?130:143);
        if(phase==='mutation') {
          assert.equal(report.mutation.score,null);
          assert.deepEqual(report.mutation.outcomes.map(m=>m.verdict),['survived','cancelled','not-run','not-run']);
          assert.deepEqual(report.mutation.outcomes[1].setups.map(s=>s.state),['failed','cancelled','not-run']);
          assert.equal(report.mutation.jobsAttempted,5);
        } else {
          assert.equal(report.setups[0][phase].state,'cancelled');
          const phases=['typecheck','baseline','coverage'];
          assert.ok(phases.slice(phases.indexOf(phase)+1).every(p=>report.setups[0][p].state==='not-run'));
          assert.ok(report.setups.slice(1).every(s=>phases.every(p=>s[p].state==='not-run')));
        }
      } else {
        assert.equal(exit.code,2);
        assert.equal(report.setups[0].baseline.state,name==='timeout'?'timed-out':'execution-error');
        if(name==='overflow')assert.equal(report.setups[0].baseline.overflow,true);
      }
    } else {
      assert.equal(exit.signal,'SIGKILL');
      assert.equal(result.leaderAlive,true);assert.equal(result.descendantAlive,true);
      assert.ok(result.remainingScratch.length>0,'forced termination cannot run copy cleanup');
    }
    console.log(name+': '+JSON.stringify({...result,stdout:undefined,stderr:undefined}));
  } finally {
    sentinel.kill('SIGKILL');
    if(alive(child.pid)) {
      child.kill('SIGTERM');
      try { await until(()=>exit,'cleanup exit'); } catch { child.kill('SIGKILL'); }
    }
    await done;
    leader??=existsSync(marker+'.leader')?read(marker+'.leader'):undefined;
    descendant??=existsSync(marker+'.descendant')?read(marker+'.descendant'):undefined;
    // Records came from our ready fixture; its dedicated process group is never shared.
    if(leader && (alive(leader.pid)||descendant&&alive(descendant.pid))) {
      try{process.kill(-leader.group,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}
      await until(()=>!alive(leader.pid)&&(!descendant||!alive(descendant.pid)),'fixture group cleanup');
    }
    await sentinelDone;
  }
}
const resultPath = process.env.SESHAT_PROOF_OUTPUT ?? join(work,'result.json');
if (process.env.SESHAT_PROOF_OUTPUT) writeFileSync(resultPath, JSON.stringify(results, null, 2) + '\n');
console.log('Lifecycle evidence: '+resultPath);
