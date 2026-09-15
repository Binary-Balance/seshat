import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = {type: 'git', url: 'git+https://github.com/Binary-Balance/seshat.git'};
const entryDescription = 'A native CLI for TypeScript and TSX complexity analysis and mutation testing.';
const packageDirectories = ['seshat', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'];
const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
const npmArgs = process.platform === 'win32'
  ? [process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')]
  : [];
const tarCommand = process.platform === 'win32' ? 'tar.exe' : 'tar';

test('all release package metadata and README content survive packing', () => {
  const output = mkdtempSync(join(tmpdir(), 'seshat-package-metadata-'));
  try {
    execFileSync(process.execPath, [join(repo, 'packaging/release.mjs'),
      '--output', output, '--layout-only'], {cwd: repo, stdio: 'ignore'});
    for (const directory of packageDirectories) {
      const stage = join(output, directory);
      const manifest = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'));
      assert.deepEqual(manifest.repository, repository, `${directory}: staged metadata`);
      const expectedDescription = directory === 'seshat'
        ? entryDescription
        : `Native Seshat payload for ${directory}`;
      assert.equal(manifest.description, expectedDescription, `${directory}: staged description`);
      const stagedReadme = readFileSync(join(stage, 'README.md'), 'utf8');
      if (directory === 'seshat') {
        const normalizedReadme = stagedReadme.replace(/\s+/g, ' ');
        for (const fragment of [
          'Seshat is a native CLI for TypeScript and TSX complexity analysis and mutation testing.',
          'The package declares and verifies Node.js 24.20.0 exactly',
          'npm install --save-dev @binary-balance/seshat',
          'seshat mutate --config ./seshat.json',
          'Linux x64 (glibc; Debian 11 userspace, glibc 2.31)',
          'Linux ARM64 (glibc; Ubuntu 22.04, glibc 2.35)',
          'macOS x64 (macOS 15.0 minimum)',
          'macOS ARM64 (macOS 15.0 minimum)',
          'Windows x64 (Windows Server 2022 verification)',
          'full configuration guide',
          'JSON report format',
          'native platform support matrix',
        ]) assert.ok(normalizedReadme.includes(fragment), `${directory}: README is missing ${fragment}`);
      } else {
        assert.equal(stagedReadme,
          `# Seshat native payload\n\nTarget: ${directory}.\nConsumers normally install \`@binary-balance/seshat\`, which selects this payload for matching hosts.\n`,
          `${directory}: README content`);
      }
      const [packed] = JSON.parse(execFileSync(npmCommand, [...npmArgs,
        'pack', stage, '--json', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
        '--update-notifier=false', '--pack-destination', output,
      ], {cwd: repo, encoding: 'utf8'}));
      const packedManifest = JSON.parse(execFileSync(tarCommand,
        ['-xOf', join(output, packed.filename), 'package/package.json'], {encoding: 'utf8'}));
      assert.deepEqual(packedManifest.repository, repository, `${directory}: packed metadata`);
      assert.equal(packedManifest.description, expectedDescription, `${directory}: packed description`);
      const packedReadme = execFileSync(tarCommand,
        ['-xOf', join(output, packed.filename), 'package/README.md'], {encoding: 'utf8'});
      assert.equal(packedReadme, stagedReadme, `${directory}: packed README content`);
    }
  } finally {
    rmSync(output, {recursive: true, force: true});
  }
});
