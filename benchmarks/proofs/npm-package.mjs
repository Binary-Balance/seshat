// Local installation only. Every consumer, npm cache and lockfile is disposable.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync} from 'node:fs';
import {delimiter, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(process.argv.length, 3, 'usage: node benchmarks/proofs/npm-package.mjs <local tarball>');
const tarball = realpathSync(process.argv[2]);
assert.ok(statSync(tarball).isFile());
if (process.env.SESHAT_TARBALL_SHA256) {
  assert.equal(createHash('sha256').update(readFileSync(tarball)).digest('hex'), process.env.SESHAT_TARBALL_SHA256);
}
mkdirSync(join(repo, 'work/assurance-proofs'), {recursive: true});
const work = mkdtempSync(join(repo,'work/assurance-proofs/npm-package-'));
const tools = join(work,'tools'); mkdirSync(tools);
const npm = process.env.PATH.split(delimiter).map(path => join(path,'npm')).find(existsSync);
assert.ok(npm, 'npm must be installed');
symlinkSync(process.execPath,join(tools,'node'));
symlinkSync(realpathSync(npm),join(tools,'npm'));
symlinkSync('/bin/sh',join(tools,'sh'));
const env = {...process.env, PATH:tools,
  npm_config_userconfig:join(work,'user.npmrc'), npm_config_globalconfig:join(work,'global.npmrc'),
  npm_config_cache:join(work,'cache'), npm_config_offline:'true', npm_config_update_notifier:'false'};
delete env.CARGO_HOME; delete env.RUSTUP_HOME; delete env.CARGO_TARGET_DIR;
for(const command of ['cargo','rustc']) assert.equal(spawnSync(command,['--version'],{env}).error?.code,'ENOENT');
const npmOptions = ['--offline','--ignore-scripts','--no-audit','--no-fund','--cache',join(work,'cache'),
  '--userconfig',join(work,'user.npmrc'),'--globalconfig',join(work,'global.npmrc')];
const read = path => JSON.parse(readFileSync(path,'utf8'));
const json = (path,value) => writeFileSync(path,JSON.stringify(value,null,2)+'\n');
const evidence = {};
const candidateOs = process.platform;
assert.ok(candidateOs === 'linux' || candidateOs === 'darwin', `unsupported proof OS: ${candidateOs}`);
const candidateCpu = process.arch;
assert.ok(candidateCpu === 'x64' || candidateCpu === 'arm64', `unsupported proof CPU: ${candidateCpu}`);
const expectedLibc = candidateOs === 'linux' ? ['glibc'] : undefined;
const expectedChecks = candidateOs === 'linux' ? 16 : 14;
const unsupportedOs = candidateOs === 'darwin' ? 'linux' : 'darwin';
const unsupportedCpu = candidateCpu === 'arm64' ? 'x64' : 'arm64';
function run(name, command, args, cwd, status = 0) {
  const started = performance.now();
  const child = spawnSync(command,args,{cwd,env,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
  assert.ifError(child.error);
  assert.equal(child.status,status,child.stdout+child.stderr);
  evidence[name] = {status:child.status,ms:performance.now()-started,stdout:child.stdout,stderr:child.stderr};
  console.log(`${name}: exit ${child.status}`);
  return child;
}
const consumer = join(work,'consumer 🎸'); mkdirSync(consumer);
json(join(consumer,'package.json'),{name:'seshat-local-consumer',version:'0.0.0',private:true,scripts:{assurance:'seshat'}});
run('offline-install','npm',['install','--save-dev','--save-exact',tarball,...npmOptions],consumer);
const installed = join(consumer,'node_modules/@binary-balance/seshat');
const executable = join(consumer,'node_modules/.bin/seshat');
assert.equal(realpathSync(executable),join(installed,'bin/seshat'));
const manifest = read(join(installed,'package.json'));
assert.equal(manifest.private,true);
assert.equal(manifest.license,'MIT');
assert.equal(manifest.scripts,undefined);
assert.equal(manifest.dependencies,undefined);
assert.equal(manifest.optionalDependencies,undefined);
assert.deepEqual(manifest.os,[candidateOs]); assert.deepEqual(manifest.cpu,[candidateCpu]);
if (expectedLibc) assert.deepEqual(manifest.libc, expectedLibc); else assert.equal(manifest.libc, undefined);
assert.deepEqual(readdirSync(installed).sort(),['BUILD.json','LICENSE','README.md','THIRD_PARTY_NOTICES.txt','bin','package.json'].sort());
assert.deepEqual(Object.keys(read(join(consumer,'package-lock.json')).packages).sort(),['','node_modules/@binary-balance/seshat']);
const build = read(join(installed,'BUILD.json'));
if (candidateCpu === 'arm64') assert.equal(build.cpu,candidateCpu);
const expectedTarget = candidateOs === 'darwin'
  ? `${candidateCpu === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
  : `${candidateCpu === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-gnu`;
assert.equal(build.target, expectedTarget);
if (candidateOs === 'darwin') {
  assert.equal(build.minimumMacos, '15.0');
  assert.equal(build.deploymentTarget, '15.0');
}
const binary = readFileSync(executable);
const binarySha256 = createHash('sha256').update(binary).digest('hex');
assert.equal(binarySha256,build.binarySha256);
if (process.env.SESHAT_BINARY_SHA256) assert.equal(binarySha256,process.env.SESHAT_BINARY_SHA256);
assert.equal(binary.length,build.binaryBytes);
assert.ok(build.dependencies.length>0);
assert.match(readFileSync(join(installed,'THIRD_PARTY_NOTICES.txt'),'utf8'),/VoidZero/);
const version = run('installed-version',executable,['--version'],consumer).stdout;
assert.match(version,/seshat 0\.0\.0 \(candidate\)/);
run('npm-exec','npm',['exec',...npmOptions,'--','seshat','--help'],consumer);
run('package-script','npm',['run','--silent','assurance','--','--version'],consumer);
run('script-exit-2','npm',['run','--silent','assurance','--','bogus','--json'],consumer,2);
run('offline-ci','npm',['ci',...npmOptions],consumer);
assert.equal(run('version-after-ci',executable,['--version'],consumer).stdout,version);

const workspace = join(work,'workspace'); mkdirSync(join(workspace,'packages/app'),{recursive:true});
json(join(workspace,'package.json'),{name:'workspace-fixture',private:true,workspaces:['packages/*']});
json(join(workspace,'packages/app/package.json'),{name:'workspace-app',version:'0.0.0',private:true,scripts:{assurance:'seshat'}});
run('workspace-install','npm',['install','--workspace','workspace-app','--save-dev',tarball,...npmOptions],workspace);
run('workspace-script','npm',['run','--silent','--workspace','workspace-app','assurance','--','--version'],workspace);

// npm 11's overrides apply to optional dependencies, not this required dependency.
// Invert one requirement in disposable control packages to test actual rejection here.
const rejectedPlatforms = [['os',unsupportedOs],['cpu',unsupportedCpu]];
if (candidateOs === 'linux') rejectedPlatforms.push(['libc','musl']);
for(const [field,value] of rejectedPlatforms) {
  const control = join(work,`${field}-control`); mkdirSync(control);
  json(join(control,'package.json'),{...manifest,name:`seshat-${field}-control`,[field]:[value],bin:undefined,files:[]});
  const packed = run(`pack-${field}-control`,'npm',['pack',control,'--json','--pack-destination',control,...npmOptions],work);
  const controlTarball = join(control,JSON.parse(packed.stdout)[0].filename);
  const rejected = join(work,`${field}-consumer`); mkdirSync(rejected);
  json(join(rejected,'package.json'),{private:true});
  const child = run(`reject-${field}`,'npm',['install',controlTarball,...npmOptions],rejected,1);
  assert.match(child.stderr,/EBADPLATFORM/);
  assert.equal(existsSync(join(rejected,`node_modules/seshat-${field}-control`)),false);
}

// The unchanged assessment regression now invokes the installed native command.
env.SESHAT_CLI_BINARY = executable;
const regression = run('installed-cli-regression',process.execPath,[join(repo,'benchmarks/proofs/cli.mjs')],consumer);
const cliSummary = regression.stdout.match(/CLI passed: (\d+) scenarios plus legacy parity/);
assert.ok(cliSummary && Number(cliSummary[1]) === 43, regression.stdout);
const cliScenarioCount = Number(cliSummary[1]);
assert.equal(createHash('sha256').update(readFileSync(executable)).digest('hex'),binarySha256);
assert.equal(Object.keys(evidence).length,expectedChecks);
const result = {tarball,work,installedBinary:executable,build,checks:evidence};
const resultPath = process.env.SESHAT_PROOF_OUTPUT ?? join(work,'result.json');
json(join(work,'result.json'),result);
if (process.env.SESHAT_PROOF_OUTPUT) json(resultPath,result);
console.log(`npm package passed: ${Object.keys(evidence).length} checks, including ${cliScenarioCount} installed CLI scenarios${candidateOs === 'darwin' ? ' (macOS omits Linux libc controls)' : ''}. Results: ${resultPath}`);
