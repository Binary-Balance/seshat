// Shared supervision for trusted local proof commands, not a sandbox.
import {spawn, spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {delimiter, dirname, join} from 'node:path';
import {performance} from 'node:perf_hooks';

export const nodeCommand = process.execPath;
const npmCli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
export const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
export const npmArgs = process.platform === 'win32' ? [npmCli] : [];

export function rustFreeEnvironment() {
  const env = {...process.env};
  const rustExecutables = ['cargo', 'cargo.exe', 'cargo.cmd', 'rustc', 'rustc.exe', 'rustc.cmd'];
  const hasRust = path => rustExecutables.some(name => existsSync(join(path, name)));
  env.PATH = (env.PATH ?? '').split(delimiter).filter(path => path && !hasRust(path)).join(delimiter);
  // Keep removals explicit: runProcess merges this full env over its parent copy.
  for (const name of ['CARGO_HOME', 'RUSTUP_HOME', 'CARGO_TARGET_DIR', 'NODE_OPTIONS', 'SESHAT_MUTANT_ID']) {
    env[name] = undefined;
  }
  return env;
}

export function killTree(pid) {
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {stdio: 'ignore'});
    if (result.error && result.error.code !== 'ESRCH') throw result.error;
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

export async function noRustProof(cwd) {
  const before = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const env = rustFreeEnvironment();
  const after = (env.PATH ?? '').split(delimiter).filter(Boolean);
  const probes = await Promise.all(['cargo', 'rustc'].map(command => probeMissing(command, cwd, env)));
  if (probes.some(probe => !probe.unavailable)) throw new Error('Rust tool is available in the consuming PATH');
  const environmentNames = ['CARGO_HOME', 'RUSTUP_HOME', 'CARGO_TARGET_DIR', 'NODE_OPTIONS', 'SESHAT_MUTANT_ID'];
  const environmentProbe = await runProcess(nodeCommand, ['-e',
    `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(environmentNames)}.map(name => [name, process.env[name]]))));setTimeout(() => {}, 50)`,
  ], cwd, env, 5000);
  if (environmentProbe.status !== 0) throw new Error(`consuming environment probe failed: ${environmentProbe.stderr}`);
  const observed = JSON.parse(environmentProbe.stdout);
  if (environmentNames.some(name => observed[name] !== undefined)) {
    throw new Error('ambient consuming environment leaked into installed proof');
  }
  return {
    env,
    evidence: {
      pathEntries: after.length,
      rustPathEntriesRemoved: before.filter(path => !after.includes(path)).length,
      probes,
      rustEnvironmentUnset: ['CARGO_HOME', 'RUSTUP_HOME', 'CARGO_TARGET_DIR'],
      environmentUnset: environmentNames,
    },
  };
}

export async function probeMissing(command, cwd, extraEnv) {
  try {
    const result = await runProcess(command, ['--version'], cwd, extraEnv, 5000);
    return {command, unavailable: false, status: result.status};
  } catch (error) {
    if (error.code === 'ENOENT') return {command, unavailable: true};
    throw error;
  }
}

export async function runProcess(command,args,cwd,extraEnv={},timeoutMs=30000) {
  const start=performance.now();
  const env={...process.env}; delete env.SESHAT_MUTANT_ID; delete env.NODE_OPTIONS;
  return await new Promise((resolveRun,reject)=>{
    const child=spawn(command,args,{cwd,env:{...env,...extraEnv},detached:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',timedOut=false,overflow=false;
    const kill=()=>{
      try { killTree(child.pid); } catch (error) { reject(error); }
    };
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
