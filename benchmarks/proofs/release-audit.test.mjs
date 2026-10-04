import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {gunzipSync, gzipSync} from 'node:zlib';
import {auditMarkdown, createAudit, readArchive, selectRun, targets} from './release-audit.mjs';

const head = 'a'.repeat(40);
const source = 'b'.repeat(40);
const repository = 'Binary-Balance/seshat';
const ref = 'refs/pull/42/merge';
const hash = data => createHash('sha256').update(data).digest('hex');
const record = path => ({bytes: readFileSync(path).length, sha256: hash(readFileSync(path))});
const json = path => JSON.parse(readFileSync(path));
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const duplicateDependencies = [{name: 'duplicate', version: '1.0.0', license: 'MIT'}, {name: 'duplicate', version: '2.0.0', license: 'MIT'}];
const currentDependencies = [{name: 'shared', version: '2.0.0', license: 'MIT'}, {name: 'added', version: '1.0.0', license: 'MIT'}, ...duplicateDependencies];
const previousDependencies = [{name: 'shared', version: '1.0.0', license: 'MIT'}, {name: 'removed', version: '1.0.0', license: 'MIT'}, ...duplicateDependencies];

function pack(directory, archive, files) {
  execFileSync(process.platform === 'win32' ? 'tar.exe' : 'tar',
    ['--format=ustar', '-czf', archive, '-C', directory, ...files.map(path => `package/${path}`)]);
}
function filesAt(directory, values) {
  for (const [path, data] of Object.entries(values)) {
    const file = join(directory, 'package', path);
    mkdirSync(join(file, '..'), {recursive: true});
    writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
    chmodSync(file, path.startsWith('bin/') ? 0o755 : 0o644);
  }
}
function buildFor(target, {previous = false} = {}) {
  const binary = `fixture binary ${target.target}`;
  const notice = previous ? 'previous notice\n' : 'current notice\n';
  const build = {
    schemaVersion: 1, package: `@binary-balance/seshat-${target.target}`,
    packageVersion: previous ? '0.8.0' : '0.9.0', target: target.triple,
    sourceCommit: source, rust: previous ? 'rustc 1.1.0' : 'rustc 1.2.0',
    cargoLockSha256: 'c'.repeat(64), binarySha256: hash(binary), binaryBytes: Buffer.byteLength(binary),
    dependencies: previous ? previousDependencies : currentDependencies,
    runtimeNotices: {
      rustcVersion: previous ? '1.1.0' : '1.2.0', rustCommit: 'd'.repeat(40),
      noticeSha256: hash(notice), noticeBytes: Buffer.byteLength(notice),
      assets: [{path: 'LICENSE.txt', bytes: 5, sha256: (previous ? 'e' : 'f').repeat(64)}],
    },
  };
  return {binary, notice, build};
}

