import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {tmpdir} from 'node:os';
import {expectedTag, inspectRegistry, validateManifest} from './npm-publishing.mjs';
import {PACKAGE_ORDER, releasePackages, releaseVersion, hostLibc} from './release-targets.mjs';

export const REGISTRY = 'https://registry.npmjs.org/';
export const ENTRY_PACKAGE = '@binary-balance/seshat';
const SLSA_PROVENANCE_PREDICATE = 'https://slsa.dev/provenance/v1';

export const TARGETS = new Map(PACKAGE_ORDER.filter(value => value.role === 'native-release')
  .map(target => [target.target, target]));

export const NATIVE_PACKAGES = [...TARGETS.values()].map(target => target.package);

export function auditVersion(audit) {
  const version = audit.candidate?.packageVersion;
  assert.equal(typeof version, 'string', 'audit package version is missing');
  expectedTag(version); // Reuse the publisher's semver validation.
  return version;
}

export function validateHost(targetName, actual = {platform: process.platform, arch: process.arch, libc: hostLibc()}) {
  const target = TARGETS.get(targetName);
  assert.ok(target, `unknown registry-install target: ${targetName}`);
  assert.deepEqual(
    [actual.platform, actual.arch],
    [target.platform, target.arch],
    `host does not match ${targetName}: ${actual.platform}/${actual.arch}`,
  );
  if (target.libc) assert.equal(actual.libc, target.libc, `host libc does not match ${targetName}`);
  return target;
}

export function validateNativePackages(installedPackages, expectedPackage) {
  const installed = installedPackages.filter(name => NATIVE_PACKAGES.includes(name)).sort();
  assert.deepEqual(installed, [expectedPackage],
    `installed native packages do not select only ${expectedPackage}`);
  return installed;
}

export function validateRegistryArchive(archive, coordinate) {
  assert.equal(archive.status, 'present', `${coordinate.target}: registry archive unavailable`);
  assert.equal(archive.bytes, coordinate.archiveBytes, `${coordinate.target}: registry archive size differs from audit`);
  assert.equal(archive.sha256, coordinate.archiveSha256, `${coordinate.target}: registry archive hash differs from audit`);
}

export function validateBinaryIdentity(identity, coordinate) {
  const expected = coordinate.buildProvenance?.binary;
  assert.ok(expected, `${coordinate.target}: binary provenance is missing`);
  assert.equal(identity.bytes, expected.bytes, `${coordinate.target}: installed binary size differs from audit`);
  assert.equal(identity.sha256, expected.sha256, `${coordinate.target}: installed binary hash differs from audit`);
  return identity;
}

