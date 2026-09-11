// Maintainer-only local pack. No install hooks, downloads or publication.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, statSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {arch, release, version as osVersion} from 'node:os';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const manifest = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const cargoManifest = join(repo, 'benchmarks/proofs/Cargo.toml');
const nativeArm64 = process.argv.length === 3 && process.argv[2] === '--native-arm64';
const nativeMacos = process.argv.length === 3 && process.argv[2] === '--native-macos';
const nativeWindows = process.argv.length === 3 && process.argv[2] === '--native-windows';
assert.ok(nativeArm64 || nativeMacos || nativeWindows || process.argv.length === 3,
  'usage: node packaging/pack.mjs <Debian archive directory> | --native-arm64 | --native-macos | --native-windows');
assert.ok(nativeArm64 + nativeMacos + nativeWindows <= 1, 'native package modes are mutually exclusive');
if (nativeArm64) {
  assert.equal(process.platform, 'linux', 'native ARM64 mode requires Linux');
  assert.equal(process.arch, 'arm64', 'native ARM64 mode must run on an ARM64 host');
  assert.equal(execFileSync('uname', ['-m'], {encoding:'utf8'}).trim(), 'aarch64', 'native ARM64 mode requires aarch64');
  const osRelease = readFileSync('/etc/os-release', 'utf8');
  assert.equal(osRelease.match(/^ID=(.+)$/m)?.[1], 'ubuntu', 'native ARM64 mode requires Ubuntu');
  assert.equal(osRelease.match(/^VERSION_ID="?([^"\n]+)"?$/m)?.[1], '22.04', 'native ARM64 mode requires Ubuntu 22.04');
  assert.equal(process.report.getReport().header.glibcVersionRuntime, '2.35', 'native ARM64 mode requires glibc 2.35');
} else if (nativeMacos) {
  assert.equal(process.platform, 'darwin', 'native macOS mode requires macOS');
  assert.ok(['x64', 'arm64'].includes(process.arch), `unsupported native macOS CPU: ${process.arch}`);
  const machine = execFileSync('uname', ['-m'], {encoding:'utf8'}).trim();
  const expectedMachine = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  assert.equal(machine, expectedMachine,
    'native macOS mode requires a matching native architecture');
  // Native Intel lacks this key; omit sysctl -i so other probe failures still reject the pack.
  const translatedProbe = spawnSync('sysctl', ['-n', 'sysctl.proc_translated'], {encoding:'utf8'});
  const translatedError = (translatedProbe.stderr ?? '').trim();
  const absentKey = translatedProbe.status !== 0 && /unknown oid/i.test(translatedError);
  const translated = translatedProbe.status === 0
    ? translatedProbe.stdout.trim()
    : absentKey ? '0' : null;
  assert.equal(translated, '0', 'native macOS mode must not run through Rosetta');
} else if (nativeWindows) {
  assert.equal(process.platform, 'win32', 'native Windows mode requires Windows');
  assert.equal(process.arch, 'x64', 'native Windows mode is x64 only');
  assert.equal(process.env.RUNNER_OS, 'Windows', 'native Windows mode requires the Windows runner');
  assert.equal(Number(release().match(/\b10\.0\.(\d+)\b/)?.[1]), 20348,
    'native Windows mode requires Windows Server 2022 build 20348');
} else {
  assert.equal(process.platform, 'linux', 'the Debian archive mode requires Linux');
  assert.equal(process.arch, 'x64', 'the Debian archive mode is x64 only');
}
if (!nativeMacos && !nativeWindows) assert.ok(process.report.getReport().header.glibcVersionRuntime, 'glibc is required');
const archives = nativeArm64 || nativeMacos || nativeWindows ? null : resolve(process.argv[2]);
const targetConfig = nativeArm64
  ? {target:'aarch64-unknown-linux-gnu', cpu:'arm64', elfMachine:183, glibcCeiling:'2.35'}
  : nativeMacos
    ? {target:process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin', cpu:process.arch, machoArch:process.arch === 'arm64' ? 'arm64' : 'x86_64', minimumMacos:'15.0'}
    : nativeWindows
      ? {target:'x86_64-pc-windows-msvc', cpu:'x64', peMachine:0x8664, binaryName:'seshat.exe'}
      : {target:'x86_64-unknown-linux-gnu', cpu:'x64', elfMachine:62, glibcCeiling:'2.31'};
mkdirSync(join(repo,'work'),{recursive:true});
const work = mkdtempSync(join(repo,'work/npm-pack-'));
const target = join(work,'target');
// Serialize release codegen so Cargo does not vary linker input order between clean builds.
const env = {...process.env, CARGO_BUILD_JOBS:'1', CARGO_TARGET_DIR:target, ...(nativeMacos ? {MACOSX_DEPLOYMENT_TARGET:'15.0'} : {})};
// Keep linker metadata out of release bytes; cc needs the linker flag forwarded.
const buildIdRustflags = ['-C','link-arg=-Wl,--build-id=none'];
if (nativeWindows) {
  delete env.RUSTFLAGS;
  delete env.CARGO_ENCODED_RUSTFLAGS;
}
const commandName = command => process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
const run = (command, args) => execFileSync(commandName(command), args, {
  cwd:repo, env, encoding:'utf8', maxBuffer:16*1024*1024,
  shell:process.platform === 'win32' && command === 'npm',
  stdio:['ignore','pipe','inherit'],
});
const sha256 = data => createHash('sha256').update(data).digest('hex');
const toolInfo = (command, identity) => {
  const result = spawnSync(commandName(command), [], {encoding:'utf8', maxBuffer:128 * 1024});
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  const version = output.match(identity)?.[0] ?? null;
  assert.ok(!result.error && output && version, `${command} is unavailable or is not the expected MSVC tool`);
  return {command, version, status:result.status};
};
const msvcIdentity = /^Microsoft \(R\) C\/C\+\+ Optimizing Compiler Version .+ for x64\b/m;
const linkerIdentity = /^Microsoft \(R\) Incremental Linker Version \S+/m;
const sdkInfo = () => {
  const directory = process.env.WindowsSdkDir?.replace(/[\\/]+$/, '') ??
    join(process.env['ProgramFiles(x86)'] ?? process.env.ProgramFiles ?? 'C:\\Program Files (x86)', 'Windows Kits', '10');
  const version = process.env.WindowsSDKVersion?.replace(/[\\/]+$/, '') ??
    (existsSync(join(directory, 'Lib')) ? readdirSync(join(directory, 'Lib')).filter(value => /^\d/.test(value)).sort().at(-1) ?? null : null);
  return {directory, version, ucrtVersion:process.env.UCRTVersion ?? null};
};
function peInfo(bytes) {
  assert.equal(bytes.subarray(0, 2).toString('ascii'), 'MZ', 'expected PE DOS header');
  const peOffset = bytes.readUInt32LE(0x3c);
  assert.equal(bytes.subarray(peOffset, peOffset + 4).toString('ascii'), 'PE\0\0', 'expected PE signature');
  const machine = bytes.readUInt16LE(peOffset + 4);
  const sections = bytes.readUInt16LE(peOffset + 6);
  const optional = peOffset + 24;
  const magic = bytes.readUInt16LE(optional);
  assert.equal(magic, 0x20b, 'expected PE32+ binary');
  const optionalSize = bytes.readUInt16LE(peOffset + 20);
  const sectionStart = optional + optionalSize;
  const sectionTable = Array.from({length:sections}, (_, index) => {
    const offset = sectionStart + index * 40;
    return {
      virtualSize:bytes.readUInt32LE(offset + 8),
      virtualAddress:bytes.readUInt32LE(offset + 12),
      rawSize:bytes.readUInt32LE(offset + 16),
      rawAddress:bytes.readUInt32LE(offset + 20),
    };
  });
  const rvaOffset = rva => {
    const section = sectionTable.find(value => rva >= value.virtualAddress &&
      rva < value.virtualAddress + Math.max(value.virtualSize, value.rawSize));
    return section ? section.rawAddress + rva - section.virtualAddress : null;
  };
  const importDirectory = optional + 112 + 8;
  const importRva = bytes.readUInt32LE(importDirectory);
  const imports = [];
  if (importRva) {
    const importsOffset = rvaOffset(importRva);
    assert.ok(importsOffset !== null, 'PE import directory is outside sections');
    for (let offset = importsOffset, index = 0; index < 4096; offset += 20, index++) {
      const descriptor = [0, 1, 2, 3, 4].map(item => bytes.readUInt32LE(offset + item * 4));
      if (descriptor.every(value => value === 0)) break;
      const nameOffset = rvaOffset(descriptor[3]);
      assert.ok(nameOffset !== null, 'PE import name is outside sections');
      const end = bytes.indexOf(0, nameOffset);
      assert.ok(end > nameOffset, 'PE import name is not terminated');
      imports.push(bytes.subarray(nameOffset, end).toString('ascii'));
    }
  }
  assert.ok(imports.length, 'PE import directory is empty');
  return {machine, magic, imports:[...new Set(imports)].sort()};
}
const sourceCommit = () => run('git', ['rev-parse', 'HEAD']).trim();
const glibcPackages = nativeArm64 || nativeMacos || nativeWindows ? [] : [
  {file:'libc6.deb', sha256:'05f7264da867b37f4c5ce49266b558ea1e81e05a9464f623152fca70f3550282'},
  {file:'libc6-dev.deb', sha256:'e7f7b45d9c5cfcf37609f0b6efd3c645272c812144703af89dfd32218fcb0fd3'},
  {file:'libgcc-s1.deb', sha256:'e478f2709d8474165bb664de42e16950c391f30eaa55bc9b3573281d83a29daf'},
];
if (!nativeArm64 && !nativeMacos && !nativeWindows) {
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
    '-C',`link-arg=-L${sysroot}/lib/x86_64-linux-gnu`,
    ...buildIdRustflags].join('\x1f');
} else if (nativeArm64) {
  delete env.RUSTFLAGS;
  env.CARGO_ENCODED_RUSTFLAGS = buildIdRustflags.join('\x1f');
}
// The explicit target keeps older-library flags away from host build scripts.
const triple = targetConfig.target;
const cargoBuildArgs = ['build','--release','--locked','--offline','--target',triple,'--manifest-path',cargoManifest,'--bins'];
if (nativeWindows) cargoBuildArgs.splice(1, 0, '--config',
  'target.x86_64-pc-windows-msvc.rustflags=["-C","target-feature=+crt-static","-C","link-arg=/Brepro"]');
