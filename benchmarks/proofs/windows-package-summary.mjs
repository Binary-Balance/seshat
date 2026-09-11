import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {readArchiveBuild, repeatPassed as sharedRepeatPassed, windowsPackageFiles as packageFiles} from './repeat-proof.mjs';

const selfCheckMode = process.argv[2] === '--self-check';
assert.ok(selfCheckMode || process.argv.length === 3,
  'usage: node benchmarks/proofs/windows-package-summary.mjs <artifact directory> | --self-check');

const runtimeCases = ['baseline', 'timeout', 'overflow', 'leaderExit', 'leaderExitRepeat', 'consoleCancellation'];
const hash = value => createHash('sha256').update(value).digest('hex');
const hashFile = path => hash(readFileSync(path));
const isCommit = value => typeof value === 'string' && /^(?!0{40})[\da-f]{40}$/i.test(value);
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function validatePreflight(value, fail) {
  const candidate = value?.candidate;
  const environment = value?.environment;
  const runner = environment?.runnerImage;
  const rust = environment?.toolchain?.rust;
  const sdk = environment?.toolchain?.sdk;
  if (!isCommit(value?.provenance?.sourceCommit)) fail('preflight source commit is missing');
  if (!candidate || candidate.runner !== 'windows-2022' || candidate.os !== 'Windows Server 2022' ||
      candidate.kernelBuild !== 20348 || candidate.node !== '24.20.0' || candidate.rust !== '1.98.1' ||
      candidate.target !== 'x86_64-pc-windows-msvc' || candidate.cpu !== 'x64' || candidate.crtStatic !== true) {
    fail('preflight candidate does not describe the Windows Server 2022 x64 target');
  }
  if (!environment || environment.platform !== 'win32' || environment.architecture?.node !== 'x64' ||
      environment.architecture?.os !== 'x64' || environment.os?.kernelBuild !== 20348 ||
      !environment.os?.release || !environment.os?.version || environment.node?.version !== 'v24.20.0' ||
      !environment.npm?.available || !environment.npm.version || runner?.label !== 'windows-2022' || runner?.os !== 'Windows') {
    fail('preflight environment does not describe the Windows Server 2022 x64 runner');
  }
  if (!rust?.rustc?.available || !rust.rustc.version?.startsWith('rustc 1.98.1') ||
      !rust.cargo?.available || !rust.cargo.version?.startsWith('cargo 1.98.1') || rust.host !== 'x86_64-pc-windows-msvc') {
    fail('preflight Rust/Cargo provenance is incomplete');
  }
  if (!environment.toolchain?.msvc?.available || !environment.toolchain.msvc.version ||
      !environment.toolchain?.linker?.available || !environment.toolchain.linker.version || !sdk?.version) {
    fail('preflight MSVC/linker/SDK provenance is incomplete');
  }
  if (!environment.shell?.systemRoot || !environment.shell?.comspec) fail('preflight Windows shell provenance is incomplete');
}

function checkStatuses(value, names, fail) {
  for (const [name, expected] of names) {
    if (value?.checks?.[name]?.status !== expected) fail(`Windows package check failed: ${name}`);
  }
}

function checkInstalledControl(value, label, cases, packed, fail) {
  if (value.checks?.requested !== cases.length || value.checks?.completed !== cases.length ||
      !sameJson(value.requestedCases, cases)) {
    fail(`${label} evidence did not retain its four requested cases`);
  }
  if (value.cli?.source !== 'executable' || value.cli?.binarySha256 !== packed?.binary ||
      !/^seshat 0\.0\.0 \(candidate\)$/.test(value.cli?.version ?? '')) {
    fail(`${label} evidence did not run the installed package executable`);
  }
  if (value.originalsPreserved !== true) fail(`${label} evidence did not preserve its fixture inputs`);
  if (!value.noConsumingRust?.probes?.every(probe => probe.unavailable === true) ||
      !['CARGO_HOME', 'RUSTUP_HOME', 'CARGO_TARGET_DIR', 'NODE_OPTIONS', 'SESHAT_MUTANT_ID']
        .every(name => value.noConsumingRust?.environmentUnset?.includes(name))) {
    fail(`${label} no-Rust consumer evidence is incomplete`);
  }
}

