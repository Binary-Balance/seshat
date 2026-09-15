import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
const repo = invoked
  ? execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim()
  : process.cwd();
const {values} = invoked ? parseArgs({
  args: process.argv.slice(2),
  allowPositionals: false,
  options: {
    manifest: {type: 'string'},
    output: {type: 'string'},
    evidence: {type: 'string'},
    target: {type: 'string'},
  },
}) : {values: {}};

const manifestPath = resolve(values.manifest ?? join(repo, 'docs/research/release-notice-audit.json'));
const output = resolve(values.output ?? join(repo, 'work/release-local-archives'));
const evidencePath = resolve(values.evidence ?? join(dirname(output), 'archive-staging.json'));
let downloadRoot = null;

const targets = new Map([
  ['universal', {file: 'entry.tgz', package: '@binary-balance/seshat', role: 'entry'}],
  ['linux-x64', {file: 'linux-x64.tgz', package: '@binary-balance/seshat-linux-x64', role: 'native-release'}],
  ['linux-arm64', {file: 'linux-arm64.tgz', package: '@binary-balance/seshat-linux-arm64', role: 'native-release'}],
  ['darwin-x64', {file: 'darwin-x64.tgz', package: '@binary-balance/seshat-darwin-x64', role: 'native-release'}],
  ['darwin-arm64', {file: 'darwin-arm64.tgz', package: '@binary-balance/seshat-darwin-arm64', role: 'native-release'}],
  ['win32-x64', {file: 'win32-x64.tgz', package: '@binary-balance/seshat-win32-x64', role: 'native-release'}],
]);

const hostTargets = new Map([
  ['linux-x64', ['linux', 'x64']],
  ['linux-arm64', ['linux', 'arm64']],
  ['darwin-x64', ['darwin', 'x64']],
  ['darwin-arm64', ['darwin', 'arm64']],
  ['win32-x64', ['win32', 'x64']],
]);

const sourcePaths = Object.freeze(['crates', 'packages', 'packaging']);
const fullShaPattern = /^[\da-f]{40}$/i;

const report = {
  schemaVersion: 1,
  kind: 'seshat-release-local-archive-staging',
  capturedAt: new Date().toISOString(),
  manifest: manifestPath.startsWith(`${repo}/`) ? manifestPath.slice(repo.length + 1) : basename(manifestPath),
  host: {
    expectedTarget: values.target ?? null,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    npm: null,
    runner: process.env.RUNNER_NAME ?? null,
    runnerOs: process.env.RUNNER_OS ?? null,
    runnerArch: process.env.RUNNER_ARCH ?? null,
    repository: process.env.GITHUB_REPOSITORY ?? null,
    workflow: process.env.GITHUB_WORKFLOW ?? null,
    job: process.env.GITHUB_JOB ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
  },
  candidate: null,
  coordinates: [],
  sourceEquivalence: null,
  archives: [],
  validation: {passed: false, error: null},
};

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

try {
  report.host.npm = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  }).trim();
} catch {
  report.host.npm = null;
}

function writeEvidence() {
  mkdirSync(dirname(evidencePath), {recursive: true});
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
}

function portableError(error) {
  return [repo, manifestPath, output, evidencePath, downloadRoot].filter(Boolean).reduce(
    (message, path) => message.replaceAll(path, '<path>'), String(error));
}

function git(command, args) {
  return execFileSync('git', [command, ...args], {cwd: repo, encoding: 'utf8'}).trim();
}

function validateHost() {
  if (!values.target) return;
  const expected = hostTargets.get(values.target);
  assert.ok(expected, `unknown host target: ${values.target}`);
  assert.deepEqual([process.platform, process.arch], expected,
    `runner host does not match ${values.target}: ${process.platform}/${process.arch}`);
}

export function validateSourceTrees(sourceTrees, label = 'candidate source trees') {
  assert.ok(sourceTrees && typeof sourceTrees === 'object' && !Array.isArray(sourceTrees),
    `${label} must be an object`);
  assert.deepEqual(Object.keys(sourceTrees).sort(), [...sourcePaths].sort(),
    `${label} must contain exactly crates, packages, packaging`);
  for (const path of sourcePaths) {
    assert.match(sourceTrees[path] ?? '', fullShaPattern,
      `${label}.${path} must be a full Git tree SHA`);
  }
  return sourceTrees;
}

export function assertSourceTreeEquivalence(sourceTrees, checkoutTrees) {
  validateSourceTrees(sourceTrees);
  validateSourceTrees(checkoutTrees, 'checkout source trees');
  const changed = sourcePaths.filter(path => sourceTrees[path] !== checkoutTrees[path]);
  assert.deepEqual(changed, [], `candidate source trees differ from checkout: ${changed.join(', ')}`);
  return changed;
}

