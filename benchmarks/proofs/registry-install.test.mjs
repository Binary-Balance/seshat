import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TARGETS,
  auditVersion,
  validateBinaryIdentity,
  validateRegistryArchive,
  validateAttestations,
  validateHost,
  validateNativePackages,
} from './registry-install.mjs';

test('uses the audit version for subsequent releases and rejects invalid versions', () => {
  for (const version of ['0.3.0', '0.4.0-rc.1']) {
    assert.equal(auditVersion({candidate: {packageVersion: version}}), version);
  }
  assert.throws(() => auditVersion({}), /audit package version is missing/);
  assert.throws(() => auditVersion({candidate: {packageVersion: '0.3'}}), /not valid semver/);
});

test('rejects a registry target on the wrong host', () => {
  assert.throws(
    () => validateHost('linux-x64', {platform: 'darwin', arch: 'x64'}),
    /host does not match linux-x64/,
  );
});

test('rejects an omitted or extra native package', () => {
  const expected = TARGETS.get('linux-x64').package;
  assert.throws(() => validateNativePackages([], expected), /select only/);
  assert.throws(() => validateNativePackages([
    expected,
    TARGETS.get('darwin-x64').package,
  ], expected), /select only/);
});

test('rejects binary size or hash drift from the audit', () => {
  const coordinate = {target: 'linux-x64', buildProvenance: {binary: {bytes: 10, sha256: 'a'.repeat(64)}}};
  assert.throws(
    () => validateBinaryIdentity({bytes: 11, sha256: 'a'.repeat(64)}, coordinate),
    /installed binary size differs from audit/,
  );
  assert.throws(
    () => validateBinaryIdentity({bytes: 10, sha256: 'b'.repeat(64)}, coordinate),
    /installed binary hash differs from audit/,
  );
});

test('rejects missing or mismatched package attestations', () => {
  const expected = [
    {name: '@binary-balance/seshat', version: '0.2.0'},
    {name: '@binary-balance/seshat-linux-x64', version: '0.2.0'},
  ];
  const verified = expected.map(value => ({
    ...value,
    attestations: {url: 'https://registry.npmjs.org/-/npm/v1/attestations'},
    attestationBundles: [{predicateType: 'https://slsa.dev/provenance/v1', bundle: {}}],
  }));
  assert.throws(
    () => validateAttestations({invalid: [], missing: [], verified: verified.slice(1)}, expected),
    /verified attestation is missing for @binary-balance\/seshat@0\.2\.0/,
  );
  assert.throws(
    () => validateAttestations({invalid: [], missing: [], verified: [
      {...verified[0], version: '0.2.0-rc.1'}, verified[1],
    ]}, expected),
    /verified attestation is missing for @binary-balance\/seshat@0\.2\.0/,
  );
  assert.throws(
    () => validateAttestations({invalid: [], missing: [], verified: expected.map(value => ({
      ...value,
      attestations: {url: 'https://registry.npmjs.org/-/npm/v1/attestations'},
      attestationBundles: [{predicateType: 'https://slsa.dev/dependencies/v1', bundle: {}}],
    }))}, expected),
    /verified SLSA provenance bundle is missing for @binary-balance\/seshat@0\.2\.0/,
  );
});

test('checks Linux libc separately from OS and CPU', () => {
  assert.equal(validateHost('linux-x64-musl', {platform:'linux', arch:'x64', libc:'musl'}).libc, 'musl');
  assert.equal(validateHost('linux-arm64-musl', {platform:'linux', arch:'arm64', libc:'musl'}).arch, 'arm64');
  assert.throws(() => validateHost('linux-x64-musl', {platform:'linux', arch:'x64', libc:'glibc'}), /host libc does not match/);
  assert.throws(() => validateHost('linux-arm64', {platform:'linux', arch:'arm64', libc:'musl'}), /host libc does not match/);
  assert.throws(() => validateNativePackages([
    TARGETS.get('linux-x64').package, TARGETS.get('linux-x64-musl').package,
  ], TARGETS.get('linux-x64-musl').package), /select only/);
});

test('registry archives must match the audit before installation', () => {
  const coordinate = {target:'linux-x64-musl', archiveBytes:10, archiveSha256:'a'.repeat(64)};
  const exact = {status:'present', bytes:10, sha256:'a'.repeat(64)};
  assert.doesNotThrow(() => validateRegistryArchive(exact, coordinate));
  assert.throws(() => validateRegistryArchive({...exact, status:'absent'}, coordinate), /registry archive unavailable/);
  assert.throws(() => validateRegistryArchive({...exact, bytes:11}, coordinate), /size differs from audit/);
  assert.throws(() => validateRegistryArchive({...exact, sha256:'b'.repeat(64)}, coordinate), /hash differs from audit/);
});
