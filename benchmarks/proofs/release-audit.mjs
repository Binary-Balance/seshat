// Read-only release preparation. Archive bytes are inspected, never repacked.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual, parseArgs} from 'node:util';
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {packageFiles, windowsPackageFiles} from './repeat-proof.mjs';
import {expectedTag} from './npm-publishing.mjs';

export const targets = [
  {target: 'linux-x64', triple: 'x86_64-unknown-linux-gnu', artifact: 'linux-x64-package-proof', workflow: 'linux-x64-package.yml', binary: 'package/bin/seshat'},
  {target: 'linux-arm64', triple: 'aarch64-unknown-linux-gnu', artifact: 'linux-arm64-package-proof', workflow: 'linux-arm64-package.yml', binary: 'package/bin/seshat'},
  {target: 'darwin-x64', triple: 'x86_64-apple-darwin', artifact: 'macos-x64-package-proof', workflow: 'macos-package.yml', binary: 'package/bin/seshat'},
  {target: 'darwin-arm64', triple: 'aarch64-apple-darwin', artifact: 'macos-arm64-package-proof', workflow: 'macos-package.yml', binary: 'package/bin/seshat'},
  {target: 'win32-x64', triple: 'x86_64-pc-windows-msvc', artifact: 'windows-x64-package-proof', workflow: 'windows-package.yml', binary: 'package/bin/seshat.exe'},
];
const sourcePaths = ['crates', 'packages', 'packaging'];
const sha256 = data => createHash('sha256').update(data).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const sh = (command, args, options = {}) => execFileSync(command, args,
  {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options}).trim();

function archiveContents(archive) {
  const tar = gunzipSync(readFileSync(archive));
  const files = [];
  const field = (header, start, end) => header.subarray(start, end).toString('utf8').replace(/\0.*$/s, '');
  const octal = (header, start, end) => {
    const text = field(header, start, end).trim();
    assert.match(text, /^[0-7]+$/, 'archive header must contain an octal number');
    const value = parseInt(text, 8);
    assert.ok(Number.isSafeInteger(value), 'archive header number is too large');
    return value;
  };
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      assert.ok(tar.subarray(offset).every(byte => byte === 0), 'archive has data after its end marker');
      return files.sort((a, b) => a.record.path.localeCompare(b.record.path));
    }
    const checksum = [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    assert.equal(octal(header, 148, 156), checksum, 'archive header checksum differs');
    const path = [field(header, 345, 500), field(header, 0, 100)].filter(Boolean).join('/');
    assert.match(path, /^package\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/, 'archive member path is invalid');
    assert.ok(!path.split('/').includes('..'), 'archive member path escapes package');
    assert.ok(header[156] === 0 || header[156] === 48, `${path}: archive member must be a regular file`);
    assert.ok(!files.some(file => file.record.path === path), `${path}: duplicate archive member`);
    const size = octal(header, 124, 136);
    const next = offset + 512 + Math.ceil(size / 512) * 512;
    assert.ok(next <= tar.length, `${path}: archive member is truncated`);
    const data = tar.subarray(offset + 512, offset + 512 + size);
    files.push({record: {path, bytes: size, sha256: sha256(data), mode: octal(header, 100, 108).toString(8).padStart(4, '0')}, data});
    offset = next;
  }
  throw new Error('archive is missing its end marker');
}

export function readArchive(archive) {
  return archiveContents(archive).map(file => file.record);
}

