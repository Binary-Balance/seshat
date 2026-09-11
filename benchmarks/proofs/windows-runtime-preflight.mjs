import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {basename, dirname, join} from 'node:path';
import {arch, release, tmpdir, version} from 'node:os';

const expected = {
  node: 'v24.20.0',
  architecture: 'x64',
  runnerOs: 'Windows',
  kernelBuild: 20348,
  rustVersion: '1.98.1',
  rustHost: 'x86_64-pc-windows-msvc',
};

function firstLine(value) {
  return String(value ?? '').trim().split(/\r?\n/, 1)[0] || null;
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

function rustInfo() {
  const rustc = probe('rustc');
  const details = rustc.available ? probe('rustc', ['-vV']) : null;
  const release = details?.text?.match(/^rustc\s+(\S+)/)?.[1] ?? null;
  const host = details?.text?.match(/^host:\s*(.+)$/m)?.[1] ?? null;
  return {
    rustc: publicProbe(rustc),
    cargo: publicProbe(probe('cargo')),
    version: release,
    host,
  };
}

function sourceCommit() {
  const result = probe('git', ['rev-parse', 'HEAD']);
  return result.available ? result.version : null;
}

function kernelBuild() {
  const text = `${release()} ${version()}`;
  return Number(text.match(/\b10\.0\.(\d+)\b/)?.[1] ?? NaN);
}

function commandPrerequisites() {
  const comspec = process.env.ComSpec ?? process.env.COMSPEC ?? null;
  const commandShell = comspec && basename(comspec).toLowerCase() === 'cmd.exe' && existsSync(comspec);
  const cmd = probe(comspec ?? 'cmd.exe', ['/d', '/c', 'ver']);
  // npm is installed as a .cmd shim on the hosted Windows image. Spawn its
  // JavaScript entry point through node so this probe does not depend on shell
  // dispatch rules.
  const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const npm = probe(process.execPath, [npmCli, '--version']);
  return {
    commandShell: {
      available: Boolean(commandShell) && cmd.available,
      executable: commandShell ? 'cmd.exe' : null,
      version: cmd.version,
    },
    node: publicProbe(probe('node')),
    npm: publicProbe(npm),
    rustc: publicProbe(probe('rustc')),
    cargo: publicProbe(probe('cargo')),
  };
}

function linkPrerequisites() {
  const directory = mkdtempSync(join(tmpdir(), 'seshat-windows-link-'));
  const targetFile = join(directory, 'target.txt');
  const targetDirectory = join(directory, 'target-dir');
  const fileLink = join(directory, 'file-link.txt');
  const directoryLink = join(directory, 'directory-link');
  writeFileSync(targetFile, 'ok\n');
  // A junction is the link form npm uses for workspace packages on Windows.
  const result = {symbolicLink: false, junction: false, errors: []};
  try {
    try {
      symlinkSync(targetFile, fileLink, 'file');
      result.symbolicLink = readlinkSync(fileLink) === targetFile;
    } catch (error) {
      result.errors.push(`symbolic-link:${error.code ?? error.name}`);
    }
    try {
      // mkdir is intentionally done through the native fs API, not a copy fallback.
      mkdirSync(targetDirectory);
      symlinkSync(targetDirectory, directoryLink, 'junction');
      result.junction = statSync(directoryLink).isDirectory();
    } catch (error) {
      result.errors.push(`junction:${error.code ?? error.name}`);
    }
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
  return result;
}

function collect() {
  const rust = rustInfo();
  const runnerImage = {
    label: 'windows-2022',
    os: process.env.RUNNER_OS ?? null,
    architecture: process.env.RUNNER_ARCH ?? null,
    name: process.env.RUNNER_NAME ?? null,
    imageOS: process.env.ImageOS ?? null,
    imageVersion: process.env.ImageVersion ?? null,
  };
  return {
    schemaVersion: 1,
    kind: 'seshat-windows-runtime-preflight',
    capturedAt: new Date().toISOString(),
    candidate: {
      runner: 'windows-2022',
      userspace: 'Windows Server 2022 / kernel build 20348',
      node: '24.20.0',
      rust: '1.98.1 / x86_64-pc-windows-msvc',
    },
    environment: {
      platform: process.platform,
      os: {release: release(), version: version(), kernelBuild: kernelBuild()},
      architecture: {
        node: process.arch,
        os: arch(),
        processor: process.env.PROCESSOR_ARCHITECTURE ?? null,
      },
      node: {version: process.version},
      toolchain: {rust, commands: commandPrerequisites()},
      links: linkPrerequisites(),
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
  const runner = environment.runnerImage;
  if (environment.platform !== 'win32') {
    failures.push(`OS: expected Windows, got ${environment.platform ?? 'unknown'}`);
  }
  if (environment.architecture.node !== expected.architecture || environment.architecture.os !== expected.architecture) {
    failures.push(`architecture: expected x64, got node=${environment.architecture.node ?? 'unknown'}, os=${environment.architecture.os ?? 'unknown'}`);
  }
  if (environment.os.kernelBuild !== expected.kernelBuild) {
    failures.push(`kernel build: expected ${expected.kernelBuild}, got ${environment.os.kernelBuild || 'unknown'}`);
  }
  if (runner.label !== 'windows-2022' || runner.os !== expected.runnerOs) {
    failures.push(`runner: expected Windows windows-2022, got ${runner.os ?? 'unknown'} / ${runner.label}`);
  }
  if (environment.node.version !== expected.node) {
    failures.push(`Node: expected ${expected.node}, got ${environment.node.version ?? 'unknown'}`);
  }
  const rust = environment.toolchain.rust;
  if (!rust.rustc.available || !rust.cargo.available || rust.version !== expected.rustVersion) {
    failures.push(`Rust: expected rustc/cargo ${expected.rustVersion}`);
  }
  if (rust.host !== expected.rustHost) {
    failures.push(`Rust host: expected ${expected.rustHost}, got ${rust.host ?? 'unknown'}`);
  }
  const commands = environment.toolchain.commands;
  for (const [name, result] of Object.entries(commands)) {
    if (!result.available) failures.push(`prerequisite: ${name} is unavailable`);
  }
  if (!environment.links.symbolicLink) failures.push('prerequisite: native symbolic links are unavailable');
  if (!environment.links.junction) failures.push('prerequisite: Windows junctions are unavailable');
  return failures;
}

function selfCheck() {
  const passing = {
    environment: {
      platform: 'win32',
      os: {kernelBuild: 20348},
      architecture: {node: 'x64', os: 'x64'},
      node: {version: 'v24.20.0'},
      toolchain: {
        rust: {rustc: {available: true}, cargo: {available: true}, version: '1.98.1', host: 'x86_64-pc-windows-msvc'},
        commands: {
          commandShell: {available: true}, node: {available: true}, npm: {available: true},
          rustc: {available: true}, cargo: {available: true},
        },
      },
      links: {symbolicLink: true, junction: true},
      runnerImage: {label: 'windows-2022', os: 'Windows'},
    },
  };
  assert.deepEqual(validate(passing), []);
  for (const [change, expectedMessage] of [
    [report => { report.environment.platform = 'linux'; }, 'expected Windows'],
    [report => { report.environment.architecture.node = 'arm64'; }, 'architecture'],
    [report => { report.environment.os.kernelBuild = 19041; }, 'kernel build'],
    [report => { report.environment.node.version = 'v22.0.0'; }, 'Node'],
    [report => { report.environment.toolchain.rust.host = 'x86_64-unknown-linux-gnu'; }, 'Rust host'],
    [report => { report.environment.links.junction = false; }, 'junction'],
  ]) {
    const report = structuredClone(passing);
    change(report);
    assert.match(validate(report).join('\n'), new RegExp(expectedMessage.replace(/[().]/g, '\\$&')));
  }
  console.log('Windows runtime preflight self-check passed');
}

function outputPath() {
  const index = process.argv.indexOf('--output');
  if (index < 0) return 'windows-runtime-preflight.json';
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
    console.log(`Windows runtime preflight passed. Artifact: ${path}`);
  }
}
