// Maintainer-only compatibility experiment. Never installs system libraries.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {release} from 'node:os';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
assert.equal(process.argv.length, 3, 'usage: node benchmarks/proofs/linux-glibc.mjs <directory containing the three documented Debian archives>');
const archives = resolve(process.argv[2]);
const packages = [
  ['libc6.deb', 'glibc/libc6_2.31-13+deb11u11_amd64.deb', '05f7264da867b37f4c5ce49266b558ea1e81e05a9464f623152fca70f3550282'],
  ['libc6-dev.deb', 'glibc/libc6-dev_2.31-13+deb11u11_amd64.deb', 'e7f7b45d9c5cfcf37609f0b6efd3c645272c812144703af89dfd32218fcb0fd3'],
  ['libgcc-s1.deb', 'gcc-10/libgcc-s1_10.2.1-6_amd64.deb', 'e478f2709d8474165bb664de42e16950c391f30eaa55bc9b3573281d83a29daf'],
].map(([file,path,sha256]) => ({file,url:`https://deb.debian.org/debian/pool/main/g/${path}`,sha256}));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const pkg of packages) assert.equal(hash(readFileSync(join(archives,pkg.file))), pkg.sha256, pkg.file);
const work = mkdtempSync(join(repo,'work/glibc-proof-'));
const sysroot = join(work,'sysroot'); mkdirSync(sysroot);
const evidence = {};
function run(name, command, args, env = process.env, status = 0) {
  console.log(name);
  const started = performance.now();
  const child = spawnSync(command,args,{cwd:repo,env,encoding:'utf8',timeout:300000,maxBuffer:8*1024*1024});
  evidence[name] = {status:child.status,ms:performance.now()-started,stdout:child.stdout,stderr:child.stderr};
  writeFileSync(join(work,'checks.json'),JSON.stringify(evidence,null,2)+'\n');
  assert.ifError(child.error); assert.equal(child.status,status,child.stdout+child.stderr);
  return child.stdout;
}
for (const pkg of packages) run(`extract-${pkg.file}`,'dpkg-deb',['-x',join(archives,pkg.file),sysroot]);
// Debian's absolute development links must not resolve against the host libraries.
for (const entry of readdirSync(sysroot,{recursive:true,withFileTypes:true})) {
  if (!entry.isSymbolicLink()) continue;
  const path = join(entry.parentPath,entry.name), target = readlinkSync(path);
  if (!isAbsolute(target)) continue;
  unlinkSync(path); symlinkSync(relative(dirname(path),join(sysroot,target)),path);
}
const target = 'x86_64-unknown-linux-gnu';
const libraries = join(sysroot,'lib/x86_64-linux-gnu');
const loader = join(libraries,'ld-2.31.so');
const hostBinary = join(repo,'benchmarks/rust/target/release/seshat');
const hostVersions = run('host-symbols','readelf',['-W','--version-info',hostBinary]);
assert.match(hostVersions,/GLIBC_2\.39/, 'negative control requires the original host-linked candidate');
run('host-binary-rejected',loader,['--library-path',libraries,hostBinary,'--version'],process.env,1);
const env = {...process.env,CARGO_TARGET_DIR:join(work,'target'),CARGO_ENCODED_RUSTFLAGS:[
  '-C',`link-arg=--sysroot=${sysroot}`, '-C',`link-arg=-B${sysroot}/usr/lib/x86_64-linux-gnu/`,
  '-C',`link-arg=-L${libraries}`,
].join('\x1f')};
delete env.RUSTFLAGS;
// Explicit target keeps the old-library flags away from host build scripts/macros.
run('build','cargo',['build','--release','--locked','--offline','--target',target,'--manifest-path','benchmarks/proofs/Cargo.toml','--bin','seshat'],env);
const binary = join(env.CARGO_TARGET_DIR,target,'release/seshat');
const versions = run('symbols','readelf',['-W','--version-info',binary]);
const glibcSymbols = [...new Set([...versions.matchAll(/Name: (GLIBC_\S+)/g)].map(match=>match[1]))];
assert.ok(glibcSymbols.length);
for (const version of glibcSymbols) {
  const [major,minor] = version.slice(6).split('.').map(Number);
  assert.ok(major < 2 || major === 2 && minor <= 31, `newer glibc leaked into build: ${version}`);
}
const loaded = run('loaded-libraries',loader,['--inhibit-cache','--library-path',libraries,'--list',binary]);
const resolved = [...loaded.matchAll(/=> (\/\S+)/g)].map(match=>match[1]);
assert.ok(resolved.length >= 3);
assert.ok(resolved.every(path=>path.startsWith(libraries+'/')), loaded);
run('older-version',loader,['--library-path',libraries,binary,'--version']);
run('host-version',binary,['--version']);
// exec preserves Seshat's PID and signals. Only Seshat uses old libc; Node uses the host.
const quote = value => "'"+value.replaceAll("'", "'\\''")+"'";
const wrapper = join(work,'seshat-glibc231');
writeFileSync(wrapper,`#!/bin/sh\nexec ${quote(loader)} --inhibit-cache --library-path ${quote(libraries)} ${quote(binary)} "$@"\n`);
chmodSync(wrapper,0o755);
for (const [name,path] of [['older',wrapper],['host',binary]]) {
  const output = run(`${name}-cli`,process.execPath,[join(repo,'benchmarks/proofs/cli.mjs')],{...process.env,SESHAT_CLI_BINARY:path});
  assert.match(output,/CLI passed: 42 scenarios plus legacy parity/);
}
const parallelEnv = {...process.env,SESHAT_PARALLEL_CLI:'1',SESHAT_CLI_BINARY:wrapper};
delete parallelEnv.SESHAT_PARALLEL_CASES;
const parallel = run('older-parallel',process.execPath,[join(repo,'benchmarks/proofs/parallel.mjs')],parallelEnv);
assert.match(parallel,/Parallel evidence:/);
assert.equal(Object.keys(JSON.parse(readFileSync(parallel.match(/Parallel evidence: (.+)/)[1],'utf8'))).length,11);
const result = {work,binary,binarySha256:hash(readFileSync(binary)),binaryBytes:readFileSync(binary).length,
  target,glibcSymbols,packages,rust:run('rust','rustc',['--version']).trim(),
  host:{kernel:release(),glibc:process.report.getReport().header.glibcVersionRuntime,node:process.version},checks:evidence,
  limits:'Seshat uses extracted glibc 2.31 on the host kernel; Node and other child tools use host libraries. Not an older-distribution or older-kernel test.'};
writeFileSync(join(work,'result.json'),JSON.stringify(result,null,2)+'\n');
console.log(`Linux glibc proof passed. Results: ${join(work,'result.json')}`);
