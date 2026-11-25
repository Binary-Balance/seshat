import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {PACKAGE_ORDER, entryPackages, hostLibc, releasePackages} from './release-targets.mjs';

test('source experiments remain separate from approved publication sets', () => {
  const manifest = (version, packages) => ({version, optionalDependencies:Object.fromEntries(packages
    .filter(row => row.role === 'native-release').map(row => [row.package, version]))});
  const legacy = manifest('0.18.0', releasePackages('0.18.0'));
  const experiment = manifest('0.18.0', PACKAGE_ORDER);
  assert.equal(entryPackages(legacy).length, 6);
  assert.equal(entryPackages(experiment).length, 8);
  assert.equal(releasePackages(experiment.version).length, 6);
  assert.equal(entryPackages(manifest('0.19.0-rc.1', PACKAGE_ORDER)).length, 8);
  assert.throws(() => entryPackages({...legacy, version:'0.19.0'}), /entry optional dependency/);
  delete experiment.optionalDependencies['@binary-balance/seshat-linux-arm64-musl'];
  assert.throws(() => entryPackages(experiment), /entry optional dependency/);
});

test('libc detection rejects missing and conflicting evidence', () => {
  const glibc = {header:{glibcVersionRuntime:'2.35'}, sharedObjects:[]};
  const musl = {header:{}, sharedObjects:['/lib/ld-musl-aarch64.so.1']};
  assert.equal(hostLibc(glibc), 'glibc');
  assert.equal(hostLibc(musl), 'musl');
  assert.throws(() => hostLibc({header:{}, sharedObjects:[]}), /exactly one/);
  assert.throws(() => hostLibc({...glibc, sharedObjects:musl.sharedObjects}), /exactly one/);
});


test('example archive inspection keeps drive-letter paths out of tar arguments', () => {
  const root = mkdtempSync(join(tmpdir(), 'seshat-archive-path-'));
  try {
    const archives = join(root, 'D: archive fixture');
    mkdirSync(archives);
    writeFileSync(join(archives, 'entry.tgz'), 'manifest extraction is mocked');
    const manifest = {name:'@binary-balance/seshat', version:'0.19.0',
      optionalDependencies:Object.fromEntries(releasePackages('0.19.0')
        .filter(target => target.role === 'native-release').map(target => [target.package, '0.19.0']))};
    const preload = join(root, 'mock-tar.mjs');
    writeFileSync(preload, `
      import childProcess from 'node:child_process';
      import {syncBuiltinESMExports} from 'node:module';
      import assert from 'node:assert/strict';
      childProcess.spawnSync = (command, args, options) => {
        assert.match(command, /^tar(?:\\.exe)?$/);
        if (args[1].includes(':')) return {status:128, stderr:'tar: Cannot connect to D: resolve failed'};
        assert.equal(options.cwd, ${JSON.stringify(archives)});
        assert.deepEqual(args, ['-xOf', 'entry.tgz', 'package/package.json']);
        return {status:0, stdout:${JSON.stringify(JSON.stringify(manifest))}};
      };
      syncBuiltinESMExports();
    `);
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href,
      fileURLToPath(new URL('../../examples/verify.mjs', import.meta.url)), '--archives', archives], {encoding:'utf8'});
    assert.equal(result.status, 1);
    // Manifest extraction succeeds; the next guard still rejects missing native archives.
    assert.match(result.stderr, /archive directory must contain exactly/);
    assert.doesNotMatch(result.stderr, /Cannot connect to D/);
  } finally { rmSync(root, {recursive:true, force:true}); }
});
