import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

export const REGISTRY = 'https://registry.npmjs.org/';
const SCOPE_REGISTRY = `--@binary-balance:registry=${REGISTRY}`;

export const PACKAGE_ORDER = Object.freeze([
  {target: 'linux-x64', file: 'linux-x64.tgz', package: '@binary-balance/seshat-linux-x64', role: 'native-release'},
  {target: 'linux-arm64', file: 'linux-arm64.tgz', package: '@binary-balance/seshat-linux-arm64', role: 'native-release'},
  {target: 'darwin-x64', file: 'darwin-x64.tgz', package: '@binary-balance/seshat-darwin-x64', role: 'native-release'},
  {target: 'darwin-arm64', file: 'darwin-arm64.tgz', package: '@binary-balance/seshat-darwin-arm64', role: 'native-release'},
  {target: 'win32-x64', file: 'win32-x64.tgz', package: '@binary-balance/seshat-win32-x64', role: 'native-release'},
  {target: 'universal', file: 'entry.tgz', package: '@binary-balance/seshat', role: 'entry'},
]);

const targetByName = new Map(PACKAGE_ORDER.map(target => [target.target, target]));
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertVersion(version) {
  const match = semverPattern.exec(version ?? '');
  assert.ok(match, `version is not valid semver: ${version}`);
  for (const identifier of match[4]?.split('.') ?? []) {
    if (/^\d+$/.test(identifier)) assert.ok(identifier === '0' || !identifier.startsWith('0'),
      `version has a leading-zero prerelease identifier: ${version}`);
  }
  return {version, prerelease: Boolean(match[4])};
}

export function expectedTag(version) {
  return assertVersion(version).prerelease ? 'next' : 'latest';
}

function validateManifest(manifest, version) {
  assert.equal(manifest.schemaVersion, 1, 'release audit schema must be version 1');
  assert.equal(manifest.kind, 'seshat-release-notice-audit', 'release audit kind is invalid');
  assert.equal(manifest.candidate?.packageVersion, version, 'candidate version differs from requested version');
  assert.match(manifest.candidate?.sourceCommit ?? '', /^[\da-f]{40}$/i, 'candidate source commit is invalid');
  assert.ok(Array.isArray(manifest.coordinates), 'release audit coordinates are missing');
  assert.equal(manifest.coordinates.length, PACKAGE_ORDER.length, 'release audit must contain six coordinates');

  const coordinates = new Map();
  for (const coordinate of manifest.coordinates) {
    const expected = targetByName.get(coordinate.target);
    assert.ok(expected, `unexpected release target: ${coordinate.target}`);
    assert.equal(coordinates.has(coordinate.target), false, `duplicate release target: ${coordinate.target}`);
    assert.equal(coordinate.canonical, true, `${coordinate.target}: coordinate is not canonical`);
    assert.equal(coordinate.role, expected.role, `${coordinate.target}: coordinate role is invalid`);
    assert.equal(coordinate.package, expected.package, `${coordinate.target}: package identity is invalid`);
    assert.equal(coordinate.version, version, `${coordinate.target}: package version differs`);
    assert.equal(coordinate.archivePath, coordinate.archiveFile,
      `${coordinate.target}: archive path and file differ`);
    assert.equal(coordinate.archiveFile, expected.target === 'universal'
      ? 'seshat-entry.tgz' : `seshat-${expected.target}-release.tgz`,
    `${coordinate.target}: archive file is not the canonical release archive`);
    assert.match(coordinate.archiveFile ?? '', /^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/,
      `${coordinate.target}: archive file must be a direct member basename`);
    assert.ok(Number.isInteger(coordinate.archiveBytes) && coordinate.archiveBytes > 0,
      `${coordinate.target}: archive size is invalid`);
    assert.match(coordinate.archiveSha256 ?? '', /^[\da-f]{64}$/i,
      `${coordinate.target}: archive hash is invalid`);
    coordinates.set(coordinate.target, coordinate);
  }
  assert.deepEqual([...coordinates.keys()].sort(), [...targetByName.keys()].sort(),
    'release target set is incomplete');
  return {candidate: manifest.candidate, coordinates};
}

