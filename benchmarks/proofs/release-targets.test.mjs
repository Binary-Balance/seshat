import assert from 'node:assert/strict';
import test from 'node:test';
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
