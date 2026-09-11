// Maintainer-only complete userspace proof. No host libraries or toolchain are mounted.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(process.platform,'linux'); assert.equal(process.arch,'x64');
assert.equal(process.argv.length,5,'usage: node benchmarks/proofs/linux-debian.mjs <archive directory> <pack result.json> <standalone archive>');
const archives = resolve(process.argv[2]);
const packed = JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'));
const standaloneArchive = resolve(process.argv[4]);
assert.ok(statSync(standaloneArchive).isFile());
const inputs = [
  {file:'rootfs.tar.gz',sha256:'94b0efe6d4f788b1b894c04a6c6885d53a41bcd0b85757fffacd2bc4de142847',
    url:'https://raw.githubusercontent.com/debuerreotype/docker-debian-artifacts/bae6d64d90b4068b09ff9d8b564c2773ef5d8d83/bullseye/oci/blobs/rootfs.tar.gz'},
  {file:'node.tar.xz',sha256:'2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2',
    url:'https://nodejs.org/dist/v24.20.0/node-v24.20.0-linux-x64.tar.xz'},
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const input of inputs) assert.equal(hash(readFileSync(join(archives,input.file))),input.sha256,input.file);
const standaloneSha256 = hash(readFileSync(standaloneArchive));
const work = mkdtempSync(join(repo,'work/debian11-'));
const rootfs = join(work,'rootfs'), node = join(work,'node'), consumer = join(work,'consumer');
for (const directory of [rootfs,node,join(consumer,'assurance-proofs')]) mkdirSync(directory,{recursive:true});
const checks = {};
function run(name,command,args) {
  console.log(name);
  const start = performance.now();
  const child = spawnSync(command,args,{cwd:repo,encoding:'utf8',timeout:600000,maxBuffer:16*1024*1024});
  checks[name] = {status:child.status,ms:performance.now()-start,stdout:child.stdout,stderr:child.stderr};
  writeFileSync(join(work,'checks.json'),JSON.stringify(checks,null,2)+'\n');
  assert.ifError(child.error); assert.equal(child.status,0,child.stdout+child.stderr);
}
run('extract-debian','tar',['-xzf',join(archives,'rootfs.tar.gz'),'-C',rootfs,'--no-same-owner']);
run('extract-node','tar',['-xJf',join(archives,'node.tar.xz'),'-C',node,'--strip-components=1','--no-same-owner']);
mkdirSync(join(rootfs,'seshat'));
// This script and every process it starts run inside Debian, including npm and tsc.
const script = String.raw`
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {release} from 'node:os';
const read = path => JSON.parse(readFileSync(path,'utf8'));
const checks = {};
const kernel = release();
const kernelVersion = kernel.match(/^(\d+)\.(\d+)/);
assert.ok(kernelVersion && (Number(kernelVersion[1]) > 6 || Number(kernelVersion[1]) === 6 && Number(kernelVersion[2]) >= 8),
  'candidate kernel floor is Linux 6.8; got '+kernel);
function run(name,command,args,env=process.env) {
  const start=performance.now();
  const child=spawnSync(command,args,{env,encoding:'utf8',timeout:300000,maxBuffer:16*1024*1024});
  checks[name]={status:child.status,ms:performance.now()-start,stdout:child.stdout,stderr:child.stderr};
  writeFileSync('/seshat/work/checks.json',JSON.stringify(checks,null,2)+'\n');
  assert.ifError(child.error); assert.equal(child.status,0,child.stdout+child.stderr);
  console.log(name+': passed'); return child.stdout;
}
const os=readFileSync('/etc/os-release','utf8');
assert.match(os,/^VERSION_ID="11"$/m);
assert.equal(process.version,'v24.20.0'); assert.equal(process.arch,'x64');
assert.equal(process.report.getReport().header.glibcVersionRuntime,'2.31');
for(const command of ['cargo','rustc']) assert.equal(spawnSync(command,['--version']).error?.code,'ENOENT');
const npm=run('npm-version','npm',['--version']).trim();
const libraries=run('node-libraries','ldd',[process.execPath]);
assert.doesNotMatch(libraries,/not found/);
run('debian-packages','dpkg-query',['-W','libc6','libgcc-s1','libstdc++6']);
const output=run('installed-package',process.execPath,['/seshat/benchmarks/proofs/npm-package.mjs','/opt/package.tgz']);
const install=read(output.match(/Results: (.+)/)[1]);
const cliSummary=install.checks['installed-cli-regression'].stdout.match(/CLI passed: (\d+) scenarios plus legacy parity/);
assert.ok(cliSummary && Number(cliSummary[1]) > 0, install.checks['installed-cli-regression'].stdout);
assert.equal(install.checks['installed-cli-regression'].status,0);
assert.doesNotMatch(run('installed-libraries','ldd',[install.installedBinary]),/not found/);
const parallel=run('installed-parallel',process.execPath,['/seshat/benchmarks/proofs/parallel.mjs'],
  {...process.env,SESHAT_PARALLEL_CLI:'1',SESHAT_CLI_BINARY:install.installedBinary});
const parallelPath=parallel.match(/Parallel evidence: (.+)/)[1];
assert.equal(Object.keys(read(parallelPath)).length,11);
const standaloneOutput=run('installed-standalone',process.execPath,
  ['/seshat/benchmarks/proofs/standalone.mjs','/opt/standalone.tar.gz','/seshat/benchmarks/rust/target/release/seshat-proofs'],
  {...process.env,SESHAT_STANDALONE_SHA256:'${standaloneSha256}',SESHAT_BINARY_SHA256:install.build.binarySha256});
const standalonePath=standaloneOutput.match(/Results: (.+)/)[1];
const standalone=read(standalonePath);
assert.equal(standalone.archiveSha256,'${standaloneSha256}');
assert.equal(standalone.build.binarySha256,install.build.binarySha256);
assert.equal(standalone.cliScenarios,43);
assert.equal(Object.keys(standalone.parallelChecks).length,11);
const result={os,kernel,kernelFloor:'6.8',architecture:process.arch,glibc:'2.31',node:process.version,npm,
  typescript:read('/seshat/benchmarks/node_modules/typescript/package.json').version,
  runner:'node:test '+process.version,
  coverage:Object.fromEntries(['istanbul-lib-instrument','istanbul-lib-coverage','istanbul-lib-source-maps'].map(name=>
    [name,read('/seshat/benchmarks/proofs/node_modules/'+name+'/package.json').version])),
  rustAvailable:false,network:'isolated namespace',build:install.build,
  packageReport:output.match(/Results: (.+)/)[1],parallelReport:parallelPath,
  standaloneReport:standalonePath,standaloneArchiveSha256:'${standaloneSha256}',
  standaloneCliScenarios:standalone.cliScenarios,
  checks,
  cliChecks:read(install.checks['installed-cli-regression'].stdout.match(/Results: (.+)/)[1]),
  parallelChecks:read(parallelPath),standaloneChecks:standalone.checks,
  standaloneParallelChecks:standalone.parallelChecks};
writeFileSync('/seshat/work/result.json',JSON.stringify(result,null,2)+'\n');
`;
// Keep the consumer filesystem read-only except disposable inputs, scratch and reports.
run('debian-consumer','bwrap',['--unshare-all','--uid','0','--gid','0','--die-with-parent',
  '--ro-bind',rootfs,'/','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--tmpfs','/root',
  '--tmpfs','/opt','--ro-bind',node,'/opt/node','--ro-bind',packed.tarball,'/opt/package.tgz',
  '--ro-bind',standaloneArchive,'/opt/standalone.tar.gz',
  '--tmpfs','/seshat','--ro-bind',join(repo,'benchmarks/proofs'),'/seshat/benchmarks/proofs',
  '--ro-bind',join(repo,'benchmarks/node_modules'),'/seshat/benchmarks/node_modules',
  '--ro-bind',packed.proofBinary,'/seshat/benchmarks/rust/target/release/seshat-proofs',
  '--bind',consumer,'/seshat/work','--chdir','/seshat','--clearenv',
  '--setenv','PATH','/opt/node/bin:/usr/bin:/bin','--setenv','LANG','C.UTF-8',
  '/opt/node/bin/node','--input-type=module','-e',script]);
const result = {inputs,tarballSha256:hash(readFileSync(packed.tarball)),standaloneArchiveSha256:standaloneSha256,
  proofBinarySha256:hash(readFileSync(packed.proofBinary)),
  ...JSON.parse(readFileSync(join(consumer,'result.json'),'utf8')),
  limits:'Debian 11 userspace on the recorded host kernel, not a Debian 11 kernel test. Node runner controls only; Jest/Expo and Vitest compatibility are tracked separately.'};
const resultPath = process.env.SESHAT_DEBIAN_OUTPUT ? resolve(process.env.SESHAT_DEBIAN_OUTPUT) : join(work,'result.json');
writeFileSync(resultPath,JSON.stringify(result,null,2)+'\n');
console.log(`Debian 11 installed-package proof passed. Results: ${resultPath}`);
