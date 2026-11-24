import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {setTimeout as sleep} from 'node:timers/promises';
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

import {releasePackages} from './release-targets.mjs';
import {stageArchives} from './release-local-archive-stager.mjs';

const revision = 'a'.repeat(40);
const sourceCommit = 'b'.repeat(40);
const version = '0.19.0';
const temporaryDirectories = [];

function hash(data) {
  return createHash('sha256').update(data).digest('hex');
}

function entryArchive(packageVersion, mutate = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'seshat-entry-fixture-'));
  temporaryDirectories.push(root);
  mkdirSync(join(root, 'package'));
  const manifest = {name:'@binary-balance/seshat', version:packageVersion,
    optionalDependencies:Object.fromEntries(releasePackages(packageVersion)
      .filter(target => target.role === 'native-release').map(target => [target.package, packageVersion]))};
  mutate(manifest);
  writeFileSync(join(root, 'package/package.json'), JSON.stringify(manifest));
  const archive = join(root, 'entry.tgz');
  execFileSync(process.platform === 'win32' ? 'tar.exe' : 'tar',
    ['--format=ustar', '-czf', archive, '-C', root, 'package/package.json']);
  return readFileSync(archive);
}

function fixture(packageVersion = version, mutateEntry) {
  const archiveDir = mkdtempSync(join(tmpdir(), 'seshat-npm-publishing-'));
  temporaryDirectories.push(archiveDir);
  const coordinates = releasePackages(packageVersion).map(target => {
    const data = target.role === 'entry' ? entryArchive(packageVersion, mutateEntry)
      : Buffer.from(`verified:${target.target}`);
    writeFileSync(join(archiveDir, target.file), data);
    return {
      target: target.target,
      role: target.role,
      canonical: true,
      package: target.package,
      version:packageVersion,
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
      candidate: {packageVersion, sourceCommit},
      coordinates,
    },
  };
}

function planWith(fixtureValue, options = {}) {
  return buildPublicationPlan(fixtureValue.manifest, {
    archiveDir: fixtureValue.archiveDir,
    revision,
    version:fixtureValue.manifest.candidate.packageVersion,
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
    'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64', 'linux-x64-musl', 'linux-arm64-musl', 'universal',
  ]);
  assert.equal(expectedTag(version), 'latest');
  assert.equal(expectedTag('0.2.0'), 'latest');
  assert.deepEqual(publishArgs(plan.archives[0], {tag: plan.tag, dryRun: true}).slice(1), [
    '--access=public',
    '--tag=latest',
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
  assert.equal(planWith(value, {stagingEvidence: evidence}).archives.length, 8);
  unlinkSync(join(value.archiveDir, 'linux-x64.tgz'));
  assert.throws(() => planWith(value), /exactly the canonical release archives/);
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
  assert.equal(result.packages.length, 8);
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
  }), /conflicting existing version @binary-balance\/seshat-linux-arm64@0\.19\.0/);
  assert.equal(published, 0);
});

test('partial retry skips only byte-identical published archives', async () => {
  const value = fixture();
  const plan = planWith(value);
  const published = [];
  const result = await executePublication(plan, {
    dryRun: false,
    inspect: async (archive, {requireProvenance = false} = {}) => requireProvenance
      ? {...exact(archive), provenance: true}
      : archive.target === 'linux-x64' ? exact(archive) : {status: 'absent'},
    publishPackage: async archive => published.push(archive.target),
  });
  assert.deepEqual(published, ['linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64', 'linux-x64-musl', 'linux-arm64-musl', 'universal']);
  assert.equal(result.packages[0].action, 'already-present');
  assert.equal(result.packages.at(-1).action, 'published');
});