run('cargo', cargoBuildArgs);
const metadata = JSON.parse(run('cargo',['metadata','--locked','--offline','--format-version','1','--manifest-path',cargoManifest]));
assert.equal(metadata.packages.find(p => p.id === metadata.resolve.root).version, manifest.version);
const binary = join(target,triple,`release/${nativeWindows ? targetConfig.binaryName : 'seshat'}`);
assert.equal(run(binary, ['--version']).trim(), `seshat ${manifest.version} (candidate)`);
const bytes = readFileSync(binary);
if (nativeMacos) {
  const fileType = run('file', ['-b', binary]);
  assert.match(fileType, new RegExp(`Mach-O 64-bit executable ${targetConfig.machoArch}`));
} else if (nativeWindows) {
  const pe = peInfo(bytes);
  assert.equal(pe.machine, targetConfig.peMachine, 'expected x64 PE machine 0x8664');
  assert.ok(pe.imports.every(name => !/^(MSVCP|VCRUNTIME)/i.test(name)),
    `unexpected Visual C++ runtime import: ${pe.imports.join(', ')}`);
} else {
  assert.equal(bytes.subarray(0,4).toString('hex'), '7f454c46', 'expected ELF');
  assert.equal(bytes[4], 2, 'expected 64-bit ELF');
  assert.equal(bytes[5], 1, 'expected little-endian ELF');
  assert.equal(bytes.readUInt16LE(18), targetConfig.elfMachine, `expected ${targetConfig.cpu} ELF`);
}

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
const pe = nativeWindows ? peInfo(bytes) : null;
const versions = nativeMacos || nativeWindows ? '' : run('readelf',['-W','--version-info',binary]);
const dynamic = nativeMacos ? run('otool',['-L',binary]) : nativeWindows ? null : run('readelf',['-W','-d',binary]);
const nativeLibraries = nativeWindows
  ? pe.imports
  : nativeMacos
    ? [...dynamic.matchAll(/^\s+([^\s]+) \(/gm)].map(match => match[1])
    : [...dynamic.matchAll(/Shared library: \[([^\]]+)\]/g)].map(match => match[1]);
