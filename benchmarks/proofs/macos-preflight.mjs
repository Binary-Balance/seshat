import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {release} from 'node:os';

const expectedNode = 'v24.20.0';
const expectedRust = '1.98.1';
const expectedDeploymentTarget = '15.0';

function firstLine(value) {
  return String(value ?? '').trim().split('\n', 1)[0] || null;
}

function probe(command, args = ['--version']) {
  const result = spawnSync(command, args, {encoding: 'utf8', maxBuffer: 128 * 1024});
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return {
    available: result.status === 0 && Boolean(text),
    version: firstLine(text),
    text,
    status: result.status ?? null,
    error: result.error?.code ?? null,
  };
}

function publicProbe(result) {
  return {available: result.available, version: result.version};
}

function translatedProbe() {
  // Native Intel lacks this key; omit sysctl -i so only its diagnostic is treated as absence.
  const result = spawnSync('sysctl', ['-n', 'sysctl.proc_translated'], {encoding: 'utf8'});
  const stderr = (result.stderr ?? '').trim();
  const absentKey = result.status !== 0 && /unknown oid/i.test(stderr);
  return {
    value: result.status === 0 ? firstLine(result.stdout) : absentKey ? '0' : null,
    status: result.status ?? null,
    absentKey,
    error: result.error?.code ?? null,
  };
}

function sourceCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  const result = probe('git', ['rev-parse', 'HEAD']);
  return result.available ? result.version : null;
}

function pullRequestHead() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;
  try {
    return JSON.parse(readFileSync(eventPath, 'utf8')).pull_request?.head?.sha ?? null;
  } catch {
    return null;
  }
}

function rustInfo() {
  const rustc = probe('rustc');
  const details = rustc.available ? probe('rustc', ['-vV']) : null;
  return {
    rustc: publicProbe(rustc),
    cargo: publicProbe(probe('cargo')),
    host: details?.text.match(/^host:\s*(.+)$/m)?.[1] ?? null,
  };
}

function options() {
  const value = name => {
    const index = process.argv.indexOf(name);
    assert.ok(index >= 0 && process.argv[index + 1], `${name} needs a value`);
    return process.argv[index + 1];
  };
  return {
    cpu: value('--cpu'),
    target: value('--target'),
    runner: value('--runner'),
    output: process.argv.includes('--output') ? value('--output') : 'macos-preflight.json',
  };
}

function collect({cpu, target, runner}) {
  const productVersion = probe('sw_vers', ['-productVersion']).version;
  const translated = translatedProbe();
  const machine = probe('sysctl', ['-n', 'hw.machine']);
  const unameMachine = probe('uname', ['-m']);
  const unameRelease = probe('uname', ['-r']);
  const sdk = probe('xcrun', ['--sdk', 'macosx', '--show-sdk-version']);
  const clang = probe('clang');
  const rust = rustInfo();
  const npm = probe('npm', ['--version']);
  const deploymentTarget = process.env.MACOSX_DEPLOYMENT_TARGET ?? null;
  const runnerImage = {
    label: runner,
    os: process.env.RUNNER_OS ?? null,
    architecture: process.env.RUNNER_ARCH ?? null,
    name: process.env.RUNNER_NAME ?? null,
    imageOS: process.env.ImageOS ?? null,
    imageVersion: process.env.ImageVersion ?? null,
  };
  return {
    schemaVersion: 1,
    kind: `seshat-macos-${cpu}-preflight`,
    capturedAt: new Date().toISOString(),
    candidate: {runner, os: 'macOS 15', cpu, target, node: '24.20.0', deploymentTarget},
    environment: {
      platform: process.platform,
      os: {productVersion},
      architecture: {
        node: process.arch, unameMachine: unameMachine.version, machine: machine.version,
        translated: translated.value,
        translatedProbe: {status: translated.status, absentKey: translated.absentKey, error: translated.error},
      },
      kernel: {release: release(), unameRelease},
      node: {version: process.version},
      npm: publicProbe(npm),
      toolchain: {rust, clang: publicProbe(clang), sdk: publicProbe(sdk)},
      deploymentTarget,
      runnerImage,
    },
    provenance: {
      repository: process.env.GITHUB_REPOSITORY ?? null,
      ref: process.env.GITHUB_REF ?? null,
      event: process.env.GITHUB_EVENT_NAME ?? null,
      workflow: process.env.GITHUB_WORKFLOW ?? null,
      workflowRef: process.env.GITHUB_WORKFLOW_REF ?? null,
      workflowSha: process.env.GITHUB_WORKFLOW_SHA ?? null,
      job: process.env.GITHUB_JOB ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      sourceCommit: sourceCommit(),
      pullRequestHead: pullRequestHead(),
    },
  };
}