function validateStagingEvidence(evidence, candidate, coordinates, revision) {
  assert.equal(evidence.kind, 'seshat-release-local-archive-staging',
    'archive staging evidence kind is invalid');
  assert.equal(evidence.validation?.passed, true, 'archive staging did not pass');
  assert.equal(evidence.candidate?.packageVersion, candidate.packageVersion,
    'staging candidate version differs from audit');
  assert.equal(evidence.candidate?.sourceCommit, candidate.sourceCommit,
    'staging candidate source commit differs from audit');
  assert.equal(evidence.sourceEquivalence?.candidateCommit, candidate.sourceCommit,
    'staging source equivalence uses a different candidate commit');
  assert.equal(evidence.sourceEquivalence?.checkoutCommit, revision,
    'staging source equivalence does not cover the reviewed revision');
  assert.deepEqual(evidence.sourceEquivalence?.paths, ['crates', 'packages', 'packaging'],
    'staging source equivalence paths changed');
  assert.ok(Array.isArray(evidence.archives), 'staged archive records are missing');
  assert.equal(evidence.archives.length, PACKAGE_ORDER.length, 'staging evidence is not a full archive set');

  const seen = new Set();
  for (const archive of evidence.archives) {
    const expected = targetByName.get(archive.target);
    const coordinate = coordinates.get(archive.target);
    assert.ok(expected, `staging evidence has unexpected target: ${archive.target}`);
    assert.equal(seen.has(archive.target), false, `staging evidence duplicates ${archive.target}`);
    assert.equal(archive.file, expected.file, `${archive.target}: staged filename differs`);
    assert.equal(archive.bytes, coordinate.archiveBytes, `${archive.target}: staged size differs`);
    assert.equal(archive.sha256, coordinate.archiveSha256, `${archive.target}: staged hash differs`);
    seen.add(archive.target);
  }
  assert.deepEqual([...seen].sort(), [...targetByName.keys()].sort(),
    'staging evidence is missing a release target');
}

function readArchives(archiveDir, coordinates) {
  const expectedFiles = PACKAGE_ORDER.map(target => target.file).sort();
  assert.deepEqual(readdirSync(archiveDir).sort(), expectedFiles,
    'archive directory must contain exactly the six canonical archives');

  return PACKAGE_ORDER.map(target => {
    const coordinate = coordinates.get(target.target);
    const path = join(archiveDir, target.file);
    assert.equal(lstatSync(path).isFile(), true, `${target.target}: archive is not a regular file`);
    const data = readFileSync(path);
    assert.equal(data.length, coordinate.archiveBytes, `${target.target}: archive size differs from audit`);
    const hash = sha256(data);
    assert.equal(hash, coordinate.archiveSha256, `${target.target}: archive hash differs from audit`);
    return {
      ...target,
      version: coordinate.version,
      path,
      bytes: data.length,
      sha256: hash,
      data,
    };
  });
}

export function buildPublicationPlan(manifest, {
  archiveDir,
  revision,
  version = manifest.candidate?.packageVersion,
  stagingEvidence = null,
} = {}) {
  assert.ok(archiveDir, 'archive directory is required');
  assert.match(revision ?? '', /^[\da-f]{40}$/i, 'reviewed revision must be a full commit SHA');
  const {candidate, coordinates} = validateManifest(manifest, version);
  assertVersion(version);
  if (stagingEvidence) validateStagingEvidence(stagingEvidence, candidate, coordinates, revision);
  const archives = readArchives(resolve(archiveDir), coordinates);
  return {
    revision,
    sourceCommit: candidate.sourceCommit,
    version,
    tag: expectedTag(version),
    registry: REGISTRY,
    archives,
  };
}

export function publishArgs(archive, {tag, dryRun = false} = {}) {
  const args = [archive.path, '--access=public', `--tag=${tag}`,
    `--registry=${REGISTRY}`, SCOPE_REGISTRY];
  if (dryRun) args.push('--dry-run');
  return args;
}