export function validateAttestations(result, expectedPackages) {
  assert.deepEqual(result?.invalid ?? [], [], 'npm audit signatures found invalid signatures or attestations');
  assert.deepEqual(result?.missing ?? [], [], 'npm audit signatures found missing registry signatures');
  assert.ok(Array.isArray(result?.verified), 'npm audit signatures did not return verified attestations');
  for (const expected of expectedPackages) {
    const verified = result.verified.find(value =>
      value?.name === expected.name && value?.version === expected.version);
    assert.ok(verified, `verified attestation is missing for ${expected.name}@${expected.version}`);
    assert.ok(verified.attestations, `attestation metadata is missing for ${expected.name}@${expected.version}`);
    assert.ok(Array.isArray(verified.attestationBundles) && verified.attestationBundles.some(bundle =>
      bundle?.predicateType === SLSA_PROVENANCE_PREDICATE),
    `verified SLSA provenance bundle is missing for ${expected.name}@${expected.version}`);
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invoked) {
  const {values} = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: false,
    options: {
      output: {type: 'string'},
      target: {type: 'string'},
    },
  });

  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const targetName = values.target ?? `${process.platform}-${process.arch}`;
  const output = resolve(values.output ?? join(repo, 'work/registry-install', targetName, 'registry-install.json'));
  mkdirSync(dirname(output), {recursive: true});

  let version = null;
  const report = {
    schemaVersion: 1,
    kind: 'seshat-release-registry-install',
    version,
    registry: REGISTRY,
    host: {
      target: targetName,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      npm: null,
    },
    checks: {},
    installed: null,
    fixture: null,
    validation: {passed: false, error: null},
  };
  const work = mkdtempSync(join(tmpdir(), 'seshat-registry-install-'));
  const consumer = join(work, 'consumer');
  let target;
  let releaseNativePackages;
  const archiveIntegrities = new Map();

  const portable = value => String(value)
    .replaceAll(work, '<work>')
    .replaceAll(repo, '<repo>');
  const clip = value => {
    const text = portable(value ?? '');
    return text.length > 32_000 ? `${text.slice(0, 16_000)}\n... output clipped ...\n${text.slice(-16_000)}` : text;
  };
  const writeReport = () => writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
  const identity = path => {
    const bytes = readFileSync(path);
    return {bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
  };

  const run = (name, command, args, cwd = consumer) => {
    const result = spawnSync(command, args, {
      cwd,
      encoding: 'utf8',
      env,
      maxBuffer: 32 * 1024 * 1024,
      shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
      timeout: 300_000,
    });
    const detail = {
      command: [command, ...args].map(portable),
      status: result.status,
      signal: result.signal,
      timedOut: result.error?.code === 'ETIMEDOUT',
      stdout: clip(result.stdout),
      stderr: clip(result.stderr),
      error: result.error ? portable(result.error.message) : null,
    };
    report.checks[name] = detail;
    process.stderr.write(`registry-install: ${name} exit ${result.status ?? '<error>'}\n`);
    if (result.stdout) process.stderr.write(clip(result.stdout));
    if (result.stderr) process.stderr.write(clip(result.stderr));
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${name} failed\n${detail.stdout}\n${detail.stderr}`);
    return result;
  };

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmrc = join(work, 'user.npmrc');
  const globalNpmrc = join(work, 'global.npmrc');
  const cache = join(work, 'npm-cache');
  const env = {
    ...process.env,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_globalconfig: globalNpmrc,
    npm_config_cache: cache,
    npm_config_update_notifier: 'false',
    npm_config_userconfig: npmrc,
  };
  const npmOptions = [
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    `--registry=${REGISTRY}`,
    `--@binary-balance:registry=${REGISTRY}`,
    '--cache', cache,
    '--userconfig', npmrc,
    '--globalconfig', globalNpmrc,
  ];
  const shim = path => process.platform === 'win32'
    ? [process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe', ['/d', '/s', '/c', 'call', path]]
    : [path, []];

  const inspectInstallation = coordinate => {
    const rootPackage = readJson(join(consumer, 'package.json'));
    const lock = readJson(join(consumer, 'package-lock.json'));
    assert.equal(rootPackage.devDependencies?.[ENTRY_PACKAGE], version,
      'consumer does not record the exact entry package version');
    for (const packageName of NATIVE_PACKAGES) {
      assert.equal(rootPackage.dependencies?.[packageName], undefined);
      assert.equal(rootPackage.devDependencies?.[packageName], undefined);
      assert.equal(rootPackage.optionalDependencies?.[packageName], undefined);
    }

    const entryRoot = join(consumer, 'node_modules', ENTRY_PACKAGE);
    const entryLock = lock.packages?.[`node_modules/${ENTRY_PACKAGE}`];
    assert.equal(entryLock?.version, version, 'lockfile entry package version changed');
    assert.equal(entryLock.integrity, archiveIntegrities.get(ENTRY_PACKAGE), 'lockfile entry archive differs from audit');
    assert.equal(entryLock?.resolved?.startsWith(REGISTRY), true,
      'lockfile entry package is not resolved from the public registry');
    const entryManifest = readJson(join(entryRoot, 'package.json'));
    assert.equal(entryManifest.name, ENTRY_PACKAGE);
    assert.equal(entryManifest.version, version);
    assert.deepEqual(entryManifest.optionalDependencies, Object.fromEntries(
      releaseNativePackages.map(name => [name, version]),
    ));

    const installedPackages = NATIVE_PACKAGES.filter(name =>
      existsSync(join(consumer, 'node_modules', name)));
    validateNativePackages(installedPackages, target.package);
    for (const packageName of releaseNativePackages) {
      const nativeLock = lock.packages?.[`node_modules/${packageName}`];
      assert.equal(nativeLock?.integrity, archiveIntegrities.get(packageName),
        `lockfile native archive differs from audit: ${packageName}`);
      assert.equal(nativeLock?.version, version,
        `lockfile native package version changed: ${packageName}`);
      assert.equal(nativeLock?.resolved?.startsWith(REGISTRY), true,
        `lockfile native package is not resolved from the public registry: ${packageName}`);
    }
    const nativeRoot = join(consumer, 'node_modules', target.package);
    const nativeManifest = readJson(join(nativeRoot, 'package.json'));
    assert.equal(nativeManifest.name, target.package);
    assert.equal(nativeManifest.version, version);
    assert.deepEqual(nativeManifest.os, [target.platform]);
    assert.deepEqual(nativeManifest.cpu, [target.arch]);
    if (target.libc && (nativeManifest.libc !== undefined || releaseVersion(version).musl || target.libc === 'musl')) {
      assert.deepEqual(nativeManifest.libc, [target.libc]);
    }

    const binaryPath = join(nativeRoot, 'bin', target.executable);
    assert.equal(statSync(binaryPath).isFile(), true, 'matching native executable is missing');
    const binary = validateBinaryIdentity(identity(binaryPath), coordinate);
    for (const [file, expected] of [['BUILD.json', coordinate.buildProvenance.buildRecord],
      ['package.json', coordinate.buildProvenance.packageManifest], ['THIRD_PARTY_NOTICES.txt', coordinate.buildProvenance.notice]]) {
      const actual = identity(join(nativeRoot, file));
      assert.equal(actual.bytes, expected.bytes, `${file}: installed size differs from audit`);
      assert.equal(actual.sha256, expected.sha256, `${file}: installed hash differs from audit`);
    }
    const build = readJson(join(nativeRoot, 'BUILD.json'));
    assert.equal(build.package, target.package);
    assert.equal(build.packageVersion, version);
    assert.equal(build.binarySha256, binary.sha256);
    assert.equal(build.binaryBytes, binary.bytes);

    return {
      host: {platform: process.platform, arch: process.arch},
      entry: {package: ENTRY_PACKAGE, version},
      native: {
        package: target.package,
        version,
        path: `node_modules/${target.package}/bin/${target.executable}`,
        binary,
      },
      absentNativePackages: NATIVE_PACKAGES.filter(name => name !== target.package),
    };
  };

  try {
    target = validateHost(targetName);
    const audit = readJson(join(repo, 'docs/research/release-notice-audit.json'));
    version = auditVersion(audit);
    report.version = version;
    validateManifest(audit, version);
    releaseNativePackages = releasePackages(version).filter(value => value.role === 'native-release').map(value => value.package);
    report.registryArchives = [];
    for (const coordinate of audit.coordinates) {
      const archive = await inspectRegistry({package:coordinate.package, version,
        bytes:coordinate.archiveBytes, sha256:coordinate.archiveSha256}, globalThis.fetch);
      // Availability and exact bytes are checked before installing; npm verifies provenance below.
      validateRegistryArchive(archive, coordinate);
      archiveIntegrities.set(coordinate.package, `sha512-${createHash('sha512').update(archive.data).digest('base64')}`);
      report.registryArchives.push({target:coordinate.target, bytes:archive.bytes, sha256:archive.sha256});
    }
    const coordinate = audit.coordinates?.find(value => value.target === targetName);
    assert.ok(coordinate, `audit coordinate is missing: ${targetName}`);
    assert.equal(coordinate.package, target.package);
    assert.equal(coordinate.version, version);
    assert.equal(process.version, 'v24.20.0');
    report.host.npm = spawnSync(npmCommand, ['--version'], {
      encoding: 'utf8',
      env,
      shell: process.platform === 'win32',
    }).stdout.trim();
    assert.equal(report.host.npm, '11.19.0');

    writeFileSync(npmrc, '');
    writeFileSync(globalNpmrc, '');
    cpSync(join(repo, 'examples/node'), consumer, {
      recursive: true,
      filter: path => !path.split(/[\\/]/).includes('node_modules'),
    });
    run('fixture-dependencies', npmCommand, ['ci', ...npmOptions]);
    run('registry-install', npmCommand, [
      'install', ...npmOptions, '--save-dev', '--save-exact', `${ENTRY_PACKAGE}@${version}`,
    ]);

    const expectedAttestations = [
      {name: ENTRY_PACKAGE, version},
      {name: target.package, version},
    ];
    const signatures = JSON.parse(run('provenance', npmCommand, [
      'audit', 'signatures', '--json', '--include-attestations', ...npmOptions,
    ]).stdout);
    validateAttestations(signatures, expectedAttestations);

    const launcherPath = join(consumer, 'node_modules', '.bin', process.platform === 'win32' ? 'seshat.cmd' : 'seshat');
    const [versionCommand, versionArgs] = shim(launcherPath);
    const versionBefore = run('shim-version-before-ci', versionCommand, [...versionArgs, '--version']).stdout;
    assert.equal(versionBefore, `seshat ${version}\n`);
    report.installed = inspectInstallation(coordinate);

    const mutation = JSON.parse(run('mutation-fixture', versionCommand, [
      ...versionArgs,
      'check', '--config', 'seshat.json', '--json', '--no-progress',
    ]).stdout);
    assert.equal(mutation.complete, true);
    assert.equal(mutation.result?.complete, true);
    assert.deepEqual(mutation.scope?.files, ['src/rules.ts']);
    assert.deepEqual(
      {
        planned: mutation.result.mutation.planned,
        killed: mutation.result.mutation.killed,
        survived: mutation.result.mutation.survived,
        unresolved: mutation.result.mutation.unresolved,
        score: mutation.result.mutation.score,
      },
      {planned: 4, killed: 3, survived: 1, unresolved: 0, score: 75},
    );
    report.fixture = {
      sourceFiles: mutation.scope.files,
      mutation: {
        planned: mutation.result.mutation.planned,
        killed: mutation.result.mutation.killed,
        survived: mutation.result.mutation.survived,
        unresolved: mutation.result.mutation.unresolved,
        score: mutation.result.mutation.score,
      },
    };

    rmSync(join(consumer, 'node_modules'), {recursive: true, force: true});
    run('registry-ci', npmCommand, ['ci', ...npmOptions]);
    report.installedAfterCi = inspectInstallation(coordinate);
    const versionAfter = run('shim-version-after-ci', versionCommand, [...versionArgs, '--version']).stdout;
    assert.equal(versionAfter, versionBefore);
    report.validation = {passed: true, error: null};
    writeReport();
    console.log(`registry install passed for ${targetName}: ${report.fixture.mutation.killed}/${report.fixture.mutation.planned} mutants killed`);
  } catch (error) {
    report.validation = {passed: false, error: portable(error instanceof Error ? error.message : error)};
    writeReport();
    process.stderr.write(`registry-install: failed: ${report.validation.error}\n`);
    process.exitCode = 1;
  } finally {
    rmSync(work, {recursive: true, force: true});
  }
}
