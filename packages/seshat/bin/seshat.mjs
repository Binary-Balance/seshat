#!/usr/bin/env node

import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {constants} from 'node:os';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {basename, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const version = packageManifest.version;
const args = process.argv.slice(2);
// Match native argument errors: no -- separator or --flag=value syntax exists,
// and path values cannot start with --. A literal --json always requests JSON.
const jsonRequested = args.includes('--json');
const commands = new Set(['check', 'crap', 'mutate']);
const started = performance.now();

const targets = {
  'linux-x64-musl': {name: '@binary-balance/seshat-linux-x64-musl', executable: 'seshat'},
  'linux-arm64-musl': {name: '@binary-balance/seshat-linux-arm64-musl', executable: 'seshat'},
  'linux-x64': {name: '@binary-balance/seshat-linux-x64', executable: 'seshat'},
  'linux-arm64': {name: '@binary-balance/seshat-linux-arm64', executable: 'seshat'},
  'darwin-x64': {name: '@binary-balance/seshat-darwin-x64', executable: 'seshat'},
  'darwin-arm64': {name: '@binary-balance/seshat-darwin-arm64', executable: 'seshat'},
  'win32-x64': {name: '@binary-balance/seshat-win32-x64', executable: 'seshat.exe'},
};

function report(error) {
  return {
    schemaVersion: 1,
    toolVersion: version,
    command: commands.has(args[0]) ? args[0] : null,
    complete: false,
    cancelled: false,
    signal: null,
    scope: null,
    timings: {wallMs: performance.now() - started, captureMs: null, executionMs: null},
    quality: null,
    result: {complete: false, error},
  };
}

function fail(error) {
  if (jsonRequested) {
    process.stdout.write(`${JSON.stringify(report(error))}\n`);
  } else {
    process.stderr.write(`seshat: ${error}\n`);
  }
  process.exitCode = 2;
}

function targetForHost() {
  let key = `${process.platform}-${process.arch}`;
  if (!targets[key]) return {error: `unsupported platform ${process.platform}/${process.arch}`};
  if (process.platform === 'linux') {
    let report;
    try {
      report = process.report?.getReport?.();
    } catch (error) {
      return {error: `cannot determine Linux libc: process.report failed: ${error.message}`};
    }
    const glibc = report?.header?.glibcVersionRuntime;
    const musl = Array.isArray(report?.sharedObjects) &&
      report.sharedObjects.some(path => typeof path === 'string' && /\/ld-musl-[^/]+\.so\.1$/.test(path));
    if (typeof glibc === 'string' && glibc.length > 0) {
      if (musl) return {error: 'cannot determine Linux libc: conflicting glibc and musl evidence'};
    } else if (musl) {
      key += '-musl';
    } else {
      return {error: 'cannot determine Linux libc: process.report must identify glibc or a musl loader'};
    }
  }
  const target = targets[key];
  return {target, key};
}

function payloadExecutable(target) {
  let manifestPath;
  try {
    manifestPath = require.resolve(`${target.name}/package.json`);
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND') {
      throw new Error(`${target.name}@${version} is missing or was omitted for this platform`);
    }
    throw error;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== target.name) {
    throw new Error(`native payload name mismatch: expected ${target.name}, found ${manifest.name ?? 'unknown'}`);
  }
  if (manifest.version !== version) {
    throw new Error(`native payload version mismatch: expected ${version}, found ${manifest.version ?? 'unknown'}`);
  }
  const executable = join(dirname(manifestPath), 'bin', target.executable);
  if (!existsSync(executable) || !statSync(executable).isFile()) {
    throw new Error(`${target.name}@${version} has no ${basename(executable)} executable`);
  }
  return executable;
}

const host = targetForHost();
if (host.error) {
  fail(host.error);
} else {
  let executable;
  try {
    executable = payloadExecutable(host.target);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (executable) {
    let child;
    try {
      child = spawn(executable, args, {
        cwd: process.cwd(),
        env: {...process.env},
        shell: false,
        windowsHide: false,
        stdio: 'inherit',
      });
    } catch (error) {
      fail(`cannot start native payload: ${error.message}`);
    }
    if (child) {
      let spawnFailed = false;
      const forward = signal => {
        if (!spawnFailed && child.exitCode === null && child.signalCode === null) child.kill(signal);
      };
      // Windows delivers Ctrl+C/Break to the shared console. Forwarding SIGINT
      // with child.kill() force-terminates the native child before it can clean up.
      const preserveConsole = () => {};
      const interrupt = process.platform === 'win32' ? preserveConsole : forward;
      process.on('SIGINT', interrupt);
      process.on('SIGTERM', forward);
      if (process.platform === 'win32') process.on('SIGBREAK', preserveConsole);
      // Keep handlers until launcher exit: a second console/group signal can arrive
      // after child close and must not replace the child's already chosen exit code.
      child.once('error', error => {
        spawnFailed = true;
        fail(`cannot start native payload: ${error.message}`);
      });
      child.once('close', (code, signal) => {
        if (!spawnFailed) process.exitCode = signal ? 128 + (constants.signals[signal] ?? 1) : code ?? 1;
      });
    }
  }
}