function archiveData(archive, path) {
  const member = archiveContents(archive).find(file => file.record.path === path);
  assert.ok(member, `${path}: archive member is missing`);
  return member.data;
}
const archiveJson = (archive, path) => JSON.parse(archiveData(archive, path));
function requiredMember(members, path) {
  const member = members.find(value => value.path === path);
  assert.ok(member, `${path}: archive member is missing`);
  return member;
}
function archiveRecord(path) {
  const data = readFileSync(path);
  return {bytes: data.length, sha256: sha256(data)};
}
function assertArtifact(expected, actual, label) {
  assert.equal(expected?.sha256, actual.sha256, `${label} hash differs`);
  assert.equal(expected?.bytes, actual.bytes, `${label} size differs`);
}
function validateRun(run, head, label) {
  assert.equal(run.status, 'completed', `${label}: run is not complete`);
  assert.equal(run.conclusion, 'success', `${label}: run did not succeed`);
  assert.equal(run.head_sha, head, `${label}: run head differs from the PR head`);
}
function validateProvenance(provenance, run, repository, label) {
  assert.equal(provenance.repository, repository, `${label}: provenance repository differs`);
  assert.equal(Number(provenance.runId), run.id, `${label}: provenance run differs`);
  assert.equal(Number(provenance.runAttempt), run.run_attempt, `${label}: provenance run attempt differs`);
  assert.equal(provenance.workflow, run.name, `${label}: provenance workflow differs`);
  assert.equal(provenance.workflowRef, `${repository}/${run.path}@${provenance.ref}`, `${label}: workflow ref differs`);
  assert.equal(provenance.workflowSha, provenance.sourceCommit, `${label}: workflow source differs`);
}
function validateNative({target, triple, binary, summary, build, manifest, archive, archiveMembers}) {
  const member = path => requiredMember(archiveMembers, path);
  assert.deepEqual(archiveMembers.map(value => value.path),
    (target === 'win32-x64' ? windowsPackageFiles : packageFiles).map(path => `package/${path}`).sort((a, b) => a.localeCompare(b)),
    `${target}: native archive file set differs`);
  assert.equal(manifest.name, `@binary-balance/seshat-${target}`, `${target}: package identity differs`);
  assert.equal(build.package, manifest.name, `${target}: build package differs`);
  assert.deepEqual(manifest.os, [target.split('-')[0]], `${target}: manifest OS differs`);
  assert.deepEqual(manifest.cpu, [target.split('-')[1]], `${target}: manifest CPU differs`);
  assert.equal(build.target, triple, `${target}: build target differs`);
  // Windows npm archives record PE files as 0644; Unix binaries need execute bits.
  assert.equal(member(binary).mode, target === 'win32-x64' ? '0644' : '0755', `${target}: binary mode differs`);
  for (const file of archiveMembers.filter(value => value.path !== binary)) {
    assert.equal(file.mode, '0644', `${target}: ${file.path} mode differs`);
  }
  assertArtifact(summary.artifacts.releaseNativeArchive, archive, `${target}: summary archive`);
  assertArtifact(summary.artifacts.binary, member(binary), `${target}: summary binary`);
  assert.equal(build.runtimeNotices.noticeBytes, member('package/THIRD_PARTY_NOTICES.txt').bytes, `${target}: notice size differs`);
}

function portablePath(path, repo) {
  const local = relative(repo, resolve(path));
  return local.startsWith('..') ? basename(path) : local.split('\\').join('/');
}

function changes(previous, current, key) {
  if (!previous) return null;
  // Cargo can lock several versions of one crate. Compare every record for a name.
  const group = entries => {
    const groups = new Map();
    for (const value of entries) {
      if (!groups.has(value[key])) groups.set(value[key], []);
      groups.get(value[key]).push(value);
    }
    return groups;
  };
  const before = group(previous);
  const after = group(current);
  const value = entries => entries.length === 1 ? entries[0] : entries;
  return {
    added: current.filter(value => !before.has(value[key])),
    removed: previous.filter(value => !after.has(value[key])),
    changed: [...after].filter(([name, entries]) => before.has(name) && !isDeepStrictEqual(before.get(name), entries))
      .map(([name, entries]) => ({previous: value(before.get(name)), current: value(entries)})),
  };
}

