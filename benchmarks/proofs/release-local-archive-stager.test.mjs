import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync, readdirSync} from 'node:fs';
import {validateManifest as validatePublicationManifest} from './npm-publishing.mjs';
import {
  assertSourceTreeEquivalence,
  validateSourceTrees,
  validateManifest,
} from './release-local-archive-stager.mjs';

import {releasePackages} from './release-targets.mjs';

const sourceTrees = {
  crates: '69eabd0b41f8d9ae7f708f37e93f1e8e92b13829',
  packages: '9fde34a86e1795b9be2dcb619e7fb9a8e9701e9d',
  packaging: '7cdef2cec782f7aa717790ca5ef2999688a0ec4d',
};

test('rejects a mismatch in every bound source tree', () => {
  for (const path of Object.keys(sourceTrees)) {
    const checkoutTrees = {...sourceTrees, [path]: 'f'.repeat(40)};
    assert.throws(() => assertSourceTreeEquivalence(sourceTrees, checkoutTrees),
      new RegExp(`candidate source trees differ from checkout: ${path}`));
  }
});

test('rejects malformed source-tree fields', () => {
  assert.throws(() => validateSourceTrees({...sourceTrees, crates: 'short'}),
    /candidate source trees\.crates must be a full Git tree SHA/);
  assert.throws(() => validateSourceTrees({...sourceTrees, extra: 'a'.repeat(40)}),
    /candidate source trees must contain exactly crates, packages, packaging/);
});

test('accepts matching trees from a later checkout', () => {
  assert.deepEqual(assertSourceTreeEquivalence(sourceTrees, {...sourceTrees}), []);
});

test('staging requires the complete version-specific release set', () => {
  const fixture = version => ({schemaVersion:1, kind:'seshat-release-notice-audit',
    candidate:{packageVersion:version, sourceCommit:'b'.repeat(40)},
    coordinates:releasePackages(version).map(target => ({
      ...target, version, canonical:true, archivePath:target.target === 'universal' ? 'seshat-entry.tgz' : `seshat-${target.target}-release.tgz`,
      archiveFile:target.target === 'universal' ? 'seshat-entry.tgz' : `seshat-${target.target}-release.tgz`,
      runId:1, artifactName:'fixture', archiveBytes:1, archiveSha256:'a'.repeat(64),
      buildProvenance:{sourceCommit:'b'.repeat(40)},
    })),
  });
  for (const version of ['0.18.0', '0.19.0-rc.1', '0.19.0']) {
    const complete = fixture(version);
    assert.equal(validateManifest(complete).coordinates.length, version === '0.18.0' ? 6 : 8);
    for (const missing of [['linux-x64-musl'], ['linux-arm64-musl'], ['linux-x64-musl', 'linux-arm64-musl']]) {
      if (version === '0.18.0') continue;
      const audit = fixture(version);
      audit.coordinates = audit.coordinates.filter(row => !missing.includes(row.target));
      assert.throws(() => validateManifest(audit), /must contain 8 coordinates/);
    }
  }
  for (const mutate of [
    audit => { audit.coordinates[6] = audit.coordinates[5]; },
    audit => { audit.coordinates[6].version = '0.18.0'; },
    audit => { audit.coordinates[6].buildProvenance.sourceCommit = 'c'.repeat(40); },
    audit => { audit.candidate.packageVersion = '0.18.0'; },
  ]) {
    const audit = fixture('0.19.0'); mutate(audit);
    assert.throws(() => validateManifest(audit), /duplicate release target|version differs|source commit differs|must contain 6 coordinates/);
  }
});

test('all committed complete six-package audits remain readable', () => {
  const files = ['docs/research/release-notice-audit.json', ...readdirSync('docs/releases')
    .filter(name => name.endsWith('-audit.json')).map(name => `docs/releases/${name}`)];
  let checked = 0;
  for (const path of files) {
    const audit = JSON.parse(readFileSync(path));
    if (audit.coordinates?.length !== 6) continue;
    assert.doesNotThrow(() => validateManifest(audit), path);
    assert.doesNotThrow(() => validatePublicationManifest(audit, audit.candidate.packageVersion), path);
    checked++;
  }
  assert.ok(checked >= 23);
});