function responseOk(response) {
  return response.ok ?? (response.status >= 200 && response.status < 300);
}

function metadataUrl(packageName) {
  return `${REGISTRY}${encodeURIComponent(packageName)}`;
}

export async function inspectRegistry(archive, fetchImpl = globalThis.fetch) {
  assert.equal(typeof fetchImpl, 'function', 'fetch is required for registry checks');
  let response;
  try {
    response = await fetchImpl(metadataUrl(archive.package), {
      headers: {accept: 'application/vnd.npm.install-v1+json'},
    });
  } catch (error) {
    throw new Error(`registry request failed for ${archive.package}@${archive.version}: ${error.message}`);
  }
  if (response.status === 404) return {status: 'absent'};
  if (!responseOk(response)) {
    throw new Error(`registry metadata failed for ${archive.package}@${archive.version}: HTTP ${response.status}`);
  }

  let metadata;
  try {
    metadata = await response.json();
  } catch (error) {
    throw new Error(`registry metadata is invalid for ${archive.package}: ${error.message}`);
  }
  const versionInfo = metadata?.versions?.[archive.version];
  if (!versionInfo) return {status: 'absent'};
  if (versionInfo.name !== archive.package || versionInfo.version !== archive.version) {
    throw new Error(`registry metadata identity mismatch for ${archive.package}@${archive.version}`);
  }
  const tarball = versionInfo.dist?.tarball;
  if (typeof tarball !== 'string') {
    throw new Error(`registry archive URL is missing for ${archive.package}@${archive.version}`);
  }
  let tarballUrl;
  try {
    tarballUrl = new URL(tarball);
    assert.equal(tarballUrl.origin, new URL(REGISTRY).origin,
      'registry archive URL is outside the fixed npmjs registry');
  } catch (error) {
    throw new Error(`registry archive URL is invalid for ${archive.package}@${archive.version}: ${error.message}`);
  }

  let tarballResponse;
  try {
    tarballResponse = await fetchImpl(tarballUrl, {headers: {accept: 'application/octet-stream'}});
  } catch (error) {
    throw new Error(`registry archive download failed for ${archive.package}@${archive.version}: ${error.message}`);
  }
  if (!responseOk(tarballResponse)) {
    throw new Error(`registry archive download failed for ${archive.package}@${archive.version}: HTTP ${tarballResponse.status}`);
  }
  let data;
  try {
    data = Buffer.from(await tarballResponse.arrayBuffer());
  } catch (error) {
    throw new Error(`registry archive bytes could not be read for ${archive.package}@${archive.version}: ${error.message}`);
  }
  return {status: 'present', bytes: data.length, sha256: sha256(data), data};
}

export function registryDecision(archive, existing) {
  if (existing?.status === 'absent') return 'publish';
  assert.equal(existing?.status, 'present', `${archive.package}@${archive.version}: registry state is invalid`);
  if (Buffer.isBuffer(existing.data) && existing.bytes === archive.bytes &&
      existing.sha256 === archive.sha256 && Buffer.compare(existing.data, archive.data) === 0) return 'skip';
  throw new Error(`conflicting existing version ${archive.package}@${archive.version}: registry archive differs from ${archive.file}`);
}

async function inspectAll(plan, inspect) {
  const states = [];
  for (const archive of plan.archives) {
    const existing = await inspect(archive);
    states.push({archive, action: registryDecision(archive, existing)});
  }
  return states;
}