function comparePrevious({previousAuditPath, previousArchivePath, repo}, current, notice) {
  assert.ok(previousAuditPath || previousArchivePath, 'previous audit or archive is required');
  const audit = previousAuditPath ? readJson(previousAuditPath) : null;
  if (audit) {
    assert.equal(audit.kind, 'seshat-release-notice-audit', 'previous audit kind is invalid');
    assert.equal(audit.schemaVersion, 1, 'previous audit schema differs');
  }
  const target = audit?.targets.find(value => value.target === 'linux-x64');
  const coordinate = audit?.coordinates.find(value => value.target === 'linux-x64');
  const build = previousArchivePath ? archiveJson(previousArchivePath, 'package/BUILD.json') : target?.build;
  assert.ok(build, 'previous release has no Linux x64 build record');
  const version = build.packageVersion ?? audit?.candidate.packageVersion;
  if (audit && previousArchivePath) {
    assert.equal(version, audit.candidate.packageVersion, 'previous archive version differs from previous audit');
    assertArtifact({bytes: coordinate.archiveBytes, sha256: coordinate.archiveSha256}, archiveRecord(previousArchivePath), 'previous archive');
  }
  const previousDependencies = build.dependencies;
  const previousInventory = previousDependencies ? sha256(JSON.stringify(previousDependencies))
    : coordinate?.buildProvenance.dependencyInventory?.sha256 ?? audit?.dependencyReview.inventorySha256;
  const assetRecords = assets => assets?.map(({path, bytes, sha256}) => ({path, bytes, sha256}));
  // Older audits add review notes and URLs to the same asset identity records.
  const previousAssets = assetRecords(build.runtimeNotices?.assets ?? audit?.rustRuntimeNotice?.assets);
  const currentAssets = assetRecords(current.runtimeNotices.assets);
  const previousNotice = previousArchivePath ? requiredMember(readArchive(previousArchivePath), 'package/THIRD_PARTY_NOTICES.txt')
    : coordinate?.buildProvenance.notice ?? target?.members.find(value => value.path === 'package/THIRD_PARTY_NOTICES.txt');
  assert.ok(previousInventory && previousNotice, 'previous release lacks dependency or notice hashes');
  const currentInventory = sha256(JSON.stringify(current.dependencies));
  // Historical audits sorted JSON object keys; later coordinates preserve BUILD order.
  const currentCanonicalInventory = sha256(JSON.stringify(current.dependencies.map(value =>
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))))));
  const previousRust = build.rust;
  const noticeChanged = previousNotice.sha256 !== notice.sha256;
  return {
    baseline: version,
    ...(previousAuditPath ? {baselineAudit: portablePath(previousAuditPath, repo)} : {}),
    ...(previousArchivePath ? {baselineArchive: portablePath(previousArchivePath, repo)} : {}),
    lockedDependencyCount: current.dependencies.length,
    dependenciesMatchBaseline: [currentInventory, currentCanonicalInventory].includes(previousInventory),
    runtimeNoticeAssetsMatchBaseline: previousAssets ? isDeepStrictEqual(previousAssets, currentAssets) : null,
    rustToolchainMatchesBaseline: previousRust === current.rust,
    notice: {...notice, identicalOnAllTargets: true,
      changeFromBaseline: noticeChanged
        ? `Notice bytes changed from ${previousNotice.bytes} to ${notice.bytes}; SHA-256 changed from ${previousNotice.sha256} to ${notice.sha256}.`
        : 'Notice bytes and SHA-256 match the previous release.'},
    differences: {
      dependencies: {previousSha256: previousInventory, currentSha256: currentInventory,
        currentCanonicalSha256: currentCanonicalInventory, entries: changes(previousDependencies, current.dependencies, 'name')},
      runtimeNoticeAssets: changes(previousAssets, currentAssets, 'path'),
      rust: {previous: previousRust, current: current.rust},
      notice: {previous: {bytes: previousNotice.bytes, sha256: previousNotice.sha256}, current: notice},
    },
  };
}

