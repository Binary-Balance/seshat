#!/usr/bin/env node

import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {basename, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const version = packageManifest.version;
const args = process.argv.slice(2);
const jsonRequested = args.includes('--json');
const commands = new Set(['check', 'crap', 'mutate']);
const started = performance.now();

const targets = {
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
  const key = `${process.platform}-${process.arch}`;
  const target = targets[key];
  if (!target) return {error: `unsupported platform ${process.platform}/${process.arch}`};
  if (process.platform === 'linux') {
    let glibc;
    try {
      glibc = process.report?.getReport?.().header?.glibcVersionRuntime;
    } catch {
      glibc = undefined;
    }
    if (!glibc) return {error: `unsupported platform ${key}: glibc is required`};
  }
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

function signalNumber(signal) {
  return {SIGINT: 2, SIGTERM: 15}[signal] ?? 1;
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
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env: {...process.env},
      shell: false,
      windowsHide: false,
      stdio: 'inherit',
    });
    let spawnFailed = false;
    const forward = signal => {
      if (child.exitCode === null) child.kill(signal);
    };
    // A CTRL_BREAK_EVENT is broadcast to the console process group. Keep the
    // launcher alive on Windows so the native child can handle that event and
    // return its cancellation report through inherited stdio.
    const preserveConsole = () => {};
    process.on('SIGINT', forward);
    process.on('SIGTERM', forward);
    if (process.platform === 'win32') process.on('SIGBREAK', preserveConsole);
    const cleanup = () => {
      process.removeListener('SIGINT', forward);
      process.removeListener('SIGTERM', forward);
      if (process.platform === 'win32') process.removeListener('SIGBREAK', preserveConsole);
    };
    child.once('error', error => {
      spawnFailed = true;
      cleanup();
      fail(`cannot start native payload: ${error.message}`);
    });
    child.once('close', (code, signal) => {
      cleanup();
      if (!spawnFailed) process.exitCode = signal ? 128 + signalNumber(signal) : code ?? 1;
    });
  }
}
