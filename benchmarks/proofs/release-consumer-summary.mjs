export const publicExampleNames = ['node', 'jest-expo', 'vitest', 'workspaces'];

export function validatePublicExamples(value, expectedCliKind, fail) {
  if (!value) {
    fail('public consumer examples result missing');
    return false;
  }
  if (value.schemaVersion !== 1 || value.validation?.passed !== true) {
    fail('public consumer examples validation failed');
  }
  if (value.cli?.kind !== expectedCliKind || !/^[\da-f]{64}$/i.test(value.cli?.sha256 ?? '') ||
      !Number.isInteger(value.cli?.bytes) || value.cli.bytes <= 0) {
    fail(`public consumer examples did not retain the ${expectedCliKind} route`);
  }
  if (JSON.stringify(Object.keys(value.examples ?? {}).sort()) !== JSON.stringify([...publicExampleNames].sort())) {
    fail('public consumer examples are incomplete');
  }
  for (const name of publicExampleNames) {
    const example = value.examples?.[name];
    if (!Array.isArray(example?.sourceFiles) || !example.sourceFiles.length ||
        !example.normal?.scope?.files || !example.normal?.result?.sources || !example.normal?.result?.mutation) {
      fail(`public consumer example evidence is incomplete: ${name}`);
    }
    if (example.workers?.one !== 1 || example.workers?.two !== 2 || example.workers?.parity !== true) {
      fail(`public consumer example worker parity is incomplete: ${name}`);
    }
  }
  const thresholds = value.thresholds;
  if (thresholds?.equality?.state !== 'passed' || thresholds?.failure?.state !== 'failed' ||
      thresholds?.incomplete?.state !== 'incomplete') {
    fail('public consumer threshold and exit evidence is incomplete');
  }
  return true;
}

export function validateReleaseArchives(value, artifacts, expectedNativeName, fail) {
  if (!value?.entryArchive || !value.nativeArchive) {
    fail('release npm archive identity is missing');
    return;
  }
  if (value.entryArchive.name !== '@binary-balance/seshat' ||
      value.entryArchive.version !== value.version ||
      value.nativeArchive.name !== expectedNativeName ||
      value.nativeArchive.version !== value.version) {
    fail('release npm archive package identity is invalid');
  }
  for (const [key, archive] of [['entry', value.entryArchive], ['releaseNative', value.nativeArchive]]) {
    const retained = artifacts?.[key];
    if (!retained) {
      fail(`retained release archive is missing: ${key}`);
      continue;
    }
    if (archive.sha256 !== retained.sha256 || archive.bytes !== retained.bytes) {
      fail(`release npm ${key} archive differs from retained artifact`);
    }
  }
}