// The injected run/tree readers let fixture tests exercise the same checks without GitHub.
export function createAudit({evidence, repo, repository: repoSlug = 'Binary-Balance/seshat', head: directHead,
  pullRequest = null, issue = null, previousAuditPath, previousArchivePath, runFor, tree}) {
  assert.match(directHead ?? '', /^[\da-f]{40}$/, 'head must be a full commit SHA');
  const coordinates = [];
  const builds = [];
  const targetRecords = [];
  const entryVariants = [];
  let sourceCommit;
  let sourceRef;

  for (const {target, triple, artifact, binary, workflow: workflowFile} of targets) {
    const directory = join(evidence, target);
    const summary = readJson(join(directory, 'summary.json'));
    const provenance = summary.preflight.provenance;
    const runId = Number(provenance.runId);
    const {run, jobs, artifacts} = runFor(runId);
    validateRun(run, directHead, target);
    validateProvenance(provenance, run, repoSlug, target);
    assert.equal(run.path, `.github/workflows/${workflowFile}`, `${target}: package workflow differs`);
    const matchingArtifacts = artifacts.filter(value => value.name === artifact);
    assert.equal(matchingArtifacts.length, 1, `${target}: artifact is missing or ambiguous`);
    const artifactRecord = matchingArtifacts[0];
    // The macOS workflow has one job per CPU; the others have a single package job.
    const candidates = jobs.filter(value => value.name === provenance.job || value.name.startsWith(`${provenance.job} (`));
    const matchingJobs = candidates.length === 1 ? candidates : candidates.filter(value => value.name.includes(triple));
    assert.equal(matchingJobs.length, 1, `${target}: job is missing or ambiguous`);
    const job = matchingJobs[0];
    assert.equal(job.conclusion, 'success', `${target}: job did not succeed`);

    sourceCommit ??= summary.sourceCommit;
    sourceRef ??= provenance.ref;
    assert.equal(provenance.sourceCommit, summary.sourceCommit, `${target}: provenance source commit differs`);
    assert.equal(summary.sourceCommit, sourceCommit, `${target}: source commit differs`);
    assert.equal(provenance.ref, sourceRef, `${target}: source ref differs`);
    assert.equal(summary.preflight.validation.passed, true, `${target}: preflight failed`);
    assert.equal(summary.validation?.passed ?? summary.preflight.validation.passed, true, `${target}: validation failed`);

    const archiveFile = `seshat-${target}-release.tgz`;
    const archivePath = join(directory, archiveFile);
    const archive = archiveRecord(archivePath);
    const archiveMembers = readArchive(archivePath);
    const member = path => requiredMember(archiveMembers, path);
    const build = archiveJson(archivePath, 'package/BUILD.json');
    const manifest = archiveJson(archivePath, 'package/package.json');
    validateNative({target, triple, binary, summary, build, manifest, archive, archiveMembers});
    assert.equal(build.sourceCommit, sourceCommit, `${target}: BUILD.json source commit differs`);
    assert.equal(build.packageVersion, manifest.version, `${target}: build and manifest versions differ`);
    assert.equal(build.binarySha256, member(binary).sha256, `${target}: BUILD.json binary hash differs from the archive`);
    assert.equal(build.binaryBytes, member(binary).bytes, `${target}: BUILD.json binary size differs from the archive`);
    assert.equal(build.runtimeNotices.noticeSha256, member('package/THIRD_PARTY_NOTICES.txt').sha256,
      `${target}: BUILD.json notice hash differs from the archive`);
    builds.push(build);

    const artifactFields = {
      runId,
      runUrl: run.html_url,
      jobId: job.id,
      jobUrl: job.html_url,
      artifactId: artifactRecord.id,
      artifactName: artifact,
      artifactUrl: `${run.html_url}/artifacts/${artifactRecord.id}`,
      artifactApiUrl: artifactRecord.url,
      artifactSizeBytes: artifactRecord.size_in_bytes,
      artifactDigest: artifactRecord.digest,
      createdAt: artifactRecord.created_at,
      expiresAt: artifactRecord.expires_at,
      expired: artifactRecord.expired,
    };
    const workflow = {
      sourceCommit,
      sourceRef,
      workflow: provenance.workflow,
      workflowRef: provenance.workflowRef,
      job: provenance.job,
    };
    coordinates.push({
      id: `native-${target}`,
      role: 'native-release',
      canonical: true,
      package: manifest.name,
      version: manifest.version,
      target,
      targetTriple: triple,
      ...artifactFields,
      archivePath: archiveFile,
      archiveFile,
      archiveClass: 'native-release',
      archiveBytes: archive.bytes,
      archiveSha256: archive.sha256,
      buildProvenance: {
        ...workflow,
        buildRecord: member('package/BUILD.json'),
        packageManifest: member('package/package.json'),
        binary: member(binary),
        notice: member('package/THIRD_PARTY_NOTICES.txt'),
        dependencyInventory: {count: build.dependencies.length, sha256: sha256(JSON.stringify(build.dependencies))},
        cargoLockSha256: build.cargoLockSha256,
      },
    });
    targetRecords.push({
      target,
      package: manifest.name,
      version: manifest.version,
      targetTriple: triple,
      packageMetadata: manifest,
      archive: {file: archiveFile, ...archive},
      members: archiveMembers,
      build: {
        rust: build.rust,
        rustCommit: build.runtimeNotices.rustCommit,
        cargoLockSha256: build.cargoLockSha256,
        dependencyCount: build.dependencies.length,
        nativeLibraries: build.nativeLibraries ?? null,
      },
      proof: {
        kind: summary.kind,
        runner: summary.runner ?? null,
        node: summary.node ?? null,
        validationPassed: true,
        summaryFile: `native-evidence/${target}/summary.json`,
        summarySha256: sha256(readFileSync(join(directory, 'summary.json'))),
      },
    });

    const entryPath = join(directory, 'seshat-entry.tgz');
    assertArtifact(summary.artifacts.entryArchive, archiveRecord(entryPath), `${target}: entry archive`);
    entryVariants.push({
      host: target, ...artifactFields, workflow,
      archive: archiveRecord(entryPath), members: readArchive(entryPath),
    });
  }

  // Linux x64 supplies the canonical entry archive; compare payload bytes on every host.
  const canonicalEntry = entryVariants.find(value => value.host === 'linux-x64');
  const entryArchive = join(evidence, 'linux-x64', 'seshat-entry.tgz');
  const entryManifest = archiveJson(entryArchive, 'package/package.json');
  const entryMember = path => requiredMember(canonicalEntry.members, path);
  assert.equal(entryMember('package/bin/seshat.mjs').mode, '0755', 'canonical entry launcher is not executable');
  for (const variant of entryVariants) {
    assert.deepEqual(variant.members.map(({path, bytes, sha256: hash}) => ({path, bytes, hash})),
      canonicalEntry.members.map(({path, bytes, sha256: hash}) => ({path, bytes, hash})),
      `${variant.host}: entry member bytes differ from the canonical entry`);
  }
  const {host: _host, workflow: entryWorkflow, archive: entryRecord, members: entryMembers, ...entryArtifact} = canonicalEntry;
  coordinates.push({
    id: 'entry-unix-canonical',
    role: 'entry',
    canonical: true,
    package: entryManifest.name,
    version: entryManifest.version,
    target: 'universal',
    targetTriple: null,
    ...entryArtifact,
    archivePath: 'seshat-entry.tgz',
    archiveFile: 'seshat-entry.tgz',
    archiveClass: 'canonical-entry',
    archiveBytes: entryRecord.bytes,
    archiveSha256: entryRecord.sha256,
    buildProvenance: {
      ...entryWorkflow,
      packageManifest: entryMember('package/package.json'),
      launcher: entryMember('package/bin/seshat.mjs'),
      readme: entryMember('package/README.md'),
      license: entryMember('package/LICENSE'),
    },
  });

  const version = entryManifest.version;
  expectedTag(version);
  const sourcePullRequest = sourceRef.match(/^refs\/pull\/(\d+)\/merge$/)?.[1];
  if (pullRequest) assert.equal(sourcePullRequest, String(pullRequest), 'source ref differs from requested PR');
  else if (sourcePullRequest) pullRequest = Number(sourcePullRequest);
  assert.ok(coordinates.every(value => value.version === version), 'package versions differ');
  for (const record of targetRecords) {
    assert.equal(entryManifest.optionalDependencies[record.package], version, `${record.target}: entry dependency version differs`);
  }

  assert.equal(entryManifest.name, '@binary-balance/seshat', 'entry package identity differs');
  assert.deepEqual(Object.keys(entryManifest.optionalDependencies).sort(), targetRecords.map(value => value.package).sort(),
    'entry optional dependency set differs');
  assert.deepEqual(entryManifest.bin, {seshat: 'bin/seshat.mjs'}, 'entry launcher declaration differs');
  assert.deepEqual(entryMembers.map(value => value.path),
    ['package/LICENSE', 'package/README.md', 'package/bin/seshat.mjs', 'package/package.json'].sort((a, b) => a.localeCompare(b)), 'entry archive file set differs');
  for (const variant of entryVariants) {
    for (const member of variant.members) {
      assert.equal(member.mode, member.path === 'package/bin/seshat.mjs' ? '0755' : '0644',
        `${variant.host}: ${member.path} mode differs`);
    }
  }

  assert.match(sourceCommit, /^[\da-f]{40}$/, 'build source must be a full commit SHA');
  const sourceTrees = Object.fromEntries(sourcePaths.map(path => [path, tree(sourceCommit, path)]));
  for (const path of sourcePaths) {
    assert.equal(tree(directHead, path), sourceTrees[path], `${path}: PR head tree differs from the build source`);
    assert.match(sourceTrees[path], /^[\da-f]{40}$/, `${path}: source tree must be a full Git tree SHA`);
  }

  const runtimeDirectory = join(evidence, 'windows-runtime');
  const runtimePath = join(runtimeDirectory, 'windows-runtime-cli-evidence', 'windows-runtime-cli-evidence.json');
  const runtimeEvidence = readJson(runtimePath);
  const runtimePreflight = readJson(join(runtimeDirectory, 'windows-runtime-preflight', 'windows-runtime-preflight.json'));
  const runtimeRunId = Number(runtimePreflight.provenance.runId);
  const runtime = runFor(runtimeRunId);
  validateRun(runtime.run, directHead, 'Windows runtime');
  validateProvenance(runtimePreflight.provenance, runtime.run, repoSlug, 'Windows runtime');
  assert.equal(runtime.run.path, '.github/workflows/windows-runtime.yml', 'Windows runtime workflow differs');
  assert.equal(runtimePreflight.provenance.sourceCommit, sourceCommit, 'Windows runtime source commit differs');
  assert.equal(runtimePreflight.validation.passed, true, 'Windows runtime preflight failed');
  assert.equal(runtimeEvidence.kind, 'seshat-windows-runtime-cli', 'Windows runtime evidence kind differs');
  assert.equal(runtimeEvidence.validation?.passed, true, 'Windows runtime validation failed');
  const runtimeJobs = runtime.jobs.filter(value => value.name === runtimePreflight.provenance.job);
  assert.equal(runtimeJobs.length, 1, 'Windows runtime job is missing or ambiguous');
  assert.equal(runtimeJobs[0].conclusion, 'success', 'Windows runtime job failed');
  for (const name of ['windows-runtime-preflight', 'windows-runtime-cli-evidence']) {
    assert.ok(runtime.artifacts.some(value => value.name === name), `Windows runtime artifact is missing: ${name}`);
  }
  assert.match(runtimeEvidence.binary?.sha256 ?? '', /^[\da-f]{64}$/, 'Windows runtime binary hash is invalid');
  assert.ok(Number.isInteger(runtimeEvidence.binary.bytes) && runtimeEvidence.binary.bytes > 0, 'Windows runtime binary size is invalid');
  assert.deepEqual(Object.keys(runtimeEvidence.scenarios),
    ['baseline', 'timeout', 'overflow', 'leaderExit', 'leaderExitRepeat', 'consoleCancellation'], 'Windows runtime scenarios differ');

  const native = coordinates.filter(value => value.role === 'native-release');
  const notice = {bytes: native[0].buildProvenance.notice.bytes, sha256: native[0].buildProvenance.notice.sha256};
  for (let index = 1; index < builds.length; index++) {
    assert.deepEqual(builds[index].dependencies, builds[0].dependencies, `${targets[index].target}: dependency inventories differ`);
    assert.deepEqual(builds[index].runtimeNotices.assets, builds[0].runtimeNotices.assets, `${targets[index].target}: runtime notice assets differ`);
    assert.equal(builds[index].rust, builds[0].rust, `${targets[index].target}: Rust toolchains differ`);
    assert.equal(builds[index].runtimeNotices.rustCommit, builds[0].runtimeNotices.rustCommit, `${targets[index].target}: Rust commits differ`);
    assertArtifact(notice, native[index].buildProvenance.notice, `${targets[index].target}: notices`);
  }

  const dependencyReview = comparePrevious({previousAuditPath, previousArchivePath, repo}, builds[0], notice);
  const previousAudit = previousAuditPath ? readJson(previousAuditPath) : null;
  return {
    schemaVersion: 1,
    kind: 'seshat-release-notice-audit',
    ...(issue === null ? {} : {issue}),
    status: 'native-audit-complete-pending-local-matrix-and-publication',
    capturedAt: new Date().toISOString().slice(0, 10),
    candidate: {
      packageVersion: version,
      sourceCommit,
      sourceTrees,
      sourceRef,
      sourceCommitUrl: `https://github.com/${repoSlug}/commit/${sourceCommit}`,
      directHead,
      directHeadUrl: `https://github.com/${repoSlug}/commit/${directHead}`,
      ...(pullRequest ? {pullRequestUrl: `https://github.com/${repoSlug}/pull/${pullRequest}`} : {}),
      rust: {version: builds[0].runtimeNotices.rustcVersion, commit: builds[0].runtimeNotices.rustCommit},
      node: targetRecords[0].proof.node,
    },
    coordinates,
    entry: {
      archive: {file: 'seshat-entry.tgz', canonicalSourceTarget: 'linux-x64', ...entryRecord},
      members: entryMembers,
      packageMetadata: entryManifest,
      hostVariants: entryVariants.map(variant => ({
        host: variant.host, runId: variant.runId, artifactName: variant.artifactName,
        ...variant.archive, launcherMode: requiredMember(variant.members, 'package/bin/seshat.mjs').mode,
      })),
    },
    targets: targetRecords,
    dependencyReview,
    windowsRuntime: {
      runId: runtimeRunId,
      runUrl: runtime.run.html_url,
      artifacts: runtime.artifacts.map(value => ({
        id: value.id, name: value.name, sizeBytes: value.size_in_bytes, digest: value.digest, expiresAt: value.expires_at,
      })),
      binary: {bytes: runtimeEvidence.binary.bytes, sha256: runtimeEvidence.binary.sha256},
      scenarios: Object.keys(runtimeEvidence.scenarios),
      validationPassed: true,
      evidenceSha256: sha256(readFileSync(runtimePath)),
    },
    remainingChecks: [
      'Run the release local install workflow on all five targets.',
      'Run the read-only publisher dry run against the six staged archives and the reviewed revision.',
      'After publication, verify the six registry versions, tarball bytes and provenance against this audit.',
      'Create the GitHub release with the six audited archives.',
    ],
    historicalEvidence: previousAudit ? [
      {record: portablePath(previousAuditPath, repo), use: `Previous ${previousAudit.candidate.packageVersion} release audit.`},
      ...(previousAudit.historicalEvidence ?? []),
    ] : [],
  };
}

