import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {arch, release, version as osVersion} from 'node:os';
import {basename, join} from 'node:path';

const expected = {
  node:'v24.20.0',
  rust:'1.98.1',
  rustHost:'x86_64-pc-windows-msvc',
  kernelBuild:20348,
};

function probe(command, args = [], options = {}) {
  const result = spawnSync(command, args, {encoding:'utf8', maxBuffer:256 * 1024, ...options});
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return {
    available:!result.error && Boolean(text),
    version:text.split(/\r?\n/, 1)[0] || null,
    text,
    status:result.status ?? null,
    error:result.error?.code ?? null,
  };
}

function publicProbe(result) {
  return {available:result.available, version:result.version};
}

const msvcIdentity = /^Microsoft \(R\) C\/C\+\+ Optimizing Compiler Version .+ for x64\b/m;
const linkerIdentity = /^Microsoft \(R\) Incremental Linker Version \S+/m;

function publicTool(result, identity) {
  const valid = result.available && identity.test(result.text);
  return {available:valid, version:valid ? result.version : null};
}

function tool(command, identity) {
  return publicTool(probe(command), identity);
}

function rustInfo() {
  const rustc = probe('rustc', ['-vV']);
  const cargo = probe('cargo', ['--version']);
  return {
    rustc:publicProbe(rustc),
    cargo:publicProbe(cargo),
    version:rustc.text.match(/^rustc\s+(\S+)/m)?.[1] ?? null,
    host:rustc.text.match(/^host:\s*(.+)$/m)?.[1] ?? null,
  };
}

function npmInfo() {
  const command = process.env.SESHAT_NPM_CMD ?? 'npm.cmd';
  return {command:basename(command), ...publicProbe(probe(command, ['--version'], {shell:true}))};
}

function sourceCommit() {
  const result = probe('git', ['rev-parse', 'HEAD']);
  return result.available ? result.version : null;
}

function kernelBuild(value) {
  return Number(String(value).match(/\b10\.0\.(\d+)\b/)?.[1] ?? NaN);
}

function sdkInfo() {
  const directory = process.env.WindowsSdkDir?.replace(/[\\/]+$/, '') ??
    join(process.env['ProgramFiles(x86)'] ?? process.env.ProgramFiles ?? 'C:\\Program Files (x86)', 'Windows Kits', '10');
  return {
    directory,
    version:process.env.WindowsSDKVersion?.replace(/[\\/]+$/, '') ??
      (existsSync(join(directory, 'Lib')) ? readdirSync(join(directory, 'Lib')).filter(value => /^\d/.test(value)).sort().at(-1) ?? null : null),
    ucrtVersion:process.env.UCRTVersion ?? null,
  };
}

function collect() {
  const sdk = sdkInfo();
  return {
    schemaVersion:1,
    kind:'seshat-windows-package-preflight',
    capturedAt:new Date().toISOString(),
    candidate:{runner:'windows-2022', os:'Windows Server 2022', kernelBuild:expected.kernelBuild,
      node:'24.20.0', rust:'1.98.1', target:'x86_64-pc-windows-msvc', cpu:'x64', crtStatic:true},
    environment:{
      platform:process.platform,
      os:{release:release(), version:osVersion(), kernelBuild:kernelBuild(release())},
      architecture:{node:process.arch, os:arch(), processor:process.env.PROCESSOR_ARCHITECTURE ?? null},
      node:{version:process.version},
      npm:npmInfo(),
      toolchain:{rust:rustInfo(), msvc:tool('cl.exe', msvcIdentity), linker:tool('link.exe', linkerIdentity), sdk},
      shell:{comspec:process.env.ComSpec ?? process.env.COMSPEC ?? null,
        systemRoot:process.env.SystemRoot ?? process.env.SYSTEMROOT ?? null},
      runnerImage:{label:'windows-2022', os:process.env.RUNNER_OS ?? null, architecture:process.env.RUNNER_ARCH ?? null,
        name:process.env.RUNNER_NAME ?? null, imageOS:process.env.ImageOS ?? null, imageVersion:process.env.ImageVersion ?? null},
    },
    provenance:{repository:process.env.GITHUB_REPOSITORY ?? null, ref:process.env.GITHUB_REF ?? null,
      event:process.env.GITHUB_EVENT_NAME ?? null, workflow:process.env.GITHUB_WORKFLOW ?? null,
      workflowRef:process.env.GITHUB_WORKFLOW_REF ?? null, workflowSha:process.env.GITHUB_WORKFLOW_SHA ?? null,
      job:process.env.GITHUB_JOB ?? null, runId:process.env.GITHUB_RUN_ID ?? null,
      runAttempt:process.env.GITHUB_RUN_ATTEMPT ?? null, sourceCommit:sourceCommit()},
  };
}

