// Disposable, real Node tests. Event files deliberately share only this proof's directory.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {alive} from './liveness.mjs';

const here=dirname(fileURLToPath(import.meta.url)),repo=resolve(here,'../..');
mkdirSync(join(repo,'work/assurance-proofs'),{recursive:true});
const work=mkdtempSync(join(repo,'work/assurance-proofs/parallel-'));
const candidate = process.env.SESHAT_PARALLEL_CLI === '1';
const binary = candidate && process.env.SESHAT_CLI_BINARY
  ? resolve(process.env.SESHAT_CLI_BINARY)
  : join(repo,'benchmarks/rust/target/release',candidate?'seshat':'seshat-proofs');
const input=join(work,'input');mkdirSync(input);
const source='export function adult(age: number) { return age >= 18; }\nexport const initial = 2 < 3;\n';
const originals={
  'package.json':'{"type":"module"}', 'subject.ts':source,
  'high.mjs':"import {test} from 'node:test';import assert from 'node:assert/strict';import {adult,initial} from './subject.ts';test('high',()=>{assert.equal(adult(20),true);assert.equal(initial,true);});",
  'low.mjs':"import {test} from 'node:test';import assert from 'node:assert/strict';import {adult,initial} from './subject.ts';test('low',()=>{assert.equal(adult(10),false);assert.equal(initial,true);});",
  'runner.cjs':String.raw`const fs=require('node:fs'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const [test,mode,events]=process.argv.slice(2),execution=process.env.SESHAT_EXECUTION_ID;
const mutant=execution.match(/-mutant-(\d+)-/),source=fs.readFileSync('subject.ts','utf8');
const record=(kind,extra={})=>{const path=events+'/'+process.pid+'-'+kind+'.json';
  fs.writeFileSync(path+'.tmp',JSON.stringify({kind,pid:process.pid,cwd:process.cwd(),execution,source,time:Date.now(),...extra}));fs.renameSync(path+'.tmp',path);};
if(!mutant&&mode==='worker-baseline-error'&&execution.includes('-worker-'))process.exit(1);
async function main(){
  if(mutant){
    fs.writeFileSync('worker-state.txt',String(process.pid));
    if(mode==='cancel'||mode==='timeout'){
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
      record('start',{descendant:child.pid});setInterval(()=>{},1000);return;
    }
    record('start');
    await new Promise(resolve=>setTimeout(resolve,400));
    assert.equal(fs.readFileSync('worker-state.txt','utf8'),String(process.pid));
    assert.equal(fs.readFileSync('subject.ts','utf8'),source);
    if(mode==='source-error'){fs.writeFileSync('subject.ts','changed');process.exit(1);}
    if(mode==='receipt-error')process.exit(1);
  }
  const child=spawn(process.execPath,['--test','--test-concurrency=1','--test-reporter='+process.env.SESHAT_NODE_REPORTER,test+'.mjs'],{stdio:'inherit'});
  child.on('exit',(code)=>{if(mutant){assert.equal(fs.readFileSync('subject.ts','utf8'),source);record('end');}process.exit(code??2);});
}
main().catch(error=>{console.error(error);process.exit(2);});`
};
for(const [name,bytes] of Object.entries(originals))writeFileSync(join(input,name),bytes);
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const events=path=>readdirSync(path).filter(name=>name.endsWith('.json')).map(name=>read(join(path,name)));
async function until(predicate,timeout=30000){const end=performance.now()+timeout;while(performance.now()<end){if(predicate())return;await delay(10);}throw Error('Timed out waiting for proof processes');}
const results={};
async function check(name,workers,mode='normal',signal){
  const directory=join(work,name);mkdirSync(directory);
  const scratch=join(directory,'scratch'),journal=join(directory,'events');mkdirSync(scratch);mkdirSync(journal);
  const setups=['high','low'].map((test,index)=>({name:test,runner:'node',cwd:'.',timeoutMs:mode==='timeout'?3000:30000,
    typecheck:[process.execPath,join(repo,'benchmarks/node_modules/typescript/bin/tsc'),'--ignoreConfig','--strict','--noEmit','--skipLibCheck','subject.ts'],
    test:[process.execPath,'runner.cjs',test,mode,journal],
    coverage:{command:[process.execPath,join(here,'collect-node.mjs'),test+'.mjs'],report:'coverage-'+index+'/final.json'}}));
  const config={source:{include:['subject.ts']},capture:Object.keys(originals),setups};
  if(workers!==undefined)config.workers=workers;
  const path=join(input,'seshat.json');writeFileSync(path,JSON.stringify(config));
  const start=performance.now();
  const child=spawn(binary,candidate?['check','--config',path,'--scratch',scratch,'--json']:['check',path,scratch],{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',exit;
  child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{exit={code,signal};resolve();});});
  try {
    if(signal){await until(()=>events(journal).filter(e=>e.kind==='start').length===workers);child.kill(signal);}
    await until(()=>exit,90000);await done;
    const report=JSON.parse(stdout),result=candidate?report.result:report,observed=events(journal),ms=performance.now()-start;
    results[name]={ms,result,progress:stderr,events:observed};
    writeFileSync(join(work,'result.json'),JSON.stringify(results,null,2)+'\n');
    if(process.env.SESHAT_DEBUG_PARALLEL==='1' && !result.complete) {
      console.error(`[DEBUG-parallel-report] ${name}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    if(candidate){
      const snapshots=[...stderr.matchAll(/mutation: completed (\d+)\/(\d+), running (\d+), remaining (\d+)/g)];
      for(const snapshot of snapshots){
        const [completed,total,running,remaining]=snapshot.slice(1).map(Number);
        assert.equal(total,4); assert.equal(completed+running+remaining,total);
        assert.ok(running<=Math.min(workers??1,4));
      }
      assert.match(stderr,new RegExp(`mutation finished: completed ${result.mutation.completed}/4, running 0, not run ${result.mutation.notRun}, resolved ${result.mutation.killed+result.mutation.survived}, unresolved ${result.mutation.unresolved}`));
      assert.equal(result.mutation.completed+result.mutation.notRun,4);
      assert.equal(result.mutation.unresolved,4-result.mutation.killed-result.mutation.survived);
      if(mode==='normal')assert.ok(snapshots.some(s=>Number(s[3])>0));
    }
    assert.equal(exit.code,signal==='SIGINT'?130:signal==='SIGTERM'?143:result.complete?0:2,stdout+stderr);
    assert.deepEqual(readdirSync(scratch),[]);
    for(const [name,bytes] of Object.entries(originals))assert.equal(readFileSync(join(input,name),'utf8'),bytes);
    const starts=observed.filter(e=>e.kind==='start');
    assert.ok(starts.every(e=>e.cwd.startsWith(scratch+'/')));
    assert.ok(starts.every(e=>!alive(e.pid)&&(!e.descendant||!alive(e.descendant))));
    if(mode==='normal'){
      assert.equal(result.complete,true,stdout);
      assert.deepEqual(result.mutation.outcomes.map(m=>m.verdict),['survived','killed','survived','killed']);
      assert.equal(result.mutation.score,50);assert.equal(result.mutation.jobsAttempted,8);
      assert.deepEqual(result.sources,[{path:'subject.ts',result:{complete:true,functions:[{
        complexity:1,coverage:1,covered:1,crap:1,name:'adult',start:7,status:'measured',total:1
      }],problems:[]}}]);
      const count=Math.min(workers??1,4);
      assert.equal(result.mutation.workersUsed,count);assert.equal(result.mutation.workerBaselineJobs,(count-1)*2);
      assert.equal(result.jobsAttempted,6+8+(count-1)*2);
      let active=0,peak=0;const activeRoots=new Set();
      for(const event of observed.sort((a,b)=>a.time-b.time||(a.kind==='end'?-1:1))){
        if(event.kind==='start'){assert.ok(!activeRoots.has(event.cwd),'workers shared writable files');activeRoots.add(event.cwd);peak=Math.max(peak,++active);}
        else {assert.ok(activeRoots.delete(event.cwd));active--;}
      }
      assert.equal(active,0);assert.equal(peak,count,'configured workers did not overlap');
      assert.equal(new Set(starts.map(e=>e.cwd)).size,count);
    } else {
      assert.equal(result.complete,false);assert.equal(result.mutation.score,null);
      if(mode==='worker-baseline-error'){
        assert.equal(result.mutation.jobsAttempted,0);assert.equal(starts.length,0);
        assert.equal(result.mutation.workerBaselines[0].state,'execution-error');
      } else if(signal){
        assert.equal(result.cancelled,true);
        assert.deepEqual(result.mutation.outcomes.map(m=>m.verdict),['cancelled','cancelled','not-run','not-run']);
        assert.equal(result.mutation.jobsAttempted,2);
      } else {
        assert.ok(result.mutation.outcomes.some(m=>m.verdict==='not-run'));
        assert.ok(result.mutation.outcomes.some(m=>m.verdict===(mode==='timeout'?'timed-out':'execution-error')));
      }
    }
    console.log(name+': '+JSON.stringify({complete:result.complete,ms,workers:result.mutation.workersUsed,preparationMs:result.mutation.workerPreparationMs,mutationMs:result.mutation.mutationWallMs}));
    return result;
  } finally {
    if(!exit){child.kill('SIGTERM');try{await until(()=>exit,5000);}catch{child.kill('SIGKILL');}}
    await done;
    // The fixture records only its own dedicated job groups and descendant PIDs.
    for(const event of events(journal).filter(e=>e.kind==='start')){
      if(alive(event.pid)||event.descendant&&alive(event.descendant)){
        try{process.kill(-event.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}
        await until(()=>!alive(event.pid)&&(!event.descendant||!alive(event.descendant)),5000);
      }
    }
  }
}
const cases={serial:[undefined],parallel:[2],repeat:[2],four:[4],capped:[20],
  'worker-baseline-error':[2,'worker-baseline-error'],'receipt-error':[2,'receipt-error'],
  'source-error':[2,'source-error'],timeout:[2,'timeout'],SIGINT:[2,'cancel','SIGINT'],SIGTERM:[2,'cancel','SIGTERM']};
for(const name of (process.env.SESHAT_PARALLEL_CASES??Object.keys(cases).join(',')).split(',')){
  assert.ok(Object.hasOwn(cases,name));await check(name,...cases[name]);
}
console.log('Parallel evidence: '+join(work,'result.json'));
