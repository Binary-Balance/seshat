// Coverage-provider proof. Conversion stays in existing Istanbul tooling.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import ts from '../node_modules/typescript/lib/typescript.js';
import instrument from 'istanbul-lib-instrument';
import coverage from 'istanbul-lib-coverage';
import sourceMaps from 'istanbul-lib-source-maps';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here,'../..');
const binary = join(repo,'benchmarks/rust/target/release/seshat-proofs');
const modules = join(here,'node_modules');
const scratch = join(repo,'work/assurance-proofs');
mkdirSync(scratch,{recursive:true});
const project = mkdtempSync(join(scratch,'coverage-'));
const json = (path,value) => writeFileSync(path,JSON.stringify(value,null,2)+'\n');
const original = readFileSync(join(here,'coverage-subject.tsx'),'utf8');
const source = join(project,'subject.tsx');
writeFileSync(source,original+`\nexport function unicode(flag: boolean) { const label = '🎸'; if (flag) return label; return 'off'; }\n`);
const unloaded = join(project,'unloaded.tsx');
writeFileSync(unloaded,`export function untouched() { return 7; }\n`);
copyFileSync(join(here,'checks.cjs'),join(project,'checks.cjs'));
json(join(project,'package.json'),{private:true,type:'commonjs'});

function run(command,args) {
  const start=performance.now();
  const child=spawnSync(command,args,{cwd:project,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
  assert.ifError(child.error);
  return {status:child.status,ms:performance.now()-start,stdout:child.stdout,stderr:child.stderr};
}
function score(path,...reports) {
  const child=run(binary,['score',path,...reports]);
  const result=JSON.parse(child.stdout);
  assert.equal(child.status,result.complete?0:2,child.stderr);
  return result;
}

// Seed only files actually instrumented, using the instrumenter's zero counters.
// Missing report files must never be fabricated as zero coverage in Rust.
const initial=coverage.createCoverageMap({});
for (const path of [source,unloaded]) {
  const compiled=path.replace(/\.tsx$/,'.cjs');
  const result=ts.transpileModule(readFileSync(path,'utf8'),{fileName:path,compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,
    sourceMap:true,inlineSources:true},reportDiagnostics:true});
  assert.equal(result.diagnostics.length,0);
  // Inline the same map for Jest's Babel coverage route.
  const map=JSON.parse(result.sourceMapText);
  const code=result.outputText.replace(/\/\/# sourceMappingURL=.*$/m,'');
  writeFileSync(compiled,code+'\n//# sourceMappingURL=data:application/json;base64,'+Buffer.from(result.sourceMapText).toString('base64'));
  const tool=instrument.createInstrumenter();
  const instrumented=tool.instrumentSync(code,compiled,map);
  writeFileSync(path.replace(/\.tsx$/,'.instrumented.cjs'),instrumented);
  initial.addFileCoverage(tool.lastFileCoverage());
}

writeFileSync(join(project,'checks.node.cjs'),`const {test,after}=require('node:test');\nconst subject=require('./subject.instrumented.cjs');\ntest('coverage',()=>{require('./checks.cjs').coverage(subject); subject.unicode(true);});\nafter(()=>require('node:fs').writeFileSync('node-raw.json',JSON.stringify(globalThis.__coverage__)));\n`);
writeFileSync(join(project,'checks.jest.cjs'),`const subject=require('./subject.cjs');\ntest('coverage',()=>{require('./checks.cjs').coverage(subject); subject.unicode(true);});\n`);
writeFileSync(join(project,'checks.vitest.mjs'),`import {test} from ${JSON.stringify(join(modules,'vitest/dist/index.js'))};\nimport * as subject from './subject.tsx';\nimport checks from './checks.cjs';\ntest('coverage',()=>{checks.coverage(subject); subject.unicode(true);});\n`);
writeFileSync(join(project,'jest.config.cjs'),`module.exports={rootDir:__dirname,testMatch:['**/checks.jest.cjs'],testEnvironment:'node',coverageProvider:'babel',collectCoverageFrom:['subject.cjs','unloaded.cjs'],coverageReporters:['json'],coverageDirectory:'coverage-jest'};\n`);

const routes={
  node:['--test','checks.node.cjs'],
  jest:[join(modules,'jest/bin/jest.js'),'--config','jest.config.cjs','--runInBand','--coverage'],
};
for (const provider of ['v8','istanbul']) {
  const runner=`vitest-${provider}`;
  writeFileSync(join(project,`${runner}.config.mjs`),`export default {test:{include:['checks.vitest.mjs'],coverage:{provider:'${provider}',include:['subject.tsx','unloaded.tsx'],reporter:['json'],reportsDirectory:'coverage-${runner}'}}};\n`);
  routes[runner]=[join(modules,'vitest/vitest.mjs'),'run','--config',`${runner}.config.mjs`,'--coverage','--maxWorkers=1','--no-file-parallelism'];
}
const versions=Object.fromEntries(['vitest','@vitest/coverage-v8','@vitest/coverage-istanbul','jest','istanbul-lib-instrument','istanbul-lib-coverage','istanbul-lib-source-maps'].map(name=>[name,JSON.parse(readFileSync(join(modules,name,'package.json'),'utf8')).version]));
const results={environment:{node:process.version,typescript:ts.version,tools:versions},project,
  sourceHashes:Object.fromEntries([source,unloaded].map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')])),routes:{}};
for (const [runner,args] of Object.entries(routes)) {
  const execution=run(process.execPath,args);
  assert.equal(execution.status,0,execution.stdout+execution.stderr);
  let report=join(project,`coverage-${runner}/coverage-final.json`);
  if (runner==='node') {
    initial.merge(JSON.parse(readFileSync(join(project,'node-raw.json'),'utf8')));
    const mapped=await sourceMaps.createSourceMapStore().transformCoverage(initial);
    report=join(project,'node-mapped.json');
    json(report,mapped.toJSON());
  }
  const measured=score(source,report);
  const unused=score(unloaded,report);
  results.routes[runner]={executionMs:execution.ms,report,measured,unused};
  console.log(`${runner}: loaded=${measured.complete}, unloaded=${unused.complete}; ${measured.problems.join('; ')}`);
}
for (const runner of ['node','jest','vitest-istanbul']) {
  const {measured,unused}=results.routes[runner];
  assert.equal(measured.complete,true,JSON.stringify(measured));
  assert.equal(unused.complete,true);
  const named=Object.fromEntries(measured.functions.map(f=>[f.name,f]));
  for (const [name,complexity,covered,total] of [['covered',2,3,3],['partial',2,2,3],['never',1,0,1],['defaults',4,1,1],['outer',2,3,3],['inner',2,2,3],['unicode',2,3,4]]) {
    assert.deepEqual([named[name].complexity,named[name].covered,named[name].total],[complexity,covered,total],`${runner}/${name}`);
    assert.ok(Math.abs(named[name].crap - (complexity**2*(1-covered/total)**3+complexity))<1e-12);
  }
  assert.equal(named.empty.status,'not-applicable');
  const arrows=measured.functions.filter(f=>f.name.startsWith('arrow@'));
  assert.equal(arrows.length,3);
  assert.ok(arrows.every(f=>f.total===1&&f.covered===1));
  assert.deepEqual(measured.functions.filter(f=>f.status==='complexity-only').map(f=>f.complexity),[2,2]);
  assert.deepEqual(unused.functions.map(f=>[f.name,f.covered,f.total,f.crap]),[['untouched',0,1,2]]);
}
assert.equal(results.routes['vitest-v8'].measured.complete,false);
assert.ok(results.routes['vitest-v8'].measured.problems.some(p=>p.startsWith('statement escapes owning scope')));

const reference=results.routes.node.report;
const template=JSON.parse(readFileSync(reference,'utf8'));
results.negativeChecks={};
function rejected(label,edit) {
  const bad=structuredClone(template);
  edit(bad);
  const path=join(project,`${label}.json`); json(path,bad);
  const result=score(source,path);
  assert.equal(result.complete,false,label);
  results.negativeChecks[label]=result.problems;
}
const first=Object.keys(template[source].statementMap)[0];
rejected('null-start',r=>{r[source].statementMap[first].start.column=null;});
rejected('missing-end',r=>{delete r[source].statementMap[first].end.column;});
rejected('invalid-line',r=>{r[source].statementMap[first].end={line:10000,column:null};});
rejected('negative-counter',r=>{r[source].s[first]=-1;});
rejected('missing-file',r=>{delete r[source];});
// A broad end must not be shortened across the next same-line function.
const arrow=Object.entries(template[source].statementMap).find(([,loc])=>loc.start.line===27&&loc.start.column===36)[0];
rejected('cross-function-end',r=>{r[source].statementMap[arrow].end={line:27,column:null};});
assert.deepEqual(score(source,reference,reference),results.routes.node.measured);
assert.deepEqual(score(source,reference,results.routes.jest.report),results.routes.node.measured);
results.merging={nodeAndJest:score(source,reference,results.routes.jest.report),nodeAndVitest:score(source,reference,results.routes['vitest-istanbul'].report)};
assert.equal(results.merging.nodeAndVitest.complete,false);
assert.ok(results.merging.nodeAndVitest.problems.includes('incompatible statement mappings'));
const destination=resolve(process.env.SESHAT_PROOF_OUTPUT ?? join(repo,'outputs/coverage-routes.json'));
json(destination,results);
assert.equal(readFileSync(join(here,'coverage-subject.tsx'),'utf8'),original);
console.log(`Results: ${destination}`);