function fixture(root) {
  const evidence = join(root, 'native-evidence');
  const runs = new Map();
  const manifest = {
    name: '@binary-balance/seshat', version: '0.9.0', bin: {seshat: 'bin/seshat.mjs'},
    optionalDependencies: Object.fromEntries(targets.map(value => [`@binary-balance/seshat-${value.target}`, '0.9.0'])),
  };
  for (const [index, target] of targets.entries()) {
    const directory = join(evidence, target.target);
    mkdirSync(directory, {recursive: true});
    const runId = index + 1;
    const run = {id: runId, status: 'completed', conclusion: 'success', head_sha: head, run_attempt: 1,
      name: target.workflow, path: `.github/workflows/${target.workflow}`, html_url: `https://github.com/${repository}/actions/runs/${runId}`};
    const provenance = {repository, ref, sourceCommit: source, workflowSha: source,
      workflow: run.name, workflowRef: `${repository}/${run.path}@${ref}`, job: 'package', runId: String(runId), runAttempt: '1'};
    const nativeStage = join(directory, 'native-stage');
    const {binary, notice, build} = buildFor(target);
    filesAt(nativeStage, {
      'BUILD.json': build, 'LICENSE': 'fixture license', 'README.md': 'native fixture',
      'THIRD_PARTY_NOTICES.txt': notice, [target.binary.slice(8)]: binary,
      'package.json': {name: build.package, version: build.packageVersion, os: [target.target.split('-')[0]], cpu: [target.target.split('-')[1]]},
    });
    if (target.target === 'win32-x64') chmodSync(join(nativeStage, target.binary), 0o644);
    const files = ['BUILD.json', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.txt', target.binary.slice(8), 'package.json'];
    const nativeArchive = join(directory, `seshat-${target.target}-release.tgz`);
    pack(nativeStage, nativeArchive, files);
    const entryStage = join(directory, 'entry-stage');
    filesAt(entryStage, {'LICENSE': 'fixture license', 'README.md': 'entry fixture', 'bin/seshat.mjs': '#!/usr/bin/env node\n', 'package.json': manifest});
    const entryArchive = join(directory, 'seshat-entry.tgz');
    pack(entryStage, entryArchive, ['LICENSE', 'README.md', 'bin/seshat.mjs', 'package.json']);
    writeJson(join(directory, 'summary.json'), {
      kind: `seshat-${target.target}-package-proof`, sourceCommit: source, node: '24.20.0',
      validation: {passed: true}, preflight: {provenance, validation: {passed: true}},
      artifacts: {releaseNativeArchive: record(nativeArchive), entryArchive: record(entryArchive), binary: {sha256: hash(binary), bytes: Buffer.byteLength(binary)}},
    });
    runs.set(runId, {run, jobs: [{name: 'package', id: runId * 10, html_url: `${run.html_url}/job/1`, conclusion: 'success'}],
      artifacts: [{name: target.artifact, id: runId * 100, url: `https://api.github.com/repos/${repository}/actions/artifacts/${runId * 100}`, size_in_bytes: 1000,
        digest: `sha256:${'c'.repeat(64)}`, created_at: '2026-10-01T00:00:00Z', expires_at: '2027-01-01T00:00:00Z', expired: false}]});
  }
  const runtime = join(evidence, 'windows-runtime');
  mkdirSync(join(runtime, 'windows-runtime-preflight'), {recursive: true});
  mkdirSync(join(runtime, 'windows-runtime-cli-evidence'));
  const run = {id: 6, run_attempt: 1, status: 'completed', conclusion: 'success', head_sha: head,
    path: '.github/workflows/windows-runtime.yml', name: 'Windows runtime', html_url: `https://github.com/${repository}/actions/runs/6`};
  writeJson(join(runtime, 'windows-runtime-preflight/windows-runtime-preflight.json'), {
    validation: {passed: true}, provenance: {repository, ref, sourceCommit: source, workflowSha: source, workflow: run.name,
      workflowRef: `${repository}/${run.path}@${ref}`, job: 'runtime', runId: '6', runAttempt: '1'},
  });
  writeJson(join(runtime, 'windows-runtime-cli-evidence/windows-runtime-cli-evidence.json'), {
    kind: 'seshat-windows-runtime-cli', validation: {passed: true}, binary: {bytes: 100, sha256: 'b'.repeat(64)},
    scenarios: Object.fromEntries(['baseline', 'timeout', 'overflow', 'leaderExit', 'leaderExitRepeat', 'consoleCancellation'].map(name => [name, {}])),
  });
  runs.set(6, {run, jobs: [{name: 'runtime', conclusion: 'success'}], artifacts: ['windows-runtime-cli-evidence', 'windows-runtime-preflight'].map(name => ({name, id: 600, size_in_bytes: 100}))});
  const previousStage = join(root, 'previous-stage');
  const {binary, notice, build} = buildFor(targets[0], {previous: true});
  filesAt(previousStage, {'BUILD.json': build, 'THIRD_PARTY_NOTICES.txt': notice, 'bin/seshat': binary});
  const previousArchivePath = join(root, 'previous.tgz');
  pack(previousStage, previousArchivePath, ['BUILD.json', 'THIRD_PARTY_NOTICES.txt', 'bin/seshat']);
  const previousAuditPath = join(root, 'previous-audit.json');
  writeJson(previousAuditPath, {kind: 'seshat-release-notice-audit', schemaVersion: 1,
    candidate: {packageVersion: '0.8.0'}, targets: [{target: 'linux-x64', build}],
    coordinates: [{target: 'linux-x64', archiveBytes: record(previousArchivePath).bytes, archiveSha256: record(previousArchivePath).sha256,
      buildProvenance: {dependencyInventory: {sha256: hash(JSON.stringify(build.dependencies))},
        notice: readArchive(previousArchivePath).find(value => value.path === 'package/THIRD_PARTY_NOTICES.txt')}}]});
  return {evidence, repo: root, head, previousArchivePath, previousAuditPath, runs,
    runFor: id => runs.get(id), tree: (_commit, path) => String(sourcePaths.indexOf(path) + 1).repeat(40)};
}
const sourcePaths = ['crates', 'packages', 'packaging'];

function repackNative(options, target = targets[0]) {
  const directory = join(options.evidence, target.target);
  const archive = join(directory, `seshat-${target.target}-release.tgz`);
  pack(join(directory, 'native-stage'), archive, ['BUILD.json', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.txt', target.binary.slice(8), 'package.json']);
  const summaryPath = join(directory, 'summary.json');
  const summary = json(summaryPath); summary.artifacts.releaseNativeArchive = record(archive); writeJson(summaryPath, summary);
}

test('fixture archives produce six consumer coordinates and factual release differences', () => {
  const root = mkdtempSync(join(tmpdir(), 'seshat-audit-'));
  try {
    const options = fixture(root);
    const audit = createAudit(options);
    assert.equal(audit.coordinates.length, 6);
    assert.equal(audit.candidate.pullRequestUrl, `https://github.com/${repository}/pull/42`);
    assert.equal(audit.dependencyReview.dependenciesMatchBaseline, false);
    assert.equal(audit.dependencyReview.runtimeNoticeAssetsMatchBaseline, false);
    assert.equal(audit.dependencyReview.rustToolchainMatchesBaseline, false);
    assert.deepEqual(audit.dependencyReview.differences.dependencies.entries, {
      added: [currentDependencies[1]], removed: [previousDependencies[1]],
      changed: [{previous: previousDependencies[0], current: currentDependencies[0]}],
    });
    assert.match(auditMarkdown(audit), /\| Dependencies \| 1 \| 1 \| 1 \|/);
    assert.match(auditMarkdown(audit), /Notice bytes changed/);
    assert.equal(createAudit({...options, previousArchivePath: null}).dependencyReview.dependenciesMatchBaseline, false);
    assert.equal(createAudit({...options, previousAuditPath: null}).dependencyReview.baseline, '0.8.0');
    const previousAudit = json(options.previousAuditPath);
    previousAudit.targets[0].build.runtimeNotices.assets = buildFor(targets[0]).build.runtimeNotices.assets.map(value => ({...value, role: 'historical review note'}));
    writeJson(options.previousAuditPath, previousAudit);
    assert.equal(createAudit({...options, previousArchivePath: null}).dependencyReview.runtimeNoticeAssetsMatchBaseline, true);
    delete previousAudit.targets[0].build.dependencies;
    delete previousAudit.targets[0].build.runtimeNotices.assets;
    writeJson(options.previousAuditPath, previousAudit);
    const compactReview = createAudit({...options, previousArchivePath: null}).dependencyReview;
    assert.equal(compactReview.dependenciesMatchBaseline, false);
    assert.equal(compactReview.differences.dependencies.entries, null);
    assert.equal(compactReview.runtimeNoticeAssetsMatchBaseline, null);
    previousAudit.coordinates[0].buildProvenance.dependencyInventory.sha256 = hash(JSON.stringify(currentDependencies.map(value =>
      Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))))));
    writeJson(options.previousAuditPath, previousAudit);
    assert.equal(createAudit({...options, previousArchivePath: null}).dependencyReview.dependenciesMatchBaseline, true);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('rejects independent mismatches rather than trusting passed proof flags', () => {
  const cases = [
    ['BUILD binary hash', options => {
      const path = join(options.evidence, 'linux-x64/native-stage/package/BUILD.json');
      const value = json(path); value.binarySha256 = '0'.repeat(64); writeJson(path, value); repackNative(options);
    }, /BUILD.json binary hash differs/],
    ['summary binary hash', options => {
      const path = join(options.evidence, 'linux-x64/summary.json'); const value = json(path);
      value.artifacts.binary.sha256 = '0'.repeat(64); writeJson(path, value);
    }, /summary binary hash differs/],
    ['summary archive hash', options => {
      const path = join(options.evidence, 'linux-x64/summary.json'); const value = json(path);
      value.artifacts.releaseNativeArchive.sha256 = '0'.repeat(64); writeJson(path, value);
    }, /summary archive hash differs/],
    ['summary binary size', options => {
      const path = join(options.evidence, 'linux-x64/summary.json'); const value = json(path);
      value.artifacts.binary.bytes++; writeJson(path, value);
    }, /summary binary size differs/],
    ['BUILD source', options => {
      const path = join(options.evidence, 'linux-x64/native-stage/package/BUILD.json');
      const value = json(path); value.sourceCommit = head; writeJson(path, value); repackNative(options);
    }, /BUILD.json source commit differs/],
    ['notice bytes', options => {
      writeFileSync(join(options.evidence, 'linux-x64/native-stage/package/THIRD_PARTY_NOTICES.txt'), 'tampered notice\n'); repackNative(options);
    }, /notice size differs|notice hash differs/],
    ['binary mode', options => {
      chmodSync(join(options.evidence, 'linux-x64/native-stage/package/bin/seshat'), 0o644); repackNative(options);
    }, /binary mode differs/],
    ['manifest identity', options => {
      const path = join(options.evidence, 'linux-x64/native-stage/package/package.json');
      const value = json(path); value.name = 'other-package'; writeJson(path, value); repackNative(options);
    }, /package identity differs/],
    ['source commit', options => {
      const path = join(options.evidence, 'linux-arm64/summary.json'); const value = json(path);
      value.sourceCommit = value.preflight.provenance.sourceCommit = value.preflight.provenance.workflowSha = 'f'.repeat(40); writeJson(path, value);
    }, /source commit differs/],
    ['run head', options => { options.runs.get(1).run.head_sha = '0'.repeat(40); }, /run head differs/],
    ['failed job', options => { options.runs.get(1).jobs[0].conclusion = 'failure'; }, /job did not succeed/],
    ['run attempt', options => { options.runs.get(1).run.run_attempt = 2; }, /run attempt differs/],
    ['preflight validation', options => {
      const path = join(options.evidence, 'linux-x64/summary.json'); const value = json(path);
      value.preflight.validation.passed = false; writeJson(path, value);
    }, /preflight failed/],
    ['entry bytes', options => {
      const directory = join(options.evidence, 'linux-arm64');
      writeFileSync(join(directory, 'entry-stage/package/README.md'), 'tampered entry');
      const archive = join(directory, 'seshat-entry.tgz'); pack(join(directory, 'entry-stage'), archive, ['LICENSE', 'README.md', 'bin/seshat.mjs', 'package.json']);
      const path = join(directory, 'summary.json'); const value = json(path); value.artifacts.entryArchive = record(archive); writeJson(path, value);
    }, /entry member bytes differ/],
    ['runtime validation', options => {
      const path = join(options.evidence, 'windows-runtime/windows-runtime-cli-evidence/windows-runtime-cli-evidence.json');
      const value = json(path); value.validation.passed = false; writeJson(path, value);
    }, /Windows runtime validation failed/],
    ['previous archive mismatch', options => {
      const value = json(options.previousAuditPath); value.coordinates[0].archiveSha256 = '0'.repeat(64); writeJson(options.previousAuditPath, value);
    }, /previous archive hash differs/],
    ...sourcePaths.map(path => [`${path} tree`, options => {
      const original = options.tree; options.tree = (commit, name) => commit === head && name === path ? 'f'.repeat(40) : original(commit, name);
    }, new RegExp(`${path}: PR head tree differs`)]),
  ];
  const root = mkdtempSync(join(tmpdir(), 'seshat-audit-negative-'));
  try {
    const original = fixture(join(root, 'original'));
    for (const [index, [name, mutate, expected]] of cases.entries()) {
      const directory = join(root, String(index)); cpSync(join(root, 'original'), directory, {recursive: true});
      const options = {...original, repo: directory, evidence: join(directory, 'native-evidence'),
        previousArchivePath: join(directory, 'previous.tgz'), previousAuditPath: join(directory, 'previous-audit.json'), runs: structuredClone(original.runs)};
      options.runFor = id => options.runs.get(id);
      mutate(options);
      assert.throws(() => createAudit(options), expected, name);
    }
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('rejects duplicate archive members, corrupt headers and unsafe tar members', () => {
  const root = mkdtempSync(join(tmpdir(), 'seshat-audit-tar-'));
  try {
    filesAt(root, {'LICENSE': 'fixture'});
    const archive = join(root, 'malformed.tgz'); pack(root, archive, ['LICENSE']);
    const tar = gunzipSync(readFileSync(archive));
    writeFileSync(archive, gzipSync(Buffer.concat([tar.subarray(0, 1024), tar])));
    assert.throws(() => readArchive(archive), /duplicate archive member/);
    const corrupt = Buffer.from(tar); corrupt[100] = 49;
    writeFileSync(archive, gzipSync(corrupt));
    assert.throws(() => readArchive(archive), /header checksum differs/);
    for (const [name, mutate, expected] of [
      ['parent traversal', bytes => { bytes.fill(0, 0, 100); bytes.write('package/../escape', 0); }, /path escapes package/],
      ['symlink', bytes => { bytes[156] = 50; }, /must be a regular file/],
    ]) {
      const bytes = Buffer.from(tar); mutate(bytes); bytes.fill(32, 148, 156);
      const checksum = [...bytes.subarray(0, 512)].reduce((sum, byte) => sum + byte, 0);
      bytes.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
      writeFileSync(archive, gzipSync(bytes));
      assert.throws(() => readArchive(archive), expected, name);
    }
    writeFileSync(archive, 'not a gzip archive');
    assert.throws(() => readArchive(archive));
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('selects the latest successful matching workflow and refuses missing evidence', () => {
  const good = {id: 1, path: '.github/workflows/linux-x64-package.yml', status: 'completed', conclusion: 'success', head_sha: head};
  assert.equal(selectRun([good, {...good, id: 2, head_sha: source}, {...good, id: 3, conclusion: 'failure'}, {...good, id: 4}], 'linux-x64-package.yml', head).id, 4);
  assert.throws(() => selectRun([good], 'windows-runtime.yml', head), /no successful windows-runtime.yml run/);
});