function validate(report) {
  const failures = [];
  const environment = report.environment ?? {};
  const candidate = report.candidate ?? {};
  const architecture = environment.architecture ?? {};
  const rust = environment.toolchain?.rust ?? {};
  const runner = environment.runnerImage ?? {};
  if (environment.platform !== 'win32') failures.push(`OS: expected Windows, got ${environment.platform ?? 'unknown'}`);
  if (architecture.node !== 'x64' || architecture.os !== 'x64') failures.push('architecture: expected Windows x64');
  if (environment.os?.kernelBuild !== expected.kernelBuild) failures.push(`kernel build: expected ${expected.kernelBuild}`);
  if (runner.label !== 'windows-2022' || runner.os !== 'Windows') failures.push('runner: expected Windows windows-2022');
  if (environment.node?.version !== expected.node) failures.push(`Node: expected ${expected.node}`);
  if (!environment.npm?.available) failures.push('npm.cmd is unavailable');
  if (!rust.rustc?.available || !rust.rustc.version?.startsWith(`rustc ${expected.rust}`) ||
      !rust.cargo?.available || !rust.cargo.version?.startsWith(`cargo ${expected.rust}`)) {
    failures.push(`Rust: expected rustc/cargo ${expected.rust}`);
  }
  if (rust.host !== expected.rustHost) failures.push(`Rust host: expected ${expected.rustHost}`);
  if (!environment.toolchain?.msvc?.available) failures.push('MSVC compiler is unavailable');
  if (!environment.toolchain?.linker?.available) failures.push('MSVC linker is unavailable');
  if (!environment.toolchain?.sdk?.version) failures.push('Windows SDK version is unavailable');
  if (!environment.shell?.systemRoot || !environment.shell?.comspec || !existsSync(environment.shell.comspec)) {
    failures.push('SystemRoot and ComSpec are required');
  }
  if (candidate.target !== 'x86_64-pc-windows-msvc') failures.push('candidate target is not x86_64-pc-windows-msvc');
  return failures;
}

function outputPath() {
  const index = process.argv.indexOf('--output');
  if (index < 0) return 'windows-package-preflight.json';
  assert.ok(process.argv[index + 1], '--output needs a path');
  return process.argv[index + 1];
}

function selfCheck() {
  const windows = {release:'10.0.20348', version:'Windows Server 2022 Datacenter'};
  assert.equal(kernelBuild(windows.release), 20348);
  assert.notEqual(kernelBuild(windows.version), 20348);
  assert.equal(publicTool({available:true, version:'Microsoft (R) C/C++ Optimizing Compiler Version 19.44 for x64', text:'Microsoft (R) C/C++ Optimizing Compiler Version 19.44 for x64'}, msvcIdentity).available, true);
  assert.equal(publicTool({available:true, version:'link: missing operand', text:'link: missing operand'}, linkerIdentity).available, false);
  const report = {
    candidate:{target:'x86_64-pc-windows-msvc'},
    environment:{platform:'win32', os:{...windows, kernelBuild:kernelBuild(windows.release)}, architecture:{node:'x64', os:'x64'},
      node:{version:expected.node}, npm:{available:true},
      toolchain:{rust:{rustc:{available:true, version:`rustc ${expected.rust}`}, cargo:{available:true, version:`cargo ${expected.rust}`}, host:expected.rustHost},
        msvc:{available:true}, linker:{available:true}, sdk:{version:'10.0.26100.0'}},
      shell:{systemRoot:'C:\\Windows', comspec:process.execPath},
      runnerImage:{label:'windows-2022', os:'Windows'},
    },
  };
  assert.deepEqual(validate(report), []);
  for (const [change, message] of [
    [value => { value.environment.platform = 'linux'; }, 'expected Windows'],
    [value => { value.environment.os.kernelBuild = 19041; }, 'kernel build'],
    [value => { value.environment.toolchain.rust.host = 'x86_64-unknown-linux-gnu'; }, 'Rust host'],
    [value => { value.environment.toolchain.sdk.version = null; }, 'SDK'],
  ]) {
    const changed = structuredClone(report);
    change(changed);
    assert.match(validate(changed).join('\n'), new RegExp(message));
  }
  console.log('Windows package preflight self-check passed');
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  const report = collect();
  const failures = validate(report);
  report.validation = {passed:failures.length === 0, failures};
  const path = outputPath();
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Windows package preflight passed. Artifact: ${path}`);
  }
}
