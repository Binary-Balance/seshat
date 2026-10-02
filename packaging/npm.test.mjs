import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {assertArchiveExecutable, normalizeLauncherMode, packNpm, runNpm} from './npm.mjs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tarCommand = process.platform === 'win32' ? 'tar.exe' : 'tar';

test('npm packing preserves literal paths and ignores ambient npm settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'seshat npm & %SESHAT_NPM_PATH%=test-'));
  const stage = join(root, 'package & %SESHAT_NPM_PATH%=literal');
  const output = join(root, 'output & %SESHAT_NPM_PATH%=literal');
  mkdirSync(stage); mkdirSync(output);
  const fakeManager = join(root, 'other-manager', 'bin');
  mkdirSync(fakeManager, {recursive:true});
  writeFileSync(join(fakeManager, '../package.json'), '{"name":"pnpm"}');
  writeFileSync(join(fakeManager, 'npm-cli.js'), 'throw Error("other package manager was executed");');
  const ambient = {
    npm_execpath:join(fakeManager, 'npm-cli.js'),
    npm_config_dry_run:'true', NPM_CONFIG_JSON:'false',
    npm_config_cache:join(root, 'unwanted-cache'),
    npm_config_userconfig:join(root, 'user.npmrc'),
    npm_config_globalconfig:join(root, 'global.npmrc'),
    npm_config_registry:'https://invalid.example',
    SESHAT_NPM_PATH:'expanded',
  };
  const original = Object.fromEntries(Object.keys(ambient).map(key => [key, process.env[key]]));
  for (const path of ['user.npmrc', 'global.npmrc', '.npmrc']) {
    writeFileSync(join(root, path), 'dry-run=true\nignore-scripts=false\n');
  }
  writeFileSync(join(root, 'package.json'), '{"private":true}');
  writeFileSync(join(stage, 'package.json'), JSON.stringify({
    name:'seshat-pack-fixture', version:'1.0.0', files:['payload.txt'],
    scripts:{prepack:'node -e "process.exit(93)"', prepare:'node -e "process.exit(94)"'},
  }));
  writeFileSync(join(stage, 'payload.txt'), 'literal fixture bytes\n');
  try {
    Object.assign(process.env, ambient);
    assert.match(runNpm(['--version'], root).trim(), /^\d+\.\d+\.\d+$/);
    assert.equal(runNpm(['config', 'get', 'registry'], root).trim(), 'https://registry.npmjs.org/');
    const [packed] = JSON.parse(runNpm(['pack', stage, '--json', '--pack-destination', output], root));
    assert.equal(execFileSync(tarCommand, ['-xOf', join(output, packed.filename), 'package/payload.txt'],
      {encoding:'utf8'}), 'literal fixture bytes\n');
    assert.throws(() => assertArchiveExecutable(join(output, packed.filename), 'payload.txt'), /must have mode 0755/);
    assert.equal(existsSync(ambient.npm_config_cache), false);

    if (process.platform === 'win32') {
      // A synthetic npm identity checks dispatch through npm_execpath; real npm ran above.
      writeFileSync(join(fakeManager, '../package.json'), '{"name":"npm"}');
      writeFileSync(join(fakeManager, 'npm-cli.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
      process.env.npm_execpath = relative(process.cwd(), join(fakeManager, 'npm-cli.js'));
      const args = JSON.parse(runNpm(['--version', 'literal &= %SESHAT_NPM_PATH%'], root));
      assert.deepEqual(args.slice(0, 2), ['--version', 'literal &= %SESHAT_NPM_PATH%']);
    }
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, {recursive:true, force:true});
  }
});

test('mistyped pack modes fail before tools or build setup', () => {
  for (const script of ['pack.mjs', 'repeat-pack.mjs']) {
    for (const argument of ['--native-widnows', '--unknown']) {
      const child = spawnSync(process.execPath, [join(repo, 'packaging', script), argument], {encoding:'utf8'});
      assert.ifError(child.error);
      assert.notEqual(child.status, 0);
      assert.match(child.stderr, /unknown pack mode:/);
    }
  }
});

test('a 0644 entry launcher is normalized without changing payloads or reporting stale archive metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'seshat-launcher-mode-'));
  try {
    const stage = join(root, 'stage'); mkdirSync(join(stage, 'bin'), {recursive:true});
    const launcher = 'bin/seshat.mjs';
    // Omit bin so npm produces 0644 on Linux too, reproducing Windows' missed-bin result.
    writeFileSync(join(stage, 'package.json'), JSON.stringify({name:'seshat-mode-fixture', version:'1.0.0', files:[launcher]}));
    writeFileSync(join(stage, launcher), '#!/usr/bin/env node\nprocess.exit(0);\n');
    const [original] = JSON.parse(runNpm(['pack', stage, '--json', '--pack-destination', root], root));
    const archive = join(root, original.filename);
    assert.throws(() => assertArchiveExecutable(archive, launcher), /must have mode 0755/);
    const before = gunzipSync(readFileSync(archive));
    const packed = packNpm(stage, root, launcher);
    assertArchiveExecutable(archive, launcher);
    const bytes = readFileSync(archive);
    const after = gunzipSync(bytes);
    const headerOffset = before.indexOf(Buffer.from('package/bin/seshat.mjs'));
    assert.ok(headerOffset >= 0 && headerOffset % 512 === 0);
    // The two header fields are the entire uncompressed change.
    for (const [start, end] of [[100, 108], [148, 156]]) {
      before.copy(after, headerOffset + start, headerOffset + start, headerOffset + end);
    }
    assert.deepEqual(after, before);
    assert.equal(packed.size, bytes.length);
    assert.equal(packed.shasum, createHash('sha1').update(bytes).digest('hex'));
    assert.equal(packed.integrity, `sha512-${createHash('sha512').update(bytes).digest('base64')}`);
    assert.equal(packed.files.find(file => file.path === launcher).mode, 0o755);
    assert.equal(packed.unpackedSize, original.unpackedSize);
    assert.equal(normalizeLauncherMode(archive), false);
    assert.deepEqual(readFileSync(archive), bytes, 'already executable archives retain their exact bytes');
  } finally { rmSync(root, {recursive:true, force:true}); }
});
