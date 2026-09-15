import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = {type: 'git', url: 'git+https://github.com/Binary-Balance/seshat.git'};
const packageDirectories = ['seshat', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'];
const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
const npmArgs = process.platform === 'win32'
  ? [process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')]
  : [];
const tarCommand = process.platform === 'win32' ? 'tar.exe' : 'tar';

test('all release package manifests retain repository metadata when packed', () => {
  const output = mkdtempSync(join(tmpdir(), 'seshat-package-metadata-'));
  try {
    execFileSync(process.execPath, [join(repo, 'packaging/release.mjs'),
      '--output', output, '--layout-only'], {cwd: repo, stdio: 'ignore'});
    for (const directory of packageDirectories) {
      const stage = join(output, directory);
      const manifest = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'));
      assert.deepEqual(manifest.repository, repository, `${directory}: staged metadata`);
      const [packed] = JSON.parse(execFileSync(npmCommand, [...npmArgs,
        'pack', stage, '--json', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
        '--update-notifier=false', '--pack-destination', output,
      ], {cwd: repo, encoding: 'utf8'}));
      const packedManifest = JSON.parse(execFileSync(tarCommand,
        ['-xOf', join(output, packed.filename), 'package/package.json'], {encoding: 'utf8'}));
      assert.deepEqual(packedManifest.repository, repository, `${directory}: packed metadata`);
    }
  } finally {
    rmSync(output, {recursive: true, force: true});
  }
});