test('native publish failure stops before the entry package', async () => {
  const value = fixture();
  const plan = planWith(value);
  const published = [];
  await assert.rejects(executePublication(plan, {
    dryRun: false,
    inspect: async () => ({status: 'absent'}),
    publishPackage: async archive => {
      published.push(archive.target);
      if (archive.target === 'linux-arm64') throw new Error('native publish failed');
    },
  }), /native publish failed/);
  assert.deepEqual(published, ['linux-x64', 'linux-arm64']);
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

test('entry publication waits for every native archive and provenance record', async () => {
  const plan = planWith(fixture());
  const published = [];
  const checks = new Map();
  await executePublication(plan, {
    dryRun: false,
    availabilityIntervalMs: 1,
    inspect: async (archive, {requireProvenance = false} = {}) => {
      if (!requireProvenance) return {status: 'absent'};
      assert.equal(published.length, 7);
      const count = (checks.get(archive.target) ?? 0) + 1;
      checks.set(archive.target, count);
      if (count === 1) return {status: 'absent'};
      return {...exact(archive), provenance: count >= 3};
    },
    publishPackage: async archive => {
      if (archive.role === 'entry') {
        assert.equal(checks.size, 7);
        assert.ok([...checks.values()].every(count => count === 3));
      }
      published.push(archive.target);
    },
  });
  assert.deepEqual(published, PACKAGE_ORDER.map(archive => archive.target));
});

test('availability timeout reports pending records and safely resumes without republishing natives', async () => {
  const plan = planWith(fixture());
  const published = [];
  let ready = false;
  const options = {
    dryRun: false,
    availabilityTimeoutMs: 30,
    availabilityIntervalMs: 1,
    inspect: async (archive, {requireProvenance = false} = {}) => {
      if (requireProvenance && !ready) {
        if (archive.target === 'linux-x64-musl') return {status: 'absent'};
        if (archive.target === 'linux-arm64-musl') return {...exact(archive), provenance: false};
      }
      return published.includes(archive.target)
        ? {...exact(archive), provenance: true} : {status: 'absent'};
    },
    publishPackage: async archive => published.push(archive.target),
  };
  await assert.rejects(executePublication(plan, options), error => {
    assert.match(error.message, /Timed out.*entry package was not published/);
    assert.match(error.message, /seshat-linux-x64-musl@0.19.0 \(version unavailable\)/);
    assert.match(error.message, /seshat-linux-arm64-musl@0.19.0 \(provenance unavailable\)/);
    assert.doesNotMatch(error.message, /seshat-darwin/);
    assert.equal(error.publicationPackages.length, 7);
    return true;
  });
  assert.equal(published.length, 7);
  ready = true;
  const result = await executePublication(plan, options);
  assert.deepEqual(published, PACKAGE_ORDER.map(archive => archive.target));
  assert.ok(result.packages.slice(0, 7).every(record => record.action === 'already-present'));
  assert.equal(result.packages.at(-1).action, 'published');
});

test('conflicting bytes at the availability gate prevent entry publication', async () => {
  const plan = planWith(fixture());
  const published = [];
  await assert.rejects(executePublication(plan, {
    dryRun: false,
    inspect: async (archive, {requireProvenance = false} = {}) => requireProvenance
      ? {...exact(archive), data: Buffer.from('changed'), provenance: false}
      : {status: 'absent'},
    publishPackage: async archive => published.push(archive.target),
  }), /conflicting existing version/);
  assert.equal(published.length, 7);
});

test('registry availability requires downloadable matching bytes and a provenance bundle', async t => {
  const archive = planWith(fixture()).archives[0];
  const tarball = `${REGISTRY}fixture.tgz`;
  const attestationUrl = `${REGISTRY}-/npm/v1/attestations/fixture`;
  const predicateType = 'https://slsa.dev/provenance/v1';
  const metadata = {versions: {[version]: {name: archive.package, version, dist: {
    tarball, attestations: {url: attestationUrl, provenance: {predicateType}},
  }}}};
  const records = {attestations: [{predicateType, bundle: {
    dsseEnvelope: {payload: 'fixture', signatures: [{sig: 'fixture'}]},
  }}]};
  async function inspect({manifest = metadata, bytes = archive.data,
    archiveStatus = 200, attestationStatus = 200, body = records} = {}) {
    return inspectRegistry(archive, async (url, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.redirect, 'error');
      if (String(url) === tarball) return new Response(bytes, {status: archiveStatus});
      if (String(url) === attestationUrl) return Response.json(body, {status: attestationStatus});
      assert.equal(String(url), `${REGISTRY}${encodeURIComponent(archive.package)}`);
      return Response.json(manifest);
    }, {requireProvenance: true});
  }
  await t.test('matching archive and provenance are ready', async () => {
    assert.equal((await inspect()).provenance, true);
  });
  await t.test('missing version, tarball and provenance remain pending', async () => {
    assert.equal((await inspect({manifest: {versions: {}}})).status, 'absent');
    assert.equal((await inspect({archiveStatus: 404})).status, 'pending');
    const missing = structuredClone(metadata);
    delete missing.versions[version].dist.attestations;
    assert.equal((await inspect({manifest: missing})).provenance, false);
    assert.equal((await inspect({attestationStatus: 404})).provenance, false);
    assert.equal((await inspect({body: {attestations: []}})).provenance, false);
    assert.equal((await inspect({body: {attestations: [{predicateType, bundle: {}}]}})).provenance, false);
  });
  await t.test('mismatched bytes fail even while provenance is missing', async () => {
    await assert.rejects(inspect({bytes: Buffer.from('different'), attestationStatus: 404}),
      /conflicting existing version/);
  });
  await t.test('registry errors and invalid records fail closed', async () => {
    await assert.rejects(inspect({attestationStatus: 503}), /registry attestations failed.*HTTP 503/);
    await assert.rejects(inspect({body: {}}), /attestation records are invalid/);
    const external = structuredClone(metadata);
    external.versions[version].dist.attestations.url = 'https://example.com/attestations';
    await assert.rejects(inspect({manifest: external}), /outside the fixed npmjs registry/);
  });
});

test('availability deadline aborts a stalled registry body and retains publication progress', async () => {
  const plan = planWith(fixture());
  const published = [];
  await assert.rejects(executePublication(plan, {
    dryRun: false,
    availabilityTimeoutMs: 30,
    inspect: async (archive, options) => {
      if (!options?.requireProvenance) return {status: 'absent'};
      return inspectRegistry(archive, async (_url, {signal}) => ({
        status: 200,
        json: async () => sleep(1000, {}, {signal}),
      }), options);
    },
    publishPackage: async archive => published.push(archive.target),
  }), error => {
    assert.match(error.message, /Timed out.*seshat-linux-x64@0.19.0/);
    assert.equal(error.publicationPackages.length, 7);
    return true;
  });
  assert.equal(published.length, 7);
});


test('legacy six-package audits remain valid; 0.19 and later require all eight', () => {
  for (const legacy of ['0.2.0', '0.18.0', '0.18.9-rc.1']) {
    assert.equal(planWith(fixture(legacy)).archives.length, 6);
  }
  for (const next of ['0.19.0-rc.1', '0.19.0', '0.20.0', '1.0.0']) {
    assert.equal(planWith(fixture(next)).archives.length, 8);
    for (const missing of [['linux-x64-musl'], ['linux-arm64-musl'], ['linux-x64-musl', 'linux-arm64-musl']]) {
      const value = fixture(next);
      value.manifest.coordinates = value.manifest.coordinates.filter(row => !missing.includes(row.target));
      assert.throws(() => planWith(value), /must contain 8 coordinates/);
    }
  }
  const experimental = fixture();
  experimental.manifest.candidate.packageVersion = '0.18.0';
  experimental.manifest.coordinates.forEach(row => { row.version = '0.18.0'; });
  assert.throws(() => planWith(experimental), /must contain 6 coordinates/);
  for (const mutate of [
    value => { value.manifest.coordinates[6] = value.manifest.coordinates[5]; },
    value => { value.manifest.coordinates[6].version = '0.18.0'; },
    value => { value.manifest.coordinates[6].package = '@binary-balance/seshat-linux-arm64'; },
  ]) {
    const value = fixture(); mutate(value);
    assert.throws(() => planWith(value), /duplicate release target|version differs|package identity/);
  }
});


test('CLI defaults to a read-only dry run for the full eight-package plan', () => {
  const value = fixture();
  const plan = planWith(value);
  const root = mkdtempSync(join(tmpdir(), 'seshat-publication-cli-'));
  temporaryDirectories.push(root);
  const checkout = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
  const manifestPath = join(root, 'audit.json');
  const evidencePath = join(root, 'staging.json');
  writeFileSync(manifestPath, JSON.stringify(value.manifest));
  writeFileSync(evidencePath, JSON.stringify({kind:'seshat-release-local-archive-staging',
    candidate:value.manifest.candidate, validation:{passed:true},
    sourceEquivalence:{candidateCommit:sourceCommit, checkoutCommit:checkout, paths:['crates', 'packages', 'packaging']},
    archives:plan.archives.map(({target, file, bytes, sha256}) => ({target, file, bytes, sha256})),
  }));
  const result = JSON.parse(execFileSync(process.execPath, ['benchmarks/proofs/npm-publishing.mjs',
    '--manifest', manifestPath, '--archives', value.archiveDir, '--staging-evidence', evidencePath,
    '--revision', checkout, '--version', version], {encoding:'utf8'}));
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.validation.passed, true);
  assert.equal(result.packages.length, 8);
  assert.ok(result.packages.every(row => row.action === 'planned' && row.argv.at(-1) === '--dry-run'));
});


