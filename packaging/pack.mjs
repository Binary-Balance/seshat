// Maintainer-only local pack. No install hooks, downloads or publication.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, statSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
assert.equal(process.platform, 'linux', 'only the Linux candidate is implemented');
assert.equal(process.arch, 'x64', 'only the x64 candidate is implemented');
assert.ok(process.report.getReport().header.glibcVersionRuntime, 'glibc is required');
const manifest = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const cargoManifest = join(repo, 'benchmarks/proofs/Cargo.toml');
assert.equal(process.argv.length,3,'usage: node packaging/pack.mjs <Debian archive directory>');
const archives = resolve(process.argv[2]);
mkdirSync(join(repo,'work'),{recursive:true});
const work = mkdtempSync(join(repo,'work/npm-pack-'));
const target = join(work,'target');
const env = {...process.env, CARGO_TARGET_DIR:target};
const run = (command, args) => execFileSync(command, args, {
  cwd:repo, env, encoding:'utf8', maxBuffer:16*1024*1024,
  stdio:['ignore','pipe','inherit'],
});
const sha256 = data => createHash('sha256').update(data).digest('hex');
const glibcPackages = [
  {file:'libc6.deb', sha256:'05f7264da867b37f4c5ce49266b558ea1e81e05a9464f623152fca70f3550282'},
  {file:'libc6-dev.deb', sha256:'e7f7b45d9c5cfcf37609f0b6efd3c645272c812144703af89dfd32218fcb0fd3'},
  {file:'libgcc-s1.deb', sha256:'e478f2709d8474165bb664de42e16950c391f30eaa55bc9b3573281d83a29daf'},
];
const sysroot = join(work,'sysroot'); mkdirSync(sysroot);
for (const pkg of glibcPackages) {
  const path = resolve(archives,pkg.file);
  assert.equal(sha256(readFileSync(path)),pkg.sha256,pkg.file);
  run('dpkg-deb',['-x',path,sysroot]);
}
// Absolute Debian development links would otherwise select host libraries.
for (const entry of readdirSync(sysroot,{recursive:true,withFileTypes:true})) {
  if (!entry.isSymbolicLink()) continue;
  const path = join(entry.parentPath,entry.name), link = readlinkSync(path);
  if (!isAbsolute(link)) continue;
  unlinkSync(path); symlinkSync(relative(dirname(path),join(sysroot,link)),path);
}
delete env.RUSTFLAGS;
env.CARGO_ENCODED_RUSTFLAGS = ['-C',`link-arg=--sysroot=${sysroot}`,
  '-C',`link-arg=-B${sysroot}/usr/lib/x86_64-linux-gnu/`,
  '-C',`link-arg=-L${sysroot}/lib/x86_64-linux-gnu`].join('\x1f');
// The explicit target keeps older-library flags away from host build scripts.
const triple = 'x86_64-unknown-linux-gnu';
run('cargo', ['build','--release','--locked','--offline','--target',triple,'--manifest-path',cargoManifest,'--bins']);
const metadata = JSON.parse(run('cargo',['metadata','--locked','--offline','--format-version','1','--manifest-path',cargoManifest]));
assert.equal(metadata.packages.find(p => p.id === metadata.resolve.root).version, manifest.version);
const binary = join(target,triple,'release/seshat');
assert.equal(run(binary, ['--version']).trim(), `seshat ${manifest.version} (candidate)`);
const bytes = readFileSync(binary);
assert.equal(bytes.subarray(0,4).toString('hex'), '7f454c46', 'expected ELF');
assert.equal(bytes[4], 2, 'expected 64-bit ELF');
assert.equal(bytes[5], 1, 'expected little-endian ELF');
assert.equal(bytes.readUInt16LE(18), 62, 'expected x86-64 ELF');

const notices = [];
const dependencies = metadata.packages.filter(p => p.source).sort((a,b) => a.name.localeCompare(b.name));
for (const dependency of dependencies) {
  const directory = dirname(dependency.manifest_path);
  const files = readdirSync(directory).filter(name => /^(licen[cs]e|copying|notice)/i.test(name) && statSync(join(directory,name)).isFile()).sort();
  notices.push(`${dependency.name} ${dependency.version}\nDeclared licence: ${dependency.license}\n`);
  if (files.length) {
    for (const file of files) notices.push(`${file}\n${readFileSync(join(directory,file),'utf8')}`);
  } else {
    // These published Oxc crates omit the root licence. Never guess for another revision.
    const index = dependency.name === 'oxc_index' && dependency.version === '5.0.0';
    assert.ok(index || dependency.name.startsWith('oxc_') && dependency.version === '0.148.0', `missing licence: ${dependency.name} ${dependency.version}`);
    const vcs = JSON.parse(readFileSync(join(directory,'.cargo_vcs_info.json'),'utf8'));
    assert.equal(vcs.git.sha1, index ? '8e09fe324eb6df02f56e4eacdfac958930300380' : '894c8f9cd89508391b01eb26a4b5ac2b846ab39b');
    notices.push(readFileSync(join(here,'OXC-LICENSE'),'utf8'));
  }
}
const versions = run('readelf',['-W','--version-info',binary]);
const build = {
  target:'x86_64-unknown-linux-gnu', rust:run('rustc',['--version']).trim(),
  binarySha256:sha256(bytes), binaryBytes:bytes.length,
  cargoLockSha256:sha256(readFileSync(join(repo,'benchmarks/proofs/Cargo.lock'))),
  glibcSymbols:[...new Set([...versions.matchAll(/Name: (GLIBC_[\d.]+)/g)].map(match => match[1]))].sort(),
  nativeLibraries:[...run('readelf',['-W','-d',binary]).matchAll(/Shared library: \[([^\]]+)\]/g)].map(match => match[1]),
  dependencies:dependencies.map(({name,version,license}) => ({name,version,license})),
  glibcPackages,
};
assert.ok(build.glibcSymbols.length,'expected versioned glibc requirements');
for (const version of build.glibcSymbols) {
  const [major,minor] = version.slice(6).split('.').map(Number);
  assert.ok(major === 2 && minor <= 31,`host glibc leaked into package: ${version}`);
}
const stage = join(work,'package');
mkdirSync(join(stage,'bin'),{recursive:true});
copyFileSync(binary,join(stage,'bin/seshat')); chmodSync(join(stage,'bin/seshat'),0o755);
copyFileSync(join(here,'package.json'),join(stage,'package.json'));
copyFileSync(join(here,'README.md'),join(stage,'README.md'));
copyFileSync(join(repo,'LICENSE'),join(stage,'LICENSE'));
writeFileSync(join(stage,'BUILD.json'),JSON.stringify(build,null,2)+'\n');
writeFileSync(join(stage,'THIRD_PARTY_NOTICES.txt'),notices.join('\n\n'));
const [packed] = JSON.parse(run('npm',['pack',stage,'--json','--offline','--ignore-scripts','--update-notifier=false','--pack-destination',work,
  '--cache',join(work,'cache'),'--userconfig',join(work,'user.npmrc'),'--globalconfig',join(work,'global.npmrc')]));
assert.deepEqual(packed.files.map(f => f.path).sort(), ['BUILD.json','LICENSE','README.md','THIRD_PARTY_NOTICES.txt','bin/seshat','package.json'].sort());
const result = {tarball:join(work,packed.filename), proofBinary:join(target,triple,'release/seshat-proofs'), binary:build.binarySha256, binaryBytes:bytes.length,
  packedBytes:packed.size, unpackedBytes:packed.unpackedSize, integrity:packed.integrity, files:packed.files};
writeFileSync(join(work,'result.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
