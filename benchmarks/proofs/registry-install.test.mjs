import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TARGETS,
  validateBinaryIdentity,
  validateAttestations,
  validateHost,
  validateNativePackages,
} from './registry-install.mjs';

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
    {name: '@binary-balance/seshat', version: '0.1.0'},
    {name: '@binary-balance/seshat-linux-x64', version: '0.1.0'},
  ];
  const verified = expected.map(value => ({
    ...value,
    attestations: {url: 'https://registry.npmjs.org/-/npm/v1/attestations'},
    attestationBundles: [{predicateType: 'https://slsa.dev/provenance/v1', bundle: {}}],
  }));
  assert.throws(
    () => validateAttestations({invalid: [], missing: [], verified: verified.slice(1)}, expected),
    /verified attestation is missing for @binary-balance\/seshat@0\.1\.0/,
  );
  assert.throws(
    () => validateAttestations({invalid: [], missing: [], verified: [
      {...verified[0], version: '0.1.0-rc.1'}, verified[1],
    ]}, expected),
    /verified attestation is missing for @binary-balance\/seshat@0\.1\.0/,
  );
  assert.throws(
    () => validateAttestations({invalid: [], missing: [], verified: expected.map(value => ({
      ...value,
      attestations: {url: 'https://registry.npmjs.org/-/npm/v1/attestations'},
      attestationBundles: [{predicateType: 'https://slsa.dev/dependencies/v1', bundle: {}}],
    }))}, expected),
    /verified SLSA provenance bundle is missing for @binary-balance\/seshat@0\.1\.0/,
  );
});