function validateManifest(manifest) {
  assert.equal(manifest.schemaVersion, 1, 'release audit schema must be version 1');
  assert.equal(manifest.kind, 'seshat-release-notice-audit', 'release audit kind is invalid');
  const candidate = manifest.candidate;
  assert.match(candidate?.sourceCommit ?? '', /^[\da-f]{40}$/i, 'candidate source commit is invalid');
  if (candidate?.sourceTrees !== undefined) validateSourceTrees(candidate.sourceTrees);
  assert.match(candidate?.packageVersion ?? '', /^\S+$/, 'candidate package version is missing');
  assert.ok(Array.isArray(manifest.coordinates), 'release audit coordinates are missing');
  assert.equal(manifest.coordinates.length, targets.size, 'release audit must contain six coordinates');

  const seenTargets = new Set();
  const seenArchivePaths = new Set();
  const coordinates = manifest.coordinates.map(coordinate => {
    const expected = targets.get(coordinate.target);
    assert.ok(expected, `unexpected release target: ${coordinate.target}`);
    assert.equal(seenTargets.has(coordinate.target), false, `duplicate release target: ${coordinate.target}`);
    seenTargets.add(coordinate.target);
    assert.equal(coordinate.role, expected.role, `${coordinate.target}: coordinate role is invalid`);
    assert.equal(coordinate.canonical, true, `${coordinate.target}: coordinate is not canonical`);
    assert.equal(coordinate.package, expected.package, `${coordinate.target}: package identity is invalid`);
    assert.equal(coordinate.version, candidate.packageVersion, `${coordinate.target}: package version differs`);
    assert.equal(coordinate.archivePath, coordinate.archiveFile,
      `${coordinate.target}: archive path and file differ`);
    assert.match(coordinate.archivePath ?? '', /^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/,
      `${coordinate.target}: archive path must be a direct member basename`);
    assert.equal(seenArchivePaths.has(coordinate.archivePath), false,
      `${coordinate.target}: archive path is duplicated`);
    seenArchivePaths.add(coordinate.archivePath);
    assert.ok(Number.isInteger(coordinate.runId) && coordinate.runId > 0,
      `${coordinate.target}: run id is invalid`);
    assert.match(coordinate.artifactName ?? '', /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
      `${coordinate.target}: artifact name is invalid`);
    assert.ok(Number.isInteger(coordinate.archiveBytes) && coordinate.archiveBytes > 0,
      `${coordinate.target}: archive size is invalid`);
    assert.match(coordinate.archiveSha256 ?? '', /^[\da-f]{64}$/i,
      `${coordinate.target}: archive hash is invalid`);
    assert.equal(coordinate.buildProvenance?.sourceCommit, candidate.sourceCommit,
      `${coordinate.target}: artifact source commit differs from candidate`);
    return coordinate;
  });
  assert.deepEqual([...seenTargets].sort(), [...targets.keys()].sort(), 'release target set is incomplete');
  return {candidate, coordinates};
}

function ensureCandidateCommit(sourceCommit) {
  try {
    git('cat-file', ['-e', `${sourceCommit}^{commit}`]);
  } catch {
    // A pull-request checkout may omit the older candidate merge commit.
    execFileSync('git', ['fetch', '--no-tags', 'origin', sourceCommit], {cwd: repo, stdio: 'inherit'});
  }
  git('cat-file', ['-e', `${sourceCommit}^{commit}`]);
}

function checkSourceEquivalence(sourceCommit, sourceTrees) {
  const checkoutCommit = git('rev-parse', ['HEAD']);
  if (sourceTrees !== undefined) {
    const checkoutTrees = Object.fromEntries(sourcePaths.map(path => [path,
      git('rev-parse', [`HEAD:${path}`])]));
    assertSourceTreeEquivalence(sourceTrees, checkoutTrees);
    return {
      candidateCommit: sourceCommit,
      checkoutCommit,
      paths: sourcePaths,
      changed: [],
      sourceTrees,
    };
  }
  ensureCandidateCommit(sourceCommit);
  const changed = git('diff', ['--name-only', sourceCommit, checkoutCommit, '--', 'crates', 'packages', 'packaging']);
  assert.equal(changed, '', `candidate source inputs differ from checkout:\n${changed}`);
  return {
    candidateCommit: sourceCommit,
    checkoutCommit,
    paths: sourcePaths,
    changed: [],
  };
}

