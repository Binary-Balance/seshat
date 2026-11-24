import assert from 'node:assert/strict';

// Publication keeps the historical six-package releases distinct from musl experiments.
export const PACKAGE_ORDER = Object.freeze([
  {target: 'linux-x64', triple: 'x86_64-unknown-linux-gnu', artifact: 'linux-x64-package-proof', workflow: 'linux-x64-package.yml'},
  {target: 'linux-arm64', triple: 'aarch64-unknown-linux-gnu', artifact: 'linux-arm64-package-proof', workflow: 'linux-arm64-package.yml'},
  {target: 'darwin-x64', triple: 'x86_64-apple-darwin', artifact: 'macos-x64-package-proof', workflow: 'macos-package.yml'},
  {target: 'darwin-arm64', triple: 'aarch64-apple-darwin', artifact: 'macos-arm64-package-proof', workflow: 'macos-package.yml'},
  {target: 'win32-x64', triple: 'x86_64-pc-windows-msvc', artifact: 'windows-x64-package-proof', workflow: 'windows-package.yml'},
  {target: 'linux-x64-musl', triple: 'x86_64-unknown-linux-musl', artifact: 'alpine-prerequisites-x64', workflow: 'alpine-prerequisites.yml'},
  {target: 'linux-arm64-musl', triple: 'aarch64-unknown-linux-musl', artifact: 'alpine-prerequisites-arm64', workflow: 'alpine-prerequisites.yml'},
  {target: 'universal'},
].map(value => {
  const entry = value.target === 'universal';
  const [platform, arch] = value.target.split('-');
  const executable = platform === 'win32' ? 'seshat.exe' : 'seshat';
  return Object.freeze({...value,
    file: entry ? 'entry.tgz' : `${value.target}.tgz`,
    package: `@binary-balance/seshat${entry ? '' : `-${value.target}`}`,
    role: entry ? 'entry' : 'native-release',
    ...(entry ? {} : {platform, arch, executable, binary: `package/bin/${executable}`,
      ...(platform === 'linux' ? {libc: value.target.endsWith('-musl') ? 'musl' : 'glibc'} : {})}),
  });
}));

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function releaseVersion(version) {
  const match = semverPattern.exec(version ?? '');
  assert.ok(match, `version is not valid semver: ${version}`);
  for (const identifier of match[4]?.split('.') ?? []) {
    if (/^\d+$/.test(identifier)) assert.ok(identifier === '0' || !identifier.startsWith('0'),
      `version has a leading-zero prerelease identifier: ${version}`);
  }
  return {version, prerelease: Boolean(match[4]), musl: Number(match[1]) > 0 || Number(match[2]) >= 19};
}

export function releasePackages(version) {
  return releaseVersion(version).musl ? PACKAGE_ORDER : PACKAGE_ORDER.filter(value => !value.target.endsWith('-musl'));
}

export function hostLibc(report = process.platform === 'linux' ? process.report.getReport() : null) {
  if (!report) return null;
  const glibc = typeof report.header?.glibcVersionRuntime === 'string' && report.header.glibcVersionRuntime.length > 0;
  const musl = report.sharedObjects?.some(path => typeof path === 'string' && /\/ld-musl-[^/]+\.so\.1$/.test(path)) === true;
  assert.ok(glibc !== musl, 'host libc must identify exactly one of glibc or musl');
  return musl ? 'musl' : 'glibc';
}

// Source proofs can still build experimental musl manifests at the old version.
// Publication and registry checks use releasePackages instead.
export function entryPackages(manifest) {
  const expected = releaseVersion(manifest.version).musl ||
    Object.keys(manifest.optionalDependencies ?? {}).some(name => name.endsWith('-musl'))
    ? PACKAGE_ORDER : releasePackages(manifest.version);
  assert.deepEqual(manifest.optionalDependencies, Object.fromEntries(expected
    .filter(value => value.role === 'native-release').map(value => [value.package, manifest.version])),
  'entry optional dependency set or versions differ');
  return expected;
}
