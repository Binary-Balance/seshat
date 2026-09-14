import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, rmSync, writeFileSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {
  PACKAGE_ORDER,
  REGISTRY,
  buildPublicationPlan,
  executePublication,
  expectedTag,
  inspectRegistry,
  publishArgs,
  registryDecision,
} from './npm-publishing.mjs';

const revision = 'a'.repeat(40);
const sourceCommit = 'b'.repeat(40);
const version = '0.1.0-rc.1';
const temporaryDirectories = [];

function hash(data) {
  return createHash('sha256').update(data).digest('hex');
}

function fixture() {
  const archiveDir = mkdtempSync(join(tmpdir(), 'seshat-npm-publishing-'));
  temporaryDirectories.push(archiveDir);
  const coordinates = PACKAGE_ORDER.map(target => {
    const data = Buffer.from(`verified:${target.target}`);
    writeFileSync(join(archiveDir, target.file), data);
    return {
      target: target.target,
      role: target.role,
      canonical: true,
      package: target.package,
      version,
      archivePath: target.target === 'universal'
        ? 'seshat-entry.tgz' : `seshat-${target.target}-release.tgz`,
      archiveFile: target.target === 'universal'
        ? 'seshat-entry.tgz' : `seshat-${target.target}-release.tgz`,
      archiveBytes: data.length,
      archiveSha256: hash(data),
    };
  });
  return {
    archiveDir,
    manifest: {
      schemaVersion: 1,
      kind: 'seshat-release-notice-audit',
      candidate: {packageVersion: version, sourceCommit},
      coordinates,
    },
  };
}

function planWith(fixtureValue, options = {}) {
  return buildPublicationPlan(fixtureValue.manifest, {
    archiveDir: fixtureValue.archiveDir,
    revision,
    version,
    ...options,
  });
}

function exact(archive) {
  return {status: 'present', bytes: archive.bytes, sha256: archive.sha256, data: archive.data};
}

test.afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop(), {recursive: true, force: true});
});

test('plans the native-first order and version tag', () => {
  const value = fixture();
  const plan = planWith(value);
  assert.deepEqual(plan.archives.map(archive => archive.target), [
    'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64', 'universal',
  ]);
  assert.equal(expectedTag(version), 'next');
  assert.equal(expectedTag('0.1.0'), 'latest');
  assert.deepEqual(publishArgs(plan.archives[0], {tag: plan.tag, dryRun: true}).slice(1), [
    '--access=public',
    '--tag=next',
    `--registry=${REGISTRY}`,
    `--@binary-balance:registry=${REGISTRY}`,
    '--dry-run',
  ]);
});

test('requires the complete audit archive set and matching staging evidence', () => {
  const value = fixture();
  const initial = planWith(value);
  const evidence = {
    kind: 'seshat-release-local-archive-staging',
    candidate: {packageVersion: version, sourceCommit},
    sourceEquivalence: {
      candidateCommit: sourceCommit,
      checkoutCommit: revision,
      paths: ['crates', 'packages', 'packaging'],
    },
    archives: initial.archives.map(archive => ({
      target: archive.target,
      file: archive.file,
      bytes: archive.bytes,
      sha256: archive.sha256,
    })),
    validation: {passed: true},
  };
  assert.equal(planWith(value, {stagingEvidence: evidence}).archives.length, 6);
  unlinkSync(join(value.archiveDir, 'linux-x64.tgz'));
  assert.throws(() => planWith(value), /exactly the six canonical archives/);
});

test('dry-run gates publication and reports every exact command', async () => {
  const value = fixture();
  const plan = planWith(value);
  let inspected = false;
  let published = false;
  const result = await executePublication(plan, {
    inspect: async () => {
      inspected = true;
      return {status: 'absent'};
    },
    publishPackage: async () => {
      published = true;
    },
  });
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.packages.length, 6);
  assert.equal(inspected, false);
  assert.equal(published, false);
  assert.equal(result.packages.at(-1).argv.at(-1), '--dry-run');
});

test('preflight detects a conflict before any npm write', async () => {
  const value = fixture();
  const plan = planWith(value);
  let published = 0;
  const conflicting = {...plan.archives[1], bytes: plan.archives[1].bytes + 1};
  await assert.rejects(executePublication(plan, {
    dryRun: false,
    inspect: async archive => archive.target === plan.archives[1].target
      ? exact(conflicting) : {status: 'absent'},
    publishPackage: async () => {
      published += 1;
    },
  }), /conflicting existing version @binary-balance\/seshat-linux-arm64@0\.1\.0-rc\.1/);
  assert.equal(published, 0);
});

test('partial retry skips only byte-identical published archives', async () => {
  const value = fixture();
  const plan = planWith(value);
  const published = [];
  const result = await executePublication(plan, {
    dryRun: false,
    inspect: async archive => archive.target === 'linux-x64' ? exact(archive) : {status: 'absent'},
    publishPackage: async archive => published.push(archive.target),
  });
  assert.deepEqual(published, ['linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64', 'universal']);
  assert.equal(result.packages[0].action, 'already-present');
  assert.equal(result.packages.at(-1).action, 'published');
});

test('registry HTTP failures stop the publication check', async () => {
  const value = fixture();
  const plan = planWith(value);
  await assert.rejects(inspectRegistry(plan.archives[0], async () => ({status: 503, ok: false})),
    /registry metadata failed.*HTTP 503/);
  assert.throws(() => registryDecision(plan.archives[0], {
    status: 'present', bytes: plan.archives[0].bytes, sha256: 'f'.repeat(64), data: plan.archives[0].data,
  }), /conflicting existing version/);
});
