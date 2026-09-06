// Shared Linux-only supervision for trusted local proof commands, not a sandbox.
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';

export async function runProcess(command,args,cwd,extraEnv={},timeoutMs=30000) {
  const start=performance.now();
  const env={...process.env}; delete env.SESHAT_MUTANT_ID; delete env.NODE_OPTIONS;
  return await new Promise((resolveRun,reject)=>{
    const child=spawn(command,args,{cwd,env:{...env,...extraEnv},detached:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',timedOut=false,overflow=false;
    const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')reject(error);}};
    const timer=setTimeout(()=>{timedOut=true;kill();},timeoutMs);
    const collect=(stream,text)=>{
      if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)+text.length>4*1024*1024){overflow=true;kill();}
      else if(stream==='stdout')stdout+=text;else stderr+=text;
    };
    child.stdout.on('data',data=>collect('stdout',data.toString()));
    child.stderr.on('data',data=>collect('stderr',data.toString()));
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',kill);
    child.once('close',(status,signal)=>{clearTimeout(timer);resolveRun({status,signal,timedOut,overflow,ms:performance.now()-start,stdout,stderr});});
  });
}
