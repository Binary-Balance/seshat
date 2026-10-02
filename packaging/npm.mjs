import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {gunzipSync, gzipSync} from 'node:zlib';

export function assertArchiveExecutable(archive, path) {
  const tar = process.platform === 'win32' ? 'tar.exe' : 'tar';
  const entries = execFileSync(tar, ['-tvf', archive, `package/${path}`], {encoding:'utf8'})
    .trim().split(/\r?\n/);
  assert.equal(entries.length, 1, `expected one archive entry for ${path}`);
  assert.match(entries[0], /^-rwxr-xr-x[ \t]/, `${path} must have mode 0755 in ${archive}`);
}

// npm's nested-bin filter can miss this launcher, and Windows chmod cannot fix it.
export function normalizeLauncherMode(archive) {
  const tar = gunzipSync(readFileSync(archive));
  const field = (header, start, end) => header.subarray(start, end).toString('utf8').replace(/\0.*$/s, '').trim();
  let launcher;
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const sizeText = field(header, 124, 136);
    assert.match(sizeText, /^[0-7]+$/, 'npm tar entry must have an octal size');
    const size = parseInt(sizeText, 8);
    assert.ok(Number.isSafeInteger(size) && offset + 512 + size <= tar.length, 'npm tar entry is truncated');
    const name = [field(header, 345, 500), field(header, 0, 100)].filter(Boolean).join('/');
    if (name === 'package/bin/seshat.mjs') {
      assert.ok(!launcher, 'npm archive contains duplicate entry launchers');
      assert.ok(header[156] === 0 || header[156] === 48, 'npm entry launcher must be a regular file');
      const checksum = [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
      assert.equal(parseInt(field(header, 148, 156), 8), checksum, 'npm entry launcher checksum differs');
      launcher = header;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(launcher, 'npm archive is missing the entry launcher');
  const mode = parseInt(field(launcher, 100, 108), 8);
  if (mode === 0o755) return false;
  assert.equal(mode, 0o644, 'unexpected npm entry launcher mode');
  launcher.write('0000755\0', 100, 8, 'ascii');
  launcher.fill(32, 148, 156);
  const checksum = [...launcher].reduce((sum, byte) => sum + byte, 0);
  launcher.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  writeFileSync(archive, gzipSync(tar, {level:9}));
  return true;
}

export function packNpm(stage, destination, executable = null) {
  const pack = source => {
    const result = JSON.parse(runNpm(['pack', source, '--json', '--pack-destination', destination], destination));
    assert.equal(result.length, 1);
    return result[0];
  };
  let result = pack(stage);
  const archive = join(destination, result.filename);
  if (executable === 'bin/seshat.mjs' && normalizeLauncherMode(archive)) {
    // Packing a file preserves its bytes and lets npm report their final integrity and modes.
    result = pack(archive);
  }
  if (executable) assertArchiveExecutable(archive, executable);
  return result;
}

function windowsNpmCli() {
  for (const candidate of [process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')]) {
    if (!candidate || basename(candidate) !== 'npm-cli.js') continue;
    const cli = resolve(candidate);
    try {
      const manifest = JSON.parse(readFileSync(join(dirname(cli), '../package.json'), 'utf8'));
      if (manifest.name === 'npm' && statSync(cli).isFile()) return cli;
    } catch {
      // Another package manager or a missing npm_execpath uses the bundled npm fallback.
    }
  }
  throw new Error('npm CLI not found: use Node with bundled npm or npm_execpath pointing to npm/bin/npm-cli.js');
}

export function runNpm(args, work) {
  // A private prefix also prevents npm from reading a parent project's .npmrc.
  const directory = mkdtempSync(join(work, 'npm-'));
  const userConfig = join(directory, 'user.npmrc');
  const globalConfig = join(directory, 'global.npmrc');
  writeFileSync(userConfig, '');
  writeFileSync(globalConfig, '');
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^npm_config_/i.test(name)));
  const windows = process.platform === 'win32';
  return execFileSync(windows ? process.execPath : 'npm', [
    ...(windows ? [windowsNpmCli()] : []), ...args,
    '--prefix', directory, '--cache', join(directory, 'cache'),
    '--userconfig', userConfig, '--globalconfig', globalConfig,
    '--registry', 'https://registry.npmjs.org', '--offline', '--ignore-scripts',
    '--no-audit', '--no-fund', '--update-notifier=false',
  ], {cwd:directory, env, encoding:'utf8', maxBuffer:16 * 1024 * 1024,
    shell:false, stdio:['ignore', 'pipe', 'inherit']});
}