if (nativeMacos) {
  assert.ok(nativeLibraries.includes('/usr/lib/libSystem.B.dylib'), 'expected libSystem.B.dylib');
  assert.ok(nativeLibraries.every(path => path.startsWith('/usr/lib/') || path.startsWith('/System/Library/') || path.startsWith('@')),
    `unexpected macOS dynamic library: ${nativeLibraries.join(', ')}`);
  const loadCommands = run('otool',['-l',binary]);
  const minimum = loadCommands.match(/cmd LC_BUILD_VERSION[\s\S]*?\n\s*minos\s+([0-9.]+)/)?.[1]
    ?? loadCommands.match(/cmd LC_VERSION_MIN_MACOSX[\s\S]*?\n\s*version\s+([0-9.]+)/)?.[1];
  assert.equal(minimum, targetConfig.minimumMacos, `expected macOS minimum ${targetConfig.minimumMacos}`);
}
const build = {
  target:targetConfig.target,
  ...(nativeArm64 ? {cpu:targetConfig.cpu, glibcCeiling:targetConfig.glibcCeiling} : {}),
  ...(nativeMacos ? {cpu:targetConfig.cpu, minimumMacos:targetConfig.minimumMacos, deploymentTarget:env.MACOSX_DEPLOYMENT_TARGET,
    sdk:run('xcrun',['--sdk','macosx','--show-sdk-version']).trim(), clang:run('clang',['--version']).split('\n',1)[0]} : {}),
  ...(nativeWindows ? {
    cpu:targetConfig.cpu,
    peMachine:`0x${pe.machine.toString(16)}`,
    peFormat:'PE32+',
    imports:pe.imports,
    nativeLibraries:pe.imports,
    crtStatic:true,
    rustflags:['-C target-feature=+crt-static', '-C link-arg=/Brepro'],
    msvc:toolInfo('cl.exe', msvcIdentity),
    linker:toolInfo('link.exe', linkerIdentity),
    cargo:run('cargo',['--version']).trim(),
    sdk:sdkInfo(),
    os:{platform:process.platform, architecture:arch(), release:release(), version:osVersion(), runner:process.env.RUNNER_OS ?? null,
      image:process.env.ImageOS ?? null, imageVersion:process.env.ImageVersion ?? null},
    sourceCommit:sourceCommit(),
  } : {}),
  rust:run('rustc',['--version']).trim(),
  binarySha256:sha256(bytes), binaryBytes:bytes.length,
  cargoLockSha256:sha256(readFileSync(join(repo,'benchmarks/proofs/Cargo.lock'))),
  ...(nativeMacos ? {machoArchitecture:targetConfig.machoArch} : nativeWindows ? {} : {glibcSymbols:[...new Set([...versions.matchAll(/Name: (GLIBC_[\d.]+)/g)].map(match => match[1]))].sort()}),
  nativeLibraries,
  dependencies:dependencies.map(({name,version,license}) => ({name,version,license})),
  glibcPackages,
};
if (!nativeMacos && !nativeWindows) {
  assert.ok(build.glibcSymbols.length,'expected versioned glibc requirements');
  for (const version of build.glibcSymbols) {
    const [major,minor] = version.slice(6).split('.').map(Number);
    const [ceilingMajor,ceilingMinor] = targetConfig.glibcCeiling.split('.').map(Number);
    assert.ok(major < ceilingMajor || major === ceilingMajor && minor <= ceilingMinor,`host glibc leaked into package: ${version}`);
  }
}
const stage = join(work,'package');
mkdirSync(join(stage,'bin'),{recursive:true});
const packagedBinary = `bin/${nativeWindows ? targetConfig.binaryName : 'seshat'}`;
copyFileSync(binary,join(stage,packagedBinary));
if (!nativeWindows) chmodSync(join(stage,packagedBinary),0o755);
const packageManifest = nativeWindows ? (() => {
  const value = {...manifest,
    description:'Local Windows x64 MSVC candidate for native TypeScript code assurance',
    os:['win32'], cpu:['x64'], bin:{seshat:packagedBinary},
    files:[packagedBinary,'BUILD.json','THIRD_PARTY_NOTICES.txt'],
  };
  delete value.libc;
  return value;
})() : nativeArm64 ? {...manifest,
  description:'Local Linux ARM64 candidate for native TypeScript code assurance',
  cpu:['arm64'],
} : nativeMacos ? (() => {
  const value = {...manifest,
    description:`Local macOS ${process.arch === 'arm64' ? 'ARM64' : 'x64'} candidate for native TypeScript code assurance`,
    os:['darwin'], cpu:[process.arch],
  };
  delete value.libc;
  return value;
})() : manifest;
if (nativeArm64 || nativeMacos || nativeWindows) writeFileSync(join(stage,'package.json'),JSON.stringify(packageManifest,null,2)+'\n');
else copyFileSync(join(here,'package.json'),join(stage,'package.json'));
copyFileSync(join(here,nativeWindows ? 'README-windows.md' : nativeArm64 ? 'README-arm64.md' : nativeMacos ? 'README-macos.md' : 'README.md'),join(stage,'README.md'));
copyFileSync(join(repo,'LICENSE'),join(stage,'LICENSE'));
writeFileSync(join(stage,'BUILD.json'),JSON.stringify(build,null,2)+'\n');
writeFileSync(join(stage,'THIRD_PARTY_NOTICES.txt'),notices.join('\n\n'));
const [packed] = JSON.parse(run('npm',['pack',stage,'--json','--offline','--ignore-scripts','--update-notifier=false','--pack-destination',work,
  '--cache',join(work,'cache'),'--userconfig',join(work,'user.npmrc'),'--globalconfig',join(work,'global.npmrc')]));
assert.deepEqual(packed.files.map(f => f.path).sort(), ['BUILD.json','LICENSE','README.md','THIRD_PARTY_NOTICES.txt',packagedBinary,'package.json'].sort());
const tarball = join(work,packed.filename);
const tarballSha256 = sha256(readFileSync(tarball));
const result = {tarball, tarballSha256, proofBinary:join(target,triple,`release/seshat-proofs${nativeWindows ? '.exe' : ''}`),
  ...(nativeWindows ? {consoleHelper:join(target,triple,'release/windows-console-helper.exe'), binaryName:targetConfig.binaryName} : {}),
  binary:build.binarySha256, binaryBytes:bytes.length,
  packedBytes:packed.size, unpackedBytes:packed.unpackedSize, integrity:packed.integrity, files:packed.files,
  // The standalone route deliberately reuses npm's deterministic payload. Its verifier strips package/ before running it.
  standalone:{path:tarball, sha256:tarballSha256, bytes:packed.size}};
writeFileSync(join(work,'result.json'),JSON.stringify(result,null,2)+'\n');
if (process.env.SESHAT_PACK_RESULT) writeFileSync(resolve(process.env.SESHAT_PACK_RESULT),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