export function auditMarkdown(audit) {
  const number = value => value.toLocaleString('en-US');
  const c = audit.candidate;
  const review = audit.dependencyReview;
  const lines = [
    `# ${c.packageVersion} release notice audit`, '',
    `Captured ${audit.capturedAt}. Native audit complete; local install and publication checks remain.`, '',
    `Build source [${c.sourceCommit}](${c.sourceCommitUrl}), ref \`${c.sourceRef}\`.`, '',
    `Reviewed head [${c.directHead}](${c.directHeadUrl})${c.pullRequestUrl ? `, [pull request](${c.pullRequestUrl})` : ''}.`, '',
    '| source directory | Git tree |', '| --- | --- |',
    ...Object.entries(c.sourceTrees).map(([path, hash]) => `| \`${path}\` | \`${hash}\` |`), '',
    '| package | target | run and artifact | archive | bytes | SHA-256 |', '| --- | --- | --- | --- | ---: | --- |',
  ];
  for (const coordinate of audit.coordinates) {
    lines.push(`| \`${coordinate.package}\` | \`${coordinate.target}\` | [${coordinate.runId}](${coordinate.runUrl}), \`${coordinate.artifactName}\` | \`${coordinate.archiveFile}\` | ${number(coordinate.archiveBytes)} | \`${coordinate.archiveSha256}\` |`);
  }
  lines.push('', '## Canonical entry members', '', '| member | bytes | SHA-256 | mode |', '| --- | ---: | --- | --- |');
  for (const member of audit.entry.members) lines.push(`| \`${member.path}\` | ${number(member.bytes)} | \`${member.sha256}\` | \`${member.mode}\` |`);
  lines.push('', '## Native members', '', '| target | binary | `BUILD.json` | `package.json` | notices |', '| --- | --- | --- | --- | --- |');
  const cell = member => `${number(member.bytes)} bytes, \`${member.sha256}\``;
  for (const coordinate of audit.coordinates.filter(value => value.role === 'native-release')) {
    const p = coordinate.buildProvenance;
    lines.push(`| \`${coordinate.target}\` | \`${p.binary.path}\`, ${cell(p.binary)}, \`${p.binary.mode}\` | ${cell(p.buildRecord)} | ${cell(p.packageManifest)} | ${cell(p.notice)} |`);
  }
  lines.push('', '## Previous release comparison', '', `Previous version \`${review.baseline}\`.`, '',
    '| check | matches previous release |', '| --- | --- |',
    `| Dependency inventory | ${review.dependenciesMatchBaseline} |`,
    `| Runtime notice assets | ${review.runtimeNoticeAssetsMatchBaseline ?? 'Unknown; previous audit has no asset records'} |`,
    `| Rust toolchain | ${review.rustToolchainMatchesBaseline} |`, '', review.notice.changeFromBaseline, '',
    '| item | added | removed | changed |', '| --- | ---: | ---: | ---: |');
  for (const [label, changes] of [['Dependencies', review.differences.dependencies.entries], ['Runtime notice assets', review.differences.runtimeNoticeAssets]]) {
    lines.push(changes ? `| ${label} | ${changes.added.length} | ${changes.removed.length} | ${changes.changed.length} |` : `| ${label} | Unknown | Unknown | Unknown |`);
  }
  for (const changes of [review.differences.dependencies.entries, review.differences.runtimeNoticeAssets]) {
    if (changes && [changes.added, changes.removed, changes.changed].some(values => values.length))
      lines.push('', '```json', JSON.stringify(changes, null, 2), '```');
  }
  lines.push('', `Rust toolchain: \`${review.differences.rust.previous}\` → \`${review.differences.rust.current}\`.`, '',
    '## Windows runtime', '', `[Run ${audit.windowsRuntime.runId}](${audit.windowsRuntime.runUrl}) passed the runtime proof.`, '',
    `Scenarios: ${audit.windowsRuntime.scenarios.map(value => `\`${value}\``).join(', ')}.`, '',
    '## Remaining checks', '', ...audit.remainingChecks.map(value => `- ${value}`), '');
  return lines.join('\n');
}

export function selectRun(runs, workflow, head) {
  const run = runs.filter(value => value.path === `.github/workflows/${workflow}` &&
    value.status === 'completed' && value.conclusion === 'success' && value.head_sha === head)
    .sort((a, b) => b.id - a.id)[0];
  assert.ok(run, `no successful ${workflow} run for ${head}`);
  return run;
}

function main() {
  const {values} = parseArgs({options: {
    pr: {type: 'string'}, head: {type: 'string'}, repository: {type: 'string'},
    evidence: {type: 'string'}, output: {type: 'string'}, issue: {type: 'string'},
    'previous-audit': {type: 'string'}, 'previous-archive': {type: 'string'},
  }});
  assert.ok(Boolean(values.pr) !== Boolean(values.head), 'provide exactly one of --pr or --head');
  assert.ok(values['previous-audit'] || values['previous-archive'], 'provide --previous-audit or --previous-archive');
  const repo = sh('git', ['rev-parse', '--show-toplevel']);
  const repository = values.repository ?? 'Binary-Balance/seshat';
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'repository is invalid');
  const api = path => JSON.parse(sh('gh', ['api', `repos/${repository}/${path}`]));
  const paged = (path, key) => JSON.parse(sh('gh', ['api', '--paginate', '--slurp', `repos/${repository}/${path}`])).flatMap(page => page[key]);
  const pullRequest = values.pr ? Number(values.pr) : null;
  assert.ok(pullRequest === null || Number.isSafeInteger(pullRequest) && pullRequest > 0, 'PR number is invalid');
  const head = pullRequest ? api(`pulls/${pullRequest}`).head.sha : values.head;
  assert.match(head, /^[\da-f]{40}$/, 'head must be a full commit SHA');
  const issue = values.issue ? Number(values.issue) : null;
  assert.ok(issue === null || Number.isSafeInteger(issue) && issue > 0, 'issue number is invalid');
  const output = resolve(values.output ?? join(repo, 'work/release-audit'));
  const evidence = resolve(values.evidence ?? join(output, 'native-evidence'));
  const cache = new Map();
  const runFor = id => {
    if (!cache.has(id)) cache.set(id, {
      run: api(`actions/runs/${id}`),
      jobs: paged(`actions/runs/${id}/jobs?per_page=100`, 'jobs'),
      artifacts: paged(`actions/runs/${id}/artifacts?per_page=100`, 'artifacts'),
    });
    return cache.get(id);
  };
  if (!values.evidence) {
    assert.ok(!existsSync(evidence) || readdirSync(evidence).length === 0, 'download evidence directory must be empty');
    const runs = paged(`actions/runs?head_sha=${head}&status=success&per_page=100`, 'workflow_runs');
    const download = (run, artifact, directory) => {
      assert.ok(runFor(run.id).artifacts.some(value => value.name === artifact && !value.expired), `${artifact}: artifact is missing or expired`);
      mkdirSync(directory, {recursive: true});
      sh('gh', ['run', 'download', String(run.id), '--repo', repository, '--name', artifact, '--dir', directory]);
    };
    for (const {target, artifact, workflow} of targets) download(selectRun(runs, workflow, head), artifact, join(evidence, target));
    const runtime = selectRun(runs, 'windows-runtime.yml', head);
    for (const artifact of runFor(runtime.id).artifacts) download(runtime, artifact.name, join(evidence, 'windows-runtime', artifact.name));
  }
  const fetched = new Set();
  const tree = (commit, path) => {
    if (!fetched.has(commit)) {
      try { sh('git', ['cat-file', '-e', `${commit}^{commit}`], {cwd: repo, stdio: ['ignore', 'pipe', 'ignore']}); }
      catch { sh('git', ['fetch', '--quiet', '--no-tags', 'origin', commit], {cwd: repo}); }
      fetched.add(commit);
    }
    return sh('git', ['rev-parse', `${commit}:${path}`], {cwd: repo});
  };
  const audit = createAudit({evidence, repo, repository, head, pullRequest, issue,
    previousAuditPath: values['previous-audit'], previousArchivePath: values['previous-archive'], runFor, tree});
  mkdirSync(output, {recursive: true});
  writeFileSync(join(output, 'release-notice-audit.json'), JSON.stringify(audit, null, 2) + '\n');
  writeFileSync(join(output, 'release-notice-audit.md'), auditMarkdown(audit));
  console.log(`Audited ${audit.coordinates.length} archives for ${audit.candidate.packageVersion}; wrote ${portablePath(output, repo)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