function downloadGroups(coordinates) {
  assert.ok(process.env.GH_TOKEN, 'GH_TOKEN is required for read-only artifact downloads');
  const repository = process.env.GITHUB_REPOSITORY ?? 'Binary-Balance/seshat';
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'GITHUB_REPOSITORY is invalid');
  const root = mkdtempSync(join(tmpdir(), 'seshat-release-artifacts-'));
  downloadRoot = root;
  const groups = new Map();
  for (const coordinate of coordinates) {
    const key = `${coordinate.runId}/${coordinate.artifactName}`;
    // Entry/Linux x64 share one artifact; macOS coordinates share a run.
    if (groups.has(key)) continue;
    const directory = join(root, String(groups.size));
    mkdirSync(directory);
    execFileSync('gh', [
      'run', 'download', String(coordinate.runId),
      '--repo', repository,
      '--name', coordinate.artifactName,
      '--dir', directory,
    ], {cwd: repo, env: process.env, stdio: 'inherit'});
    groups.set(key, directory);
  }
  return {root, groups};
}

function stageArchives(coordinates, groups) {
  mkdirSync(output, {recursive: true});
  assert.deepEqual(readdirSync(output), [], `archive output must be empty: ${output}`);
  for (const coordinate of coordinates) {
    const expected = targets.get(coordinate.target);
    const sourceDirectory = groups.get(`${coordinate.runId}/${coordinate.artifactName}`);
    assert.ok(sourceDirectory, `${coordinate.target}: source artifact was not downloaded`);
    // A stale work-prefixed audit path must fail; never search recursively.
    const sourcePath = resolve(sourceDirectory, coordinate.archivePath);
    assert.equal(sourcePath, join(sourceDirectory, coordinate.archivePath),
      `${coordinate.target}: archive path escaped the artifact directory`);
    assert.equal(lstatSync(sourcePath).isFile(), true,
      `${coordinate.target}: direct archive member is missing: ${coordinate.archivePath}`);
    const bytes = statSync(sourcePath).size;
    const hash = sha256(sourcePath);
    assert.equal(bytes, coordinate.archiveBytes, `${coordinate.target}: archive size differs from manifest`);
    assert.equal(hash, coordinate.archiveSha256, `${coordinate.target}: archive hash differs from manifest`);

    const destination = join(output, expected.file);
    copyFileSync(sourcePath, destination);
    assert.equal(statSync(destination).size, bytes, `${coordinate.target}: staged archive size changed`);
    assert.equal(sha256(destination), hash, `${coordinate.target}: staged archive hash changed`);
    report.archives.push({
      target: coordinate.target,
      role: coordinate.role,
      file: expected.file,
      bytes,
      sha256: hash,
      source: {
        runId: coordinate.runId,
        artifactName: coordinate.artifactName,
        archivePath: coordinate.archivePath,
      },
    });
  }
  assert.deepEqual(readdirSync(output).sort(), [...targets.values()].map(target => target.file).sort(),
    'archive output contains an unexpected file set');
}

function main() {
  validateHost();
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const {candidate, coordinates} = validateManifest(manifest);
  report.candidate = {
    packageVersion: candidate.packageVersion,
    sourceCommit: candidate.sourceCommit,
    sourceTrees: candidate.sourceTrees ?? null,
    sourceRef: candidate.sourceRef ?? null,
  };
  report.coordinates = coordinates.map(coordinate => ({
    id: coordinate.id,
    role: coordinate.role,
    target: coordinate.target,
    runId: coordinate.runId,
    runUrl: coordinate.runUrl ?? null,
    artifactName: coordinate.artifactName,
    archivePath: coordinate.archivePath,
    archiveFile: coordinate.archiveFile,
    archiveBytes: coordinate.archiveBytes,
    archiveSha256: coordinate.archiveSha256,
    buildProvenance: coordinate.buildProvenance ?? null,
  }));
  report.sourceEquivalence = checkSourceEquivalence(candidate.sourceCommit, candidate.sourceTrees);
  const downloads = downloadGroups(coordinates);
  try {
    stageArchives(coordinates, downloads.groups);
  } finally {
    rmSync(downloads.root, {recursive: true, force: true});
  }
  report.validation = {passed: true, error: null};
  writeEvidence();
  const hostTarget = values.target ?? `${process.platform}-${process.arch}`;
  console.log(`Staged ${report.archives.length} candidate archives for ${hostTarget}.`);
}

if (invoked) {
  try {
    main();
  } catch (error) {
    report.validation = {passed: false, error: portableError(error)};
    writeEvidence();
    console.error(report.validation.error);
    process.exitCode = 1;
  }
}
