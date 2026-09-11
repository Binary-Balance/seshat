import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {release} from 'node:os';

const expected = {
  node: 'v24.20.0',
  architecture: 'x64',
  unameMachine: 'x86_64',
  os: {id: 'ubuntu', version: '22.04', codename: 'jammy'},
  glibc: '2.35',
  rustHost: 'x86_64-unknown-linux-gnu',
  kernel: {major: 6, minor: 8},
};

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

function parseRelease(text) {
  return Object.fromEntries(text.split('\n').flatMap(line => {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match) return [];
    return [[match[1], match[2].replace(/^"|"$/g, '')]];
  }));
}

function readRelease() {
  try {
    return parseRelease(readFileSync('/etc/os-release', 'utf8'));
  } catch {
    return {};
  }
}

function kernelAtLeast(value) {
  const match = String(value ?? '').match(/^(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > expected.kernel.major || major === expected.kernel.major && minor >= expected.kernel.minor;
}

function rustInfo() {
  const rustc = probe('rustc');
  const details = rustc.available ? probe('rustc', ['-vV']) : null;
  const host = details?.text.match(/^host:\s*(.+)$/m)?.[1] ?? null;
  return {rustc: publicProbe(rustc), cargo: publicProbe(probe('cargo')), host};
}

function sourceCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  const result = probe('git', ['rev-parse', 'HEAD']);
  return result.available ? result.version : null;
}

function collect() {
  const osRelease = readRelease();
  const unameMachine = probe('uname', ['-m']).version;
  const unameRelease = probe('uname', ['-r']).version;
  const kernelRelease = release();
  const npm = probe('npm', ['--version']);
  const rust = rustInfo();
  const killVersion = probe('kill');
  let posixKillAvailable = true;
  let posixKillError = null;
  try {
    process.kill(process.pid, 0);
  } catch (error) {
    posixKillAvailable = false;
    posixKillError = error.code ?? error.name;
  }
  const runnerImage = {
    label: 'ubuntu-22.04',
    os: process.env.RUNNER_OS ?? null,
    architecture: process.env.RUNNER_ARCH ?? null,
    name: process.env.RUNNER_NAME ?? null,
    imageOS: process.env.ImageOS ?? null,
    imageVersion: process.env.ImageVersion ?? null,
  };

  return {
    schemaVersion: 1,
    kind: 'seshat-linux-x64-preflight',
    capturedAt: new Date().toISOString(),
    candidate: {
      runner: runnerImage.label,
      userspace: 'Ubuntu 22.04 / glibc 2.35',
      minimumUserspace: 'Debian 11 / glibc 2.31',
      kernelFloor: '6.8 family',
      node: '24.20.0',
    },
    environment: {
      platform: process.platform,
      os: {release: osRelease},
      architecture: {node: process.arch, unameMachine},
      kernel: {release: kernelRelease, unameRelease, meetsCandidateFloor: kernelAtLeast(kernelRelease)},
      glibc: process.report?.getReport?.().header?.glibcVersionRuntime ?? null,
      node: {version: process.version},
      npm: publicProbe(npm),
      toolchain: {
        rust,
        gcc: publicProbe(probe('gcc')),
        gxx: publicProbe(probe('g++')),
        clang: publicProbe(probe('clang')),
        cc: publicProbe(probe('cc')),
        linker: publicProbe(probe('ld')),
        make: publicProbe(probe('make')),
        python: publicProbe(probe('python3')),
      },
      kill: {
        available: posixKillAvailable && killVersion.available,
        status: killVersion.status,
        error: posixKillError ?? (killVersion.available ? null : killVersion.error),
        version: killVersion.version,
      },
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
    },
  };
}

function validate(report) {
  const failures = [];
  const environment = report.environment;
  const os = environment.os.release;
  if (environment.platform !== 'linux') failures.push(`OS: expected Linux, got ${environment.platform ?? 'unknown'}`);
  if (environment.architecture.node !== expected.architecture) {
    failures.push(`architecture: expected process.arch=${expected.architecture}, got ${environment.architecture.node ?? 'unknown'}`);
  }
  if (environment.architecture.unameMachine !== expected.unameMachine) {
    failures.push(`architecture: expected uname -m=${expected.unameMachine}, got ${environment.architecture.unameMachine ?? 'unknown'}`);
  }
  if (os.ID !== expected.os.id || os.VERSION_ID !== expected.os.version || os.VERSION_CODENAME !== expected.os.codename) {
    failures.push(`OS: expected Ubuntu 22.04 (jammy), got ${os.PRETTY_NAME ?? 'unknown'}`);
  }
  if (environment.glibc !== expected.glibc) failures.push(`glibc: expected ${expected.glibc}, got ${environment.glibc ?? 'unknown'}`);
  if (environment.node.version !== expected.node) failures.push(`Node: expected ${expected.node}, got ${environment.node.version ?? 'unknown'}`);
  if (!environment.kernel.meetsCandidateFloor || !kernelAtLeast(environment.kernel.release)) {
    failures.push(`kernel: expected Linux ${expected.kernel.major}.${expected.kernel.minor} or newer, got ${environment.kernel.release ?? 'unknown'}`);
  }
  if (!environment.kill.available) failures.push('kill: POSIX kill -0 is unavailable');
  const rust = environment.toolchain.rust;
  if (rust.rustc.available && rust.host !== expected.rustHost) failures.push(`Rust host: expected ${expected.rustHost}, got ${rust.host ?? 'unknown'}`);
  return failures;
}

function selfCheck() {
  const passing = {
    environment: {
      platform: 'linux',
      os: {release: {ID: 'ubuntu', VERSION_ID: '22.04', VERSION_CODENAME: 'jammy'}},
      architecture: {node: 'x64', unameMachine: 'x86_64'},
      kernel: {release: '6.8.0-test', meetsCandidateFloor: true},
      glibc: '2.35',
      node: {version: 'v24.20.0'},
      kill: {available: true},
      toolchain: {rust: {rustc: {available: false}, host: null}},
    },
  };
  assert.deepEqual(validate(passing), []);
  for (const [change, expectedMessage] of [
    [report => { report.environment.platform = 'darwin'; }, 'expected Linux'],
    [report => { report.environment.architecture.node = 'arm64'; }, 'process.arch'],
    [report => { report.environment.architecture.unameMachine = 'aarch64'; }, 'uname -m'],
    [report => { report.environment.os.release.VERSION_ID = '24.04'; }, 'Ubuntu 22.04'],
    [report => { report.environment.glibc = '2.34'; }, 'glibc'],
    [report => { report.environment.node.version = 'v22.0.0'; }, 'Node'],
    [report => { report.environment.kernel.release = '6.7.0-test'; report.environment.kernel.meetsCandidateFloor = false; }, 'kernel'],
    [report => { report.environment.kill.available = false; }, 'kill'],
    [report => { report.environment.toolchain.rust.rustc.available = true; report.environment.toolchain.rust.host = 'aarch64-unknown-linux-gnu'; }, 'Rust host'],
  ]) {
    const report = structuredClone(passing);
    change(report);
    assert.match(validate(report).join('\n'), new RegExp(expectedMessage.replace(/[().]/g, '\\$&')));
  }
  console.log('Linux x64 preflight self-check passed');
}

function outputPath() {
  const index = process.argv.indexOf('--output');
  if (index < 0) return 'linux-x64-preflight.json';
  assert.ok(process.argv[index + 1], '--output needs a path');
  return process.argv[index + 1];
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  const report = collect();
  const failures = validate(report);
  report.validation = {passed: failures.length === 0, failures};
  const path = outputPath();
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Linux x64 preflight passed. Artifact: ${path}`);
  }
}