function stageWith(value) {
  const source = mkdtempSync(join(tmpdir(), 'seshat-staging-fixture-'));
  temporaryDirectories.push(source);
  for (const coordinate of value.manifest.coordinates) {
    coordinate.runId = 1;
    coordinate.artifactName = 'fixture';
    writeFileSync(join(source, coordinate.archivePath),
      readFileSync(join(value.archiveDir, releasePackages(value.manifest.candidate.packageVersion)
        .find(row => row.target === coordinate.target).file)));
  }
  return stageArchives(value.manifest.coordinates, new Map([['1/fixture', source]]), join(source, 'staged'));
}

test('staging and publication reject an experimental entry in a six-package audit', async t => {
  for (const [name, run] of [['publication', planWith], ['staging', stageWith]]) {
    await t.test(name, () => {
      const value = fixture('0.18.0', manifest => {
        manifest.optionalDependencies['@binary-balance/seshat-linux-x64-musl'] = '0.18.0';
        manifest.optionalDependencies['@binary-balance/seshat-linux-arm64-musl'] = '0.18.0';
      });
      assert.throws(() => run(value), /entry optional dependency set or versions differ/);
    });
  }
});

test('staging and publication bind entry identity, version and exact dependency versions', () => {
  for (const packageVersion of ['0.18.0', '0.19.0-rc.1', '0.19.0']) {
    const valid = fixture(packageVersion);
    assert.equal(planWith(valid).archives.length, releasePackages(packageVersion).length);
    assert.equal(stageWith(valid).length, releasePackages(packageVersion).length);
    for (const [mutate, message] of [
      [manifest => { manifest.name = '@binary-balance/other'; }, /entry package identity differs/],
      [manifest => { manifest.version = '0.1.0'; }, /entry package version differs/],
      [manifest => { delete manifest.optionalDependencies['@binary-balance/seshat-linux-x64']; }, /entry optional dependency set or versions differ/],
      [manifest => { manifest.optionalDependencies['@binary-balance/seshat-linux-x64'] = '^' + packageVersion; }, /entry optional dependency set or versions differ/],
    ]) {
      const value = fixture(packageVersion, mutate);
      assert.throws(() => planWith(value), message);
      assert.throws(() => stageWith(value), message);
    }
  }
});
