import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import * as fs from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {performance} from 'node:perf_hooks';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';

const source = fs.readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'diagnostics-overhead.mjs'), 'utf8');
// Exercise the real installer and its helpers without starting the benchmark matrix.
const installerSource = source.slice(source.indexOf('function json('), source.indexOf('\nfunction copyDirectory('));
assert.match(installerSource, /function installTarball\(/);

for (const nativeOnly of [true, false]) {
  test(`installs a ${nativeOnly ? 'native-only' : 'combined'} archive and records its package`, {
    skip: process.platform === 'win32' && 'fixture executable requires a Unix shebang',
  }, t => {
    const root = fs.mkdtempSync(join(tmpdir(), 'seshat-diagnostics-install-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const stage = join(root, 'package');
    fs.mkdirSync(join(stage, 'bin'), {recursive: true});
    const name = nativeOnly ? `@binary-balance/seshat-${process.platform}-${process.arch}` : '@binary-balance/seshat';
    const manifest = {
      name, version: '0.0.0-fixture', os: [process.platform], cpu: [process.arch],
      ...(nativeOnly ? {} : {bin: {seshat: 'bin/seshat'}}),
    };
    fs.writeFileSync(join(stage, 'package.json'), JSON.stringify(manifest));
    const buildMetadata = {package: name, dependencies: [{name: 'fixture', version: '1.0.0'}]};
    fs.writeFileSync(join(stage, 'BUILD.json'), JSON.stringify(buildMetadata));
    const executableBytes = '#!/usr/bin/env node\nconsole.log("seshat 0.0.0-fixture");\n';
    fs.writeFileSync(join(stage, 'bin/seshat'), executableBytes, {mode: 0o755});
    const tarball = join(root, 'fixture.tgz');
    execFileSync('tar', ['-czf', tarball, '-C', root, 'package']);

    const work = join(root, 'work');
    const installTarball = runInNewContext(`${installerSource}\ninstallTarball;`, {
      assert, Buffer, createHash, ...fs, spawnSync, dirname, join, performance, process,
      work, repo: root, jestDeps: null, timeoutMs: 10000,
    });
    const installed = installTarball('baseline', tarball);
    const consumer = join(installed.root, 'consumer');
    assert.equal(fs.existsSync(join(consumer, 'node_modules/@binary-balance/seshat')), !nativeOnly);
    assert.equal(fs.existsSync(join(consumer, 'node_modules/.bin/seshat')), !nativeOnly);
    assert.equal(installed.executable, fs.realpathSync(join(consumer, 'node_modules', name, 'bin/seshat')));
    assert.equal(installed.artifact.version, 'seshat 0.0.0-fixture');
    assert.deepEqual(JSON.parse(JSON.stringify(installed.artifact.package)), manifest);
    assert.deepEqual(JSON.parse(JSON.stringify(installed.artifact.buildMetadata.metadata)), buildMetadata);
    assert.equal(installed.artifact.buildMetadata.cargoDependencies.count, 1);
    assert.equal(installed.artifact.installedBinary.sha256,
      createHash('sha256').update(executableBytes).digest('hex'));
  });
}
