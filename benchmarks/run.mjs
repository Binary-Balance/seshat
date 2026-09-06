import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const work = join(root, 'work/corpus');
const output = join(root, 'outputs');
mkdirSync(work, {recursive: true});
mkdirSync(output, {recursive: true});
mkdirSync(join(root, 'work/mutants'), {recursive: true});
mkdirSync(join(here, 'generated'), {recursive: true});
// Distribute compiled JavaScript in the comparison, rather than charging Node for TS stripping.
const compiled = ts.transpileModule(readFileSync(join(here, 'node.ts'), 'utf8'), {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}, reportDiagnostics:true,
});
assert.equal(compiled.diagnostics.length,0);
writeFileSync(join(here, 'generated/node.mjs'),compiled.outputText);
const corpusRoot = resolve(process.env.SESHAT_BENCH_ROOT ?? join(here, 'fixtures'));
const engines = {
  typescript: [process.execPath, join(here, 'generated/node.mjs'), 'typescript'],
  hybrid: [process.execPath, join(here, 'generated/node.mjs'), 'oxc'],
  rust: [join(here, 'rust/target/release/seshat-bench')],
};
function files(dir) {
  return readdirSync(dir, {withFileTypes:true}).flatMap(entry => {
    if (['node_modules','dist','android','ios','.test-dist','tests','__tests__'].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(path) && !/\.(test|spec|d)\.(ts|tsx)$/.test(path) ? [path] : [];
  }).sort();
}
function manifest(name, paths) {
  const path = join(work, `${name}.json`);
  writeFileSync(path, JSON.stringify(paths));
  return path;
}
const originals = files(corpusRoot);
assert.ok(originals.length, 'The benchmark corpus must contain TypeScript source files.');
const corpus = originals.map(path => {
  const target = join(work, 'input', relative(corpusRoot,path));
  mkdirSync(dirname(target), {recursive:true});
  copyFileSync(path,target);
  return target;
});
const fixture = manifest('fixture',[join(here,'fixtures/edge-cases.tsx')]);
const project = manifest('corpus',corpus);
const mutation = manifest('mutation',[join(here,'fixtures/mutation-source.ts'),join(here,'fixtures/mutation.test.mjs')]);
function invoke(engine, input, mode, repeat=1, rounds=1, warmup=0) {
  const [cmd, ...prefix] = engines[engine];
  const start = performance.now();
  const child = spawnSync(cmd, [...prefix,input,mode,String(repeat),String(rounds),String(warmup)], {
    cwd:here, encoding:'utf8', timeout:60000, maxBuffer:16*1024*1024,
    env:{...process.env, SESHAT_NODE:process.execPath, SESHAT_MUTANT_TARGET:join(root,'work/mutants',`${engine}.ts`)},
  });
  const wallMs = performance.now()-start;
  assert.ifError(child.error);
  assert.equal(child.status,0,`${engine} ${mode}: ${child.error ?? ''}\n${child.stdout}\n${child.stderr}`);
  return {wallMs, data:JSON.parse(child.stdout)};
}
const golden = invoke('typescript',fixture,'dump').data;
assert.deepEqual(golden[0].functions.map(f=>f[2]),[6,2,1,1,8,2,3]);
assert.equal(golden[0].comparisons.length,14);
const projectGolden = invoke('typescript',project,'dump').data;
for (const engine of ['hybrid','rust']) {
  assert.deepEqual(invoke(engine,fixture,'dump').data,golden,`${engine}: fixture mismatch`);
  const actual = invoke(engine,project,'dump').data;
  for (let i=0;i<corpus.length;i++) assert.deepEqual(actual[i],projectGolden[i],`${engine}: ${relative(work,corpus[i])}`);
}
const counts = projectGolden.reduce((sum, r) => ({functions:sum.functions+r.functions.length, comparisons:sum.comparisons+r.comparisons.length}),{functions:0,comparisons:0});
console.log('Parity passed:',corpus.length,'files',counts);
if (process.argv.includes('--check')) process.exit(0);

const results = {date:new Date().toISOString(), environment:{node:process.version,typescript:ts.version,oxc:'0.148.0',nodeEntry:'precompiled JavaScript',rust:'1.98.1 release thin-LTO',platform:process.platform,arch:process.arch,cpu:os.cpus()[0].model,cpuCount:os.availableParallelism()},
  corpus:{files:corpus.length,bytes:corpus.reduce((s,p)=>s+statSync(p).size,0),...counts,sha256:createHash('sha256').update(corpus.map(p=>readFileSync(p)).join('\n')).digest('hex')},
  parity:{fixture:true,corpus:true}, samples:[], mutation:[]};
const names = Object.keys(engines);
for (const repeat of [1,20]) {
  for (const mode of ['parse','analyze']) {
    console.log('Measuring',mode,'repeat',repeat);
    for (let sample=0;sample<7;sample++) {
      for (let j=0;j<3;j++) {
        const engine=names[(sample+j)%3];
        const cold=invoke(engine,project,mode,repeat);
        results.samples.push({engine,mode,repeat,phase:'fresh-process',sample,...cold});
      }
    }
    for (let sample=0;sample<3;sample++) {
      for (let j=0;j<3;j++) {
        const engine=names[(sample+j)%3];
        results.samples.push({engine,mode,repeat,phase:'warm',sample,...invoke(engine,project,mode,repeat,5,3)});
      }
    }
  }
}
let expected;
for (let sample=0;sample<5;sample++) {
  for(let j=0;j<3;j++) {
    const engine=names[(sample+j)%3];
    const run=invoke(engine,mutation,'mutate');
    if (!expected) expected=run.data.outcomes;
    assert.deepEqual(run.data.outcomes,expected);
    assert.equal(expected.filter(o=>o[2]==='killed').length,8);
    assert.equal(expected.filter(o=>o[2]==='survived').length,2);
    results.mutation.push({engine,sample,...run});
  }
}
writeFileSync(join(output,'benchmark-results.json'),JSON.stringify(results,null,2)+'\n');
const median=values=>{const s=[...values].sort((a,b)=>a-b);return s[Math.floor(s.length/2)];};
const summary=[];
for(const repeat of [1,20]) for(const engine of names) {
  const rows=results.samples.filter(s=>s.repeat===repeat&&s.engine===engine&&s.mode==='analyze');
  summary.push({repeat,engine,coldMs:median(rows.filter(r=>r.phase==='fresh-process').map(r=>r.wallMs)),warmMs:median(rows.filter(r=>r.phase==='warm').flatMap(r=>r.data.times)),rssMb:median(rows.filter(r=>r.phase==='fresh-process').map(r=>r.data.maxRssKb/1024))});
}
console.table(summary);
console.table(names.map(engine=>({engine,mutationMs:median(results.mutation.filter(r=>r.engine===engine).map(r=>r.wallMs))})));