function npmCommand() {
  if (process.platform !== 'win32') return {command: 'npm', prefix: [], shell: false};
  return {
    command: process.execPath,
    prefix: [process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')],
    shell: false,
  };
}

function publishWithNpm(archive, plan) {
  const npm = npmCommand();
  try {
    execFileSync(npm.command, [...npm.prefix, 'publish', ...publishArgs(archive, {tag: plan.tag})], {
      cwd: process.cwd(),
      env: {...process.env},
      shell: npm.shell,
      stdio: 'inherit',
    });
  } catch (error) {
    throw new Error(`npm publish failed for ${archive.package}@${archive.version}: ${error.message}`);
  }
}

export async function executePublication(plan, {
  dryRun = true,
  inspect = archive => inspectRegistry(archive),
  publishPackage = (archive, currentPlan) => publishWithNpm(archive, currentPlan),
} = {}) {
  if (dryRun) {
    return {
      mode: 'dry-run',
      packages: plan.archives.map(archive => ({
        target: archive.target,
        package: archive.package,
        archive: archive.file,
        action: 'planned',
        argv: publishArgs(archive, {tag: plan.tag, dryRun: true}),
      })),
    };
  }

  // Complete this read-only pass before invoking npm for any package.
  const preflight = await inspectAll(plan, inspect);
  const packages = [];
  for (const state of preflight) {
    try {
      // Recheck immediately before each write so a retry never overwrites a race.
      const action = registryDecision(state.archive, await inspect(state.archive));
      if (action === 'skip') {
        packages.push({target: state.archive.target, package: state.archive.package,
          archive: state.archive.file, action: 'already-present'});
        continue;
      }
      await publishPackage(state.archive, plan);
      packages.push({target: state.archive.target, package: state.archive.package,
        archive: state.archive.file, action: 'published'});
    } catch (error) {
      if (error && typeof error === 'object') error.publicationPackages = packages;
      throw error;
    }
  }
  return {mode: 'publish', packages};
}

function writeReport(path, report) {
  if (!path) return;
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}

async function runCli() {
  const {values} = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: false,
    options: {
      manifest: {type: 'string'},
      archives: {type: 'string'},
      'staging-evidence': {type: 'string'},
      revision: {type: 'string'},
      version: {type: 'string'},
      report: {type: 'string'},
      publish: {type: 'boolean', default: false},
      'dry-run': {type: 'boolean', default: false},
    },
  });
  const reportPath = values.report ? resolve(values.report) : null;
  const report = {
    schemaVersion: 1,
    kind: 'seshat-npm-publication',
    mode: values.publish ? 'publish' : 'dry-run',
    registry: REGISTRY,
    revision: values.revision ?? null,
    version: values.version ?? null,
    tag: null,
    archives: [],
    packages: [],
    validation: {passed: false, error: null},
  };
  try {
    assert.equal(values.publish && values['dry-run'], false, '--publish and --dry-run cannot be combined');
    assert.ok(values.manifest, '--manifest is required');
    assert.ok(values.archives, '--archives is required');
    assert.ok(values['staging-evidence'], '--staging-evidence is required');
    assert.match(values.revision ?? '', /^[\da-f]{40}$/i, '--revision must be a full reviewed commit SHA');
    const checkoutRevision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
    assert.equal(checkoutRevision, values.revision, 'checkout does not match the reviewed revision');
    const manifest = JSON.parse(readFileSync(resolve(values.manifest), 'utf8'));
    const stagingEvidence = JSON.parse(readFileSync(resolve(values['staging-evidence']), 'utf8'));
    const plan = buildPublicationPlan(manifest, {
      archiveDir: resolve(values.archives),
      revision: values.revision,
      version: values.version ?? manifest.candidate?.packageVersion,
      stagingEvidence,
    });
    report.revision = plan.revision;
    report.version = plan.version;
    report.tag = plan.tag;
    report.archives = plan.archives.map(archive => ({target: archive.target, package: archive.package,
      file: archive.file, bytes: archive.bytes, sha256: archive.sha256}));
    const result = await executePublication(plan, {dryRun: !values.publish});
    report.packages = result.packages;
    report.validation = {passed: true, error: null};
    writeReport(reportPath, report);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (Array.isArray(error?.publicationPackages)) report.packages = error.publicationPackages;
    report.validation = {passed: false, error: error instanceof Error ? error.message : String(error)};
    writeReport(reportPath, report);
    console.error(report.validation.error);
    process.exitCode = 1;
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) await runCli();