function validate({preflight, packed, repeat, install, runtime, jestExpo, vitest, sharedCli, sharedParallel}, parseErrors = {}, artifactDirectory = null, artifacts = {}) {
  const failures = Object.entries(parseErrors).map(([name, message]) => `${name}: invalid JSON (${message})`);
  const fail = message => failures.push(message);
  if (!preflight) fail('preflight result missing');
  else {
    if (preflight.validation?.passed !== true) fail('preflight validation failed');
    validatePreflight(preflight, fail);
  }

  let buildHash = null;
  let retainedBuild = null;
  let archiveBuild = null;
  if (!packed) fail('package result missing');
  else {
    if (!packed.binary || !packed.binaryBytes || !packed.tarballSha256 || !packed.standalone?.sha256) fail('package hashes missing');
    if (packed.tarballSha256 !== packed.standalone.sha256) fail('package npm and standalone hashes differ');
    if (packed.binaryName !== 'seshat.exe') fail('package executable name is not seshat.exe');
    if (artifactDirectory) {
      for (const name of ['seshat-windows-x64.tgz', 'seshat-windows-x64-standalone.tar.gz', 'BUILD.json']) {
        if (!existsSync(join(artifactDirectory, name))) fail(`artifact missing: ${name}`);
      }
      if (!artifacts.tarball?.sha256) fail('npm tarball hash missing');
      else if (artifacts.tarball.sha256 !== packed.tarballSha256) fail('npm tarball hash differs from package evidence');
      if (!artifacts.standalone?.sha256) fail('standalone archive hash missing');
      else if (artifacts.standalone.sha256 !== packed.standalone.sha256) fail('standalone archive hash differs from package evidence');
      const buildPath = join(artifactDirectory, 'BUILD.json');
      if (existsSync(buildPath)) {
        buildHash = hashFile(buildPath);
        try {
          retainedBuild = {...artifacts.build, value:JSON.parse(readFileSync(buildPath, 'utf8'))};
        } catch (error) {
          fail(`BUILD.json is invalid: ${error.message}`);
        }
      }
      if (buildHash && (!artifacts.build?.sha256 || artifacts.build.sha256 !== buildHash)) fail('BUILD.json hash missing or changed');
      if (artifacts.tarball?.file) archiveBuild = readArchiveBuild(join(artifactDirectory, artifacts.tarball.file));
      if (!archiveBuild || !retainedBuild || archiveBuild.sha256 !== retainedBuild.sha256 ||
          !sameJson(archiveBuild.value, retainedBuild.value)) fail('retained BUILD.json differs from archive BUILD.json');
    }
  }

  if (!install) fail('Windows package install result missing');
  else {
    if (install.sourceCommit !== repeat?.sourceCommit || install.build?.sourceCommit !== repeat?.sourceCommit ||
        preflight?.provenance?.sourceCommit !== repeat?.sourceCommit) fail('package and repeat source commits differ');
    if (preflight?.provenance?.sourceCommit !== repeat?.sourceCommit) fail('preflight and repeat source commits differ');
    if (install.tarball?.sha256 !== packed?.tarballSha256) fail('installed npm archive hash differs from package metadata');
    if (install.standaloneArchive?.sha256 !== packed?.standalone?.sha256) fail('installed standalone archive hash differs from package metadata');
    if (install.binary?.sha256 !== packed?.binary || install.binary?.bytes !== packed?.binaryBytes) fail('installed binary hash differs from package metadata');
    if (install.build?.binarySha256 !== packed?.binary) fail('installed BUILD.json hash differs from package metadata');
    if (artifactDirectory && install.buildSha256 !== artifacts.build?.sha256) fail('installed BUILD.json hash differs from retained BUILD.json');
    const preflightRust = preflight?.environment?.toolchain?.rust;
    if (install.build?.rust !== preflightRust?.rustc?.version || install.build?.rust !== repeat?.toolchain?.rustc ||
        install.build?.cargo !== preflightRust?.cargo?.version || install.build?.cargo !== repeat?.toolchain?.cargo) {
      fail('Rust/Cargo provenance differs between preflight, repeat pack and BUILD.json');
    }
    const sameTool = (buildTool, preflightTool) => buildTool?.version === preflightTool?.version && preflightTool?.available === true;
    if (!sameTool(install.build?.msvc, preflight?.environment?.toolchain?.msvc) ||
        !sameTool(install.build?.linker, preflight?.environment?.toolchain?.linker) ||
        install.build?.msvc?.version !== repeat?.toolchain?.msvc?.version ||
        install.build?.linker?.version !== repeat?.toolchain?.linker?.version ||
        !sameJson(install.build?.sdk, preflight?.environment?.toolchain?.sdk) ||
        !sameJson(install.build?.sdk, repeat?.toolchain?.sdk)) {
      fail('MSVC/linker/SDK provenance differs between preflight and BUILD.json');
    }
    if (install.build?.target !== 'x86_64-pc-windows-msvc' || install.build?.peMachine !== '0x8664' || install.build?.peFormat !== 'PE32+') {
      fail('installed BUILD.json does not describe x64 PE/MSVC');
    }
    if (install.build?.os?.platform !== preflight?.environment?.platform || install.build?.os?.architecture !== preflight?.environment?.architecture?.os ||
        install.build?.os?.release !== preflight?.environment?.os?.release || install.build?.os?.version !== preflight?.environment?.os?.version ||
        install.build?.os?.runner !== preflight?.environment?.runnerImage?.os) {
      fail('OS provenance differs between preflight and BUILD.json');
    }
    if (install.build?.libc !== undefined || install.build?.crtStatic !== true ||
        !install.build?.rustflags?.includes('-C target-feature=+crt-static')) fail('Windows build metadata has invalid runtime fields');
    if (!Array.isArray(install.build?.imports) || install.build.imports.some(name => /^(MSVCP|VCRUNTIME)/i.test(name))) {
      fail('Windows build imports include an external Visual C++ runtime');
    }
    checkStatuses(install, [
      ['offline-install', 0], ['installed-version', 0], ['installed-help', 0], ['bin-cmd-version', 0],
      ['npm-exec-help', 0], ['package-script-version', 0], ['offline-ci', 0], ['cargo-probe', 1], ['rustc-probe', 1],
      ['standalone-list', 0], ['standalone-extract', 0], ['standalone-version', 0], ['standalone-help', 0],
    ], fail);
    if (!['CARGO_HOME', 'RUSTUP_HOME', 'CARGO_TARGET_DIR', 'RUSTC_WRAPPER', 'CARGO_BUILD_RUSTC', 'RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'RUSTUP_TOOLCHAIN']
          .every(name => install.noConsumingRust?.environmentUnset?.includes(name)) ||
        !install.noConsumingRust?.preserved?.includes('SystemRoot') ||
        !install.noConsumingRust?.preserved?.includes('ComSpec') ||
        !install.noConsumingRust?.preserved?.includes('System32') ||
        !install.noConsumingRust?.preserved?.includes('Node') ||
        !install.noConsumingRust?.preserved?.includes('npm.cmd')) fail('no-Rust consumer environment evidence is incomplete');
  }

  const repeatValid = repeat && sharedRepeatPassed(repeat, {
    sourceCommit:preflight?.provenance?.sourceCommit,
    expectedTarget:'x86_64-pc-windows-msvc', expectedPlatform:'win32', expectedArch:'x64', expectedMachine:'0x8664',
    inputMode:'--native-windows', expectedPackageFiles:packageFiles,
    expectedWindows:{release:preflight?.environment?.os?.release, version:preflight?.environment?.os?.version,
      runner:preflight?.environment?.runnerImage?.os},
    expectedToolchain:{node:preflight?.environment?.node?.version, npm:preflight?.environment?.npm?.version,
      rustc:preflight?.environment?.toolchain?.rust?.rustc?.version,
      cargo:preflight?.environment?.toolchain?.rust?.cargo?.version},
    packed, build:install?.build,
    npm:install ? {build:install.build} : null,
    standalone:install ? {build:install.build, archiveSha256:install.standaloneArchive?.sha256,
      archiveBytes:install.standaloneArchive?.bytes} : null,
    artifacts, requireArtifacts:Boolean(artifactDirectory), retainedBuild,
  });
  if (!repeat) fail('repeat pack result missing');
  else if (!repeatValid) fail('repeat pack did not bind two complete runs to the retained package');

  if (!runtime) fail('Windows runtime CLI/lifecycle result missing');
  else {
    if (runtime.validation?.passed !== true) fail('Windows runtime CLI/lifecycle proof failed');
    if (runtime.binary?.sha256 !== packed?.binary) fail('runtime proof binary hash differs from installed package');
    if (!runtime.binary?.path || !/seshat\.exe$/i.test(runtime.binary.path)) fail('runtime proof did not record the installed executable');
    if (Object.keys(runtime.scenarios ?? {}).length !== runtimeCases.length || runtimeCases.some(name => !runtime.scenarios?.[name])) {
      fail('Windows runtime CLI/lifecycle proof is partial');
    }
  }

  const integrationGaps = [];
  if (!sharedCli) integrationGaps.push('shared 43-scenario CLI fixture evidence was not retained');
  else if (Object.keys(sharedCli).length !== 43) fail('shared CLI fixture evidence did not retain 43 scenarios');
  if (!sharedParallel) integrationGaps.push('shared 11-case parallel fixture evidence was not retained');
  else if (Object.keys(sharedParallel).length !== 11) fail('shared parallel fixture evidence did not retain 11 cases');
  if (!jestExpo) integrationGaps.push('installed Jest/Expo four-case evidence was not retained');
  else checkInstalledControl(jestExpo, 'Jest/Expo', ['normal-1', 'assertion-kill', 'survivor', 'before-all'], packed, fail);
  if (!vitest) integrationGaps.push('installed Vitest four-case evidence was not retained');
  else checkInstalledControl(vitest, 'Vitest', ['stack', 'assertion', 'survived', 'before-all'], packed, fail);
  return {failures, integrationGaps, repeatPack:Boolean(repeatValid)};
}

function selfCheck() {
  const sourceCommit = 'a'.repeat(40);
  const binaryHash = 'b'.repeat(64);
  const buildHash = 'c'.repeat(64);
  const archiveHash = 'd'.repeat(64);
  const packed = {binary:binaryHash, binaryBytes:1, binaryName:'seshat.exe', tarballSha256:archiveHash, standalone:{sha256:archiveHash, bytes:1}};
  const repeat = {schemaVersion:1, sourceCommit, host:{platform:'win32', arch:'x64', windows:{platform:'win32', architecture:'x64', release:'10.0.20348', version:'10.0.20348', runner:'Windows'}, glibc:null},
    toolchain:{node:'v24.20.0', npm:'11.0.0', rustc:'rustc 1.98.1', cargo:'cargo 1.98.1', msvc:{version:'cl'}, linker:{version:'link'}, sdk:{version:'sdk'}}, input:{mode:'--native-windows', archives:[]}, validation:{passed:true, reason:'self-check'}, runs:[
    {binary:{sha256:binaryHash, bytes:1}, build:{sha256:buildHash, bytes:1}, npmArchive:{sha256:archiveHash, bytes:1}, standaloneArchive:{sha256:archiveHash, bytes:1}, files:packageFiles},
    {binary:{sha256:binaryHash, bytes:1}, build:{sha256:buildHash, bytes:1}, npmArchive:{sha256:archiveHash, bytes:1}, standaloneArchive:{sha256:archiveHash, bytes:1}, files:packageFiles},
  ], comparisons:Object.fromEntries(['binary', 'build', 'npmArchive', 'standaloneArchive'].map(name => [name, {hash:true, bytes:true, passed:true}]))};
  const install = {sourceCommit, buildSha256:buildHash, tarball:{sha256:archiveHash, bytes:1}, standaloneArchive:{sha256:archiveHash, bytes:1}, binary:{sha256:binaryHash, bytes:1},
    build:{binarySha256:binaryHash, binaryBytes:1, target:'x86_64-pc-windows-msvc', peMachine:'0x8664', peFormat:'PE32+', crtStatic:true,
      sourceCommit, rust:'rustc 1.98.1', cargo:'cargo 1.98.1', msvc:{available:true, version:'cl'}, linker:{available:true, version:'link'}, sdk:{version:'sdk'},
      os:{platform:'win32', architecture:'x64', release:'10.0.20348', version:'10.0.20348', runner:'Windows'},
      rustflags:['-C target-feature=+crt-static'], imports:['KERNEL32.dll']},
    noConsumingRust:{environmentUnset:['CARGO_HOME', 'RUSTUP_HOME', 'CARGO_TARGET_DIR', 'RUSTC_WRAPPER', 'CARGO_BUILD_RUSTC', 'RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'RUSTUP_TOOLCHAIN'],
      preserved:['SystemRoot', 'ComSpec', 'System32', 'Node', 'npm.cmd']},
    checks:Object.fromEntries([['offline-install',0], ['installed-version',0], ['installed-help',0], ['bin-cmd-version',0], ['npm-exec-help',0],
      ['package-script-version',0], ['offline-ci',0], ['cargo-probe',1], ['rustc-probe',1], ['standalone-list',0], ['standalone-extract',0],
      ['standalone-version',0], ['standalone-help',0]].map(([name,status]) => [name,{status}]))};
  const runtime = {validation:{passed:true}, binary:{path:'seshat.exe', sha256:binaryHash}, scenarios:Object.fromEntries(runtimeCases.map(name => [name, {}]))};
  const base = {preflight:{validation:{passed:true}, provenance:{sourceCommit}, candidate:{runner:'windows-2022', os:'Windows Server 2022', kernelBuild:20348, node:'24.20.0', rust:'1.98.1', target:'x86_64-pc-windows-msvc', cpu:'x64', crtStatic:true}, environment:{
      platform:'win32', architecture:{node:'x64', os:'x64'}, os:{kernelBuild:20348, release:'10.0.20348', version:'10.0.20348'}, node:{version:'v24.20.0'}, npm:{available:true, version:'11.0.0'},
      runnerImage:{label:'windows-2022', os:'Windows'}, toolchain:{rust:{rustc:{available:true, version:'rustc 1.98.1'}, cargo:{available:true, version:'cargo 1.98.1'}, host:'x86_64-pc-windows-msvc'}, msvc:{available:true, version:'cl'}, linker:{available:true, version:'link'}, sdk:{version:'sdk'}}, shell:{systemRoot:'C:', comspec:'C:'}},
    }, packed:{...packed, files:packageFiles.map(path => ({path}))}, repeat, install, runtime};
  assert.deepEqual(validate(base).failures, []);
  assert.equal(validate({...base, repeat:{...repeat, runs:repeat.runs.slice(0, 1)}}).failures[0], 'repeat pack did not bind two complete runs to the retained package');
  const wrongSource = structuredClone(base);
  wrongSource.repeat.sourceCommit = 'b'.repeat(40);
  assert.match(validate(wrongSource).failures.join('\n'), /repeat pack did not bind two complete runs/);
  const missingProvenance = structuredClone(base);
  delete missingProvenance.preflight.environment.toolchain.rust.cargo;
  assert.match(validate(missingProvenance).failures.join('\n'), /preflight Rust\/Cargo provenance/);
  assert.equal(validate({...base, runtime:null}).failures[0], 'Windows runtime CLI/lifecycle result missing');
  console.log('Windows package summary self-check passed');
}

if (selfCheckMode) {
  selfCheck();
} else {
  const directory = resolve(process.argv[2]);
  const parseErrors = {};
  const read = name => {
    const path = join(directory, name);
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, 'utf8')); }
    catch (error) { parseErrors[name] = error.message; return null; }
  };
  const preflight = read('preflight.json');
  const packed = read('package-result.json');
  const repeat = read('repeat-pack.json');
  const install = read('windows-package-install.json');
  const runtime = read('windows-runtime-cli-evidence.json');
  const jestExpo = read('jest-expo-check.json');
  const vitest = read('vitest-check.json');
  const sharedCli = read('shared-cli.json');
  const sharedParallel = read('shared-parallel.json');
  const artifacts = {};
  for (const [key, name] of [['tarball', 'seshat-windows-x64.tgz'], ['standalone', 'seshat-windows-x64-standalone.tar.gz'], ['build', 'BUILD.json']]) {
    const path = join(directory, name);
    if (existsSync(path) && statSync(path).isFile()) artifacts[key] = {file:name, sha256:hashFile(path), bytes:statSync(path).size};
  }
  const {failures, integrationGaps, repeatPack} = validate({preflight, packed, repeat, install, runtime, jestExpo, vitest, sharedCli, sharedParallel}, parseErrors, directory, artifacts);
  const sourceCommit = preflight?.provenance?.sourceCommit ?? process.env.GITHUB_SHA ?? repeat?.sourceCommit ?? null;
  const portablePackage = packed && artifacts.tarball && artifacts.standalone ? {...packed,
    tarball:artifacts.tarball.file, proofBinary:null, tarballSha256:artifacts.tarball.sha256,
    standalone:{...packed.standalone, path:artifacts.standalone.file, sha256:artifacts.standalone.sha256, bytes:artifacts.standalone.bytes}} : null;
  const summary = {
    schemaVersion:1,
    kind:'seshat-windows-x64-package-proof',
    sourceCommit,
    testedCommit:sourceCommit,
    runner:'windows-2022',
    os:'Windows Server 2022',
    kernelBuild:preflight?.environment?.os?.kernelBuild ?? null,
    node:'24.20.0',
    rust:'1.98.1',
    architecture:'x64',
    target:'x86_64-pc-windows-msvc',
    peMachine:'0x8664',
    crtStatic:true,
    preflight:preflight ? {candidate:preflight.candidate, environment:preflight.environment, validation:preflight.validation, provenance:preflight.provenance} : null,
    artifacts:packed ? {build:artifacts.build ?? null, npmTarball:artifacts.tarball ?? null, standalone:artifacts.standalone ?? null,
      binary:{sha256:packed.binary ?? null, bytes:packed.binaryBytes ?? null}} : null,
    build:install?.build ?? packed?.build ?? null,
    npm:install ? {tarballSha256:install.tarball?.sha256 ?? null, standaloneArchiveSha256:install.standaloneArchive?.sha256 ?? null,
      binary:install.binary ?? null, checks:Object.fromEntries(Object.entries(install.checks ?? {}).map(([name, value]) => [name, value.status]))} : null,
    standalone:install ? {archiveSha256:install.standaloneArchive?.sha256 ?? null, binary:install.binary ?? null,
      checks:Object.fromEntries(['standalone-list', 'standalone-extract', 'standalone-version', 'standalone-help'].map(name => [name, install.checks?.[name]?.status ?? null]))} : null,
    runtime:runtime ? {binary:runtime.binary ?? null, scenarios:Object.fromEntries(runtimeCases.map(name => [name, Boolean(runtime.scenarios?.[name])])), validation:runtime.validation ?? null} : null,
    integration:{sharedCli:sharedCli ? {scenarios:Object.keys(sharedCli).length} : null, sharedParallel:sharedParallel ? {cases:Object.keys(sharedParallel).length} : null,
      jestExpo:jestExpo ? {requested:jestExpo.checks?.requested, completed:jestExpo.checks?.completed} : null,
      vitest:vitest ? {requested:vitest.checks?.requested, completed:vitest.checks?.completed} : null, gaps:integrationGaps},
    repeatPack:repeat ? {sourceCommit:repeat.sourceCommit, host:repeat.host, toolchain:repeat.toolchain, input:repeat.input,
      runs:repeat.runs, comparisons:repeat.comparisons, validation:repeat.validation} : null,
    validation:{package:Boolean(packed && portablePackage), repeatPack,
      npm:Boolean(install), standalone:Boolean(install), runtime:Boolean(runtime), passed:failures.length === 0, failures},
    limits:'Native Windows Server 2022 x64 proof on the windows-2022 runner. It does not establish support for desktop Windows versions, older Windows builds, Windows ARM64, POSIX signal semantics, signing, notarization or public release distribution.',
  };
  writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  if (portablePackage) writeFileSync(join(directory, 'package-result.json'), JSON.stringify(portablePackage, null, 2) + '\n');
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Wrote ${join(directory, 'summary.json')}. Integration gaps: ${integrationGaps.length}`);
  }
}