function validate(report) {
  const failures = [];
  const candidate = report.candidate ?? {};
  const environment = report.environment ?? {};
  const architecture = environment.architecture ?? {};
  const toolchain = environment.toolchain ?? {};
  const rust = toolchain.rust ?? {};
  const expectedMachine = candidate.cpu === 'arm64' ? 'arm64' : 'x86_64';
  const expectedTarget = candidate.cpu === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  const version = environment.os?.productVersion;
  if (environment.platform !== 'darwin') failures.push(`OS: expected macOS, got ${environment.platform ?? 'unknown'}`);
  if (!/^15\./.test(version ?? '')) failures.push(`OS: expected macOS 15, got ${version ?? 'unknown'}`);
  if (candidate.cpu !== 'x64' && candidate.cpu !== 'arm64') failures.push(`CPU: unsupported candidate ${candidate.cpu ?? 'unknown'}`);
  if (architecture.node !== candidate.cpu) failures.push(`architecture: expected process.arch=${candidate.cpu}, got ${architecture.node ?? 'unknown'}`);
  if (architecture.unameMachine !== expectedMachine) failures.push(`architecture: expected uname -m=${expectedMachine}, got ${architecture.unameMachine ?? 'unknown'}`);
  if (architecture.machine !== expectedMachine) failures.push(`architecture: expected hw.machine=${expectedMachine}, got ${architecture.machine ?? 'unknown'}`);
  if (architecture.translated !== '0') failures.push(`Rosetta: expected sysctl.proc_translated=0, got ${architecture.translated ?? 'unknown'}`);
  if (candidate.target !== expectedTarget) failures.push(`Rust target: expected ${expectedTarget}, got ${candidate.target ?? 'unknown'}`);
  if (environment.node?.version !== expectedNode) failures.push(`Node: expected ${expectedNode}, got ${environment.node?.version ?? 'unknown'}`);
  if (!environment.npm?.available) failures.push('npm: npm is unavailable');
  if (environment.deploymentTarget !== expectedDeploymentTarget) failures.push(`deployment target: expected ${expectedDeploymentTarget}, got ${environment.deploymentTarget ?? 'unknown'}`);
  if (!toolchain.sdk?.available) failures.push('SDK: xcrun macOS SDK is unavailable');
  if (!toolchain.clang?.available) failures.push('Clang: clang is unavailable');
  if (!rust.rustc?.available || !rust.cargo?.available) failures.push('Rust: rustc and cargo are required before the build');
  if (!rust.rustc?.version?.startsWith(`rustc ${expectedRust}`)) failures.push(`rustc: expected ${expectedRust}, got ${rust.rustc?.version ?? 'unknown'}`);
  if (!rust.cargo?.version?.startsWith(`cargo ${expectedRust}`)) failures.push(`cargo: expected ${expectedRust}, got ${rust.cargo?.version ?? 'unknown'}`);
  if (rust.host !== candidate.target) failures.push(`Rust host: expected ${candidate.target}, got ${rust.host ?? 'unknown'}`);
  return failures;
}

function selfCheck() {
  const report = {
    candidate: {cpu: 'arm64', target: 'aarch64-apple-darwin'},
    environment: {
      platform: 'darwin', os: {productVersion: '15.7.1'},
      architecture: {node: 'arm64', unameMachine: 'arm64', machine: 'arm64', translated: '0'},
      node: {version: expectedNode}, npm: {available: true}, deploymentTarget: expectedDeploymentTarget,
      toolchain: {sdk: {available: true}, clang: {available: true}, rust: {
        rustc: {available: true, version: `rustc ${expectedRust}`},
        cargo: {available: true, version: `cargo ${expectedRust}`}, host: 'aarch64-apple-darwin'}},
    },
  };
  assert.deepEqual(validate(report), []);
  for (const [change, message] of [
    [value => { value.environment.platform = 'linux'; }, 'expected macOS'],
    [value => { value.environment.architecture.translated = '1'; }, 'Rosetta'],
    [value => { value.environment.architecture.unameMachine = 'x86_64'; }, 'uname'],
    [value => { value.environment.os.productVersion = '14.7'; }, 'macOS 15'],
    [value => { value.environment.deploymentTarget = '14.0'; }, 'deployment target'],
    [value => { value.environment.toolchain.rust.host = 'x86_64-apple-darwin'; }, 'Rust host'],
  ]) {
    const changed = structuredClone(report);
    change(changed);
    assert.match(validate(changed).join('\n'), new RegExp(message));
  }
  if (process.platform === 'darwin') {
    const actual = translatedProbe();
    assert.equal(actual.value, '0');
    assert.equal(actual.error, null);
    assert.equal(actual.status === 0 || actual.absentKey, true);
    if (process.arch === 'x64') assert.equal(actual.absentKey, true);
  }
  console.log('macOS preflight self-check passed');
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  const settings = options();
  const report = collect(settings);
  const failures = validate(report);
  report.validation = {passed: failures.length === 0, failures};
  writeFileSync(settings.output, JSON.stringify(report, null, 2) + '\n');
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`macOS preflight passed. Artifact: ${settings.output}`);
  }
}
