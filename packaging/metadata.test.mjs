import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadRuntimeNoticeAssets, renderRuntimeNotice} from './runtime-notice-check.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = {type: 'git', url: 'git+https://github.com/Binary-Balance/seshat.git'};
const entryDescription = 'A native CLI for TypeScript and TSX complexity analysis and mutation testing.';
const packageDirectories = ['seshat', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'];
const tarCommand = process.platform === 'win32' ? 'tar.exe' : 'tar';

test('layout-only inspection describes metadata without creating archives', () => {
  const output = mkdtempSync(join(tmpdir(), 'seshat metadata & %SESHAT_NPM_PATH%=test-'));
  try {
    execFileSync(process.execPath, [join(repo, 'packaging/release.mjs'),
      '--output', output, '--layout-only'], {cwd: repo, stdio: 'ignore'});
    const report = JSON.parse(readFileSync(join(output, 'release.json'), 'utf8'));
    assert.equal(report.mode, 'layout-only');
    assert.equal(report.entry.archive, null);
    assert.ok(report.native.every(target => target.archive === null));
    assert.ok(!readdirSync(output).some(name => name.endsWith('.tgz')));
    for (const directory of packageDirectories) {
      const stage = join(output, directory);
      const manifest = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'));
      assert.equal(manifest.engines.node, '>=24.20.0 <25');
      assert.deepEqual(manifest.repository, repository, `${directory}: staged metadata`);
      const expectedDescription = directory === 'seshat'
        ? entryDescription
        : `Native Seshat payload for ${directory}`;
      assert.equal(manifest.description, expectedDescription, `${directory}: staged description`);
      const stagedReadme = readFileSync(join(stage, 'README.md'), 'utf8');
      if (directory === 'seshat') {
        const normalizedReadme = stagedReadme.replace(/\s+/g, ' ');
        for (const fragment of [
          'Seshat is a native CLI for TypeScript and TSX complexity analysis and mutation testing.',
          'Assessments support Node.js >=24.20.0 <25',
          'npm install --save-dev @binary-balance/seshat',
          'seshat mutate --config ./seshat.json',
          'Linux x64 (glibc; Debian 11 userspace, glibc 2.31)',
          'Linux ARM64 (glibc; Ubuntu 22.04, glibc 2.35)',
          'macOS x64 (macOS 15.0 minimum)',
          'macOS ARM64 (macOS 15.0 minimum)',
          'Windows x64 (Windows Server 2022 verification)',
          'full configuration guide',
          'JSON report format',
          'native platform support matrix',
        ]) assert.ok(normalizedReadme.includes(fragment), `${directory}: README is missing ${fragment}`);
      } else {
        assert.equal(stagedReadme,
          `# Seshat native payload\n\nTarget: ${directory}.\nConsumers normally install \`@binary-balance/seshat\`, which selects this payload for matching hosts.\n`,
          `${directory}: README content`);
      }

    }
  } finally {
    rmSync(output, {recursive: true, force: true});
  }
});

const version = readFileSync(join(repo, 'crates/seshat/Cargo.toml'), 'utf8').match(/^version\s*=\s*"([^"]+)"/m)[1];
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:repo, encoding:'utf8'}).trim();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const triples = {
  'linux-x64':'x86_64-unknown-linux-gnu', 'linux-arm64':'aarch64-unknown-linux-gnu',
  'darwin-x64':'x86_64-apple-darwin', 'darwin-arm64':'aarch64-apple-darwin',
  'win32-x64':'x86_64-pc-windows-msvc',
};
const runtime = loadRuntimeNoticeAssets(join(repo, 'packaging/runtime-notices/rust-1.98.1'));
const noticeBytes = Buffer.concat([Buffer.from('Synthetic dependency notice fixture\n\n'), renderRuntimeNotice(runtime)]);
const archiveFile = (archive, path) => execFileSync(tarCommand, ['-xOf', archive, `package/${path}`], {maxBuffer:16 * 1024 * 1024});
const archiveFiles = archive => execFileSync(tarCommand, ['-tf', archive], {encoding:'utf8'}).trim().split(/\r?\n/)
  .filter(path => !path.endsWith('/')).map(path => path.replace(/^package\//, '')).sort();

function nativeFixture(root, key = 'linux-x64') {
  const binary = join(root, `${key} binary &= %SESHAT_RELEASE_PATH%`);
  const notices = join(root, `${key} notices &= %SESHAT_RELEASE_PATH%.txt`);
  const info = join(root, `${key} BUILD &= %SESHAT_RELEASE_PATH%.json`);
  const bytes = Buffer.from(`synthetic ${key} binary`);
  const build = {
    schemaVersion:1, package:`@binary-balance/seshat-${key}`, packageVersion:version, target:triples[key], sourceCommit,
    cargoLockSha256:sha256(readFileSync(join(repo, 'crates/seshat/Cargo.lock'))), rust:runtime.provenance.toolchain.rustcBuild,
    binarySha256:sha256(bytes), binaryBytes:bytes.length,
    dependencyInventoryScope:'synthetic fixture inventory', dependencies:[{name:'fixture', version:'1.0.0', license:'MIT'}],
    nativeLibraries:['synthetic library'],
    runtimeNotices:{format:runtime.provenance.format, formatVersion:runtime.provenance.formatVersion,
      rustcVersion:runtime.provenance.toolchain.rustcVersion, rustcBuild:runtime.provenance.toolchain.rustcBuild,
      rustCommit:runtime.provenance.toolchain.rustCommit, noticeSha256:sha256(noticeBytes), noticeBytes:noticeBytes.length,
      assets:runtime.files.map(({path, bytes, sha256}) => ({path, bytes, sha256}))},
  };
  writeFileSync(binary, bytes); writeFileSync(notices, noticeBytes); writeFileSync(info, JSON.stringify(build, null, 2) + '\n');
  return {binary, notices, info, build,
    args:['--binary', `${key}=${binary}`, '--notices', `${key}=${notices}`, '--build-info', `${key}=${info}`]};
}

function release(output, args = [], env = process.env) {
  return spawnSync(process.execPath, [join(repo, 'packaging/release.mjs'), '--output', output, ...args],
    {cwd:repo, env, encoding:'utf8', maxBuffer:4 * 1024 * 1024});
}

function succeeds(child) {
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test('packed entry and native archives contain all required files and preserve input bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'seshat packed &= %SESHAT_RELEASE_PATH%-'));
  try {
    const fixtures = Object.fromEntries(Object.keys(triples).map(key => [key, nativeFixture(root, key)]));
    const lockfile = readFileSync(join(repo, 'crates/seshat/Cargo.lock'), 'utf8').replaceAll('\r\n', '\n');
    for (const [key, contents] of [['linux-x64', lockfile], ['win32-x64', lockfile.replaceAll('\n', '\r\n')]]) {
      fixtures[key].build.cargoLockSha256 = sha256(contents);
      writeFileSync(fixtures[key].info, JSON.stringify(fixtures[key].build, null, 2) + '\n');
    }
    const output = join(root, 'release &= %SESHAT_RELEASE_PATH%');
    const report = succeeds(release(output, Object.values(fixtures).flatMap(fixture => fixture.args)));
    assert.equal(report.mode, 'packed');
    const entry = join(output, report.entry.archive.file);
    assert.deepEqual(archiveFiles(entry), ['LICENSE', 'README.md', 'bin/seshat.mjs', 'package.json']);
    const entryManifest = JSON.parse(archiveFile(entry, 'package.json'));
    assert.deepEqual(entryManifest, {
      name:'@binary-balance/seshat', version, description:entryDescription, license:'MIT', repository,
      type:'module', engines:{node:'>=24.20.0 <25'}, bin:{seshat:'bin/seshat.mjs'},
      files:['bin/seshat.mjs', 'README.md', 'LICENSE'],
      optionalDependencies:Object.fromEntries(Object.keys(triples).map(key => [`@binary-balance/seshat-${key}`, version])),
    });
    assert.deepEqual(archiveFile(entry, 'bin/seshat.mjs'), readFileSync(join(repo, 'packages/seshat/bin/seshat.mjs')));
    for (const target of report.native) {
      const fixture = fixtures[target.key];
      const archive = join(output, target.archive.file);
      const binary = `bin/${target.key === 'win32-x64' ? 'seshat.exe' : 'seshat'}`;
      const files = ['BUILD.json', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.txt', binary, 'package.json'].sort();
      assert.deepEqual(archiveFiles(archive), files);
      const manifest = JSON.parse(archiveFile(archive, 'package.json'));
      const [os, cpu] = target.key.split('-');
      assert.deepEqual({...manifest, files:[...manifest.files].sort()}, {
        name:`@binary-balance/seshat-${target.key}`, version, description:`Native Seshat payload for ${target.key}`,
        license:'MIT', repository, engines:{node:'>=24.20.0 <25'}, os:[os], cpu:[cpu],
        ...(os === 'linux' ? {libc:['glibc']} : {}), files:files.filter(path => path !== 'package.json'),
      });
      assert.deepEqual(archiveFile(archive, binary), readFileSync(fixture.binary));
      assert.deepEqual(archiveFile(archive, 'BUILD.json'), readFileSync(fixture.info));
      assert.deepEqual(archiveFile(archive, 'THIRD_PARTY_NOTICES.txt'), readFileSync(fixture.notices));
      assert.equal(readFileSync(archive).length, target.archive.bytes);
      assert.equal(`sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`, target.archive.integrity);
    }
  } finally { rmSync(root, {recursive:true, force:true}); }
});

test('packed releases reject missing or mismatched provenance before creating output', () => {
  const root = mkdtempSync(join(tmpdir(), 'seshat metadata-errors-'));
  try {
    const fixture = nativeFixture(root);
    const output = join(root, 'release');
    for (const option of ['--build-info', '--notices']) {
      const args = fixture.args.filter((_, index, values) => values[index] !== option && values[index - 1] !== option);
      const child = release(output, args);
      assert.notEqual(child.status, 0);
      assert.match(child.stderr, new RegExp(`${option} is required`));
      assert.equal(existsSync(output), false);
    }
    for (const [field, value] of [
      ['schemaVersion',2], ['package','wrong'], ['packageVersion','9.9.9'], ['target','wrong'], ['sourceCommit','a'.repeat(40)],
      ['cargoLockSha256','b'.repeat(64)], ['rust','wrong'], ['binarySha256','b'.repeat(64)], ['binaryBytes',0],
      ['dependencyInventoryScope',null], ['dependencies',[]], ['nativeLibraries',[]], ['runtimeNotices',null],
    ]) {
      writeFileSync(fixture.info, JSON.stringify({...fixture.build, [field]:value}));
      const child = release(output, fixture.args);
      assert.notEqual(child.status, 0, field);
      assert.equal(existsSync(output), false, field);
    }
    for (const field of ['noticeSha256', 'noticeBytes', 'rustCommit', 'assets']) {
      writeFileSync(fixture.info, JSON.stringify({...fixture.build, runtimeNotices:{...fixture.build.runtimeNotices, [field]:null}}));
      const child = release(output, fixture.args);
      assert.notEqual(child.status, 0, field);
      assert.match(child.stderr, new RegExp(`runtimeNotices ${field} mismatch`));
      assert.equal(existsSync(output), false);
    }
    writeFileSync(fixture.info, '{}');
    assert.notEqual(release(output, fixture.args).status, 0);
    const layout = succeeds(release(output, [...fixture.args, '--layout-only']));
    assert.equal(layout.mode, 'layout-only');
    assert.equal(layout.native[0].archive, null);
    assert.equal(readFileSync(join(output, 'linux-x64/BUILD.json'), 'utf8'), '{}');
    const bareLayout = join(root, 'binary-only-layout');
    succeeds(release(bareLayout, ['--layout-only', '--binary', `linux-x64=${fixture.binary}`]));
    assert.equal(existsSync(join(bareLayout, 'linux-x64/BUILD.json')), false);
  } finally { rmSync(root, {recursive:true, force:true}); }
});

test('reruns and partial target sets cannot reuse stale output or overwrite external manifests', () => {
  const root = mkdtempSync(join(tmpdir(), 'seshat stale-release-'));
  try {
    const fixture = nativeFixture(root);
    const output = join(root, 'release');
    const report = succeeds(release(output, fixture.args));
    assert.ok(report.native.slice(1).every(target => target.archive === null));
    const archive = join(output, report.native[0].archive.file);
    const original = readFileSync(archive);
    for (const args of [[], ['--layout-only'], fixture.args]) {
      const child = release(output, args);
      assert.notEqual(child.status, 0);
      assert.match(child.stderr, /new or empty directory/);
      assert.deepEqual(readFileSync(archive), original);
    }
    const empty = join(root, 'empty'); mkdirSync(empty);
    const existingManifest = join(root, 'old-release.json'); writeFileSync(existingManifest, 'preserve me');
    assert.match(release(empty, ['--manifest', existingManifest]).stderr, /manifest already exists/);
    assert.match(release(empty, [], {...process.env, SESHAT_RELEASE_OUTPUT:existingManifest}).stderr, /manifest already exists/);
    assert.equal(readFileSync(existingManifest, 'utf8'), 'preserve me');
    assert.deepEqual(readdirSync(empty), []);
    assert.match(release(empty, ['--manifest', join(empty, 'seshat/package.json')]).stderr, /must not overwrite/);
    succeeds(release(empty, ['--layout-only']));
  } finally { rmSync(root, {recursive:true, force:true}); }
});

// Native CI supplies the two real packaging routes after building its payload.
const [nativeArchive, releaseArchive] = process.argv.slice(2);
test('native pack and release archives have equivalent manifests and file contents', {skip:!nativeArchive}, () => {
  assert.ok(releaseArchive, 'provide both the native pack and release archives');
  const native = JSON.parse(archiveFile(nativeArchive, 'package.json'));
  const staged = JSON.parse(archiveFile(releaseArchive, 'package.json'));
  assert.deepEqual({...native, files:[...native.files].sort()}, {...staged, files:[...staged.files].sort()});
  const files = archiveFiles(nativeArchive);
  assert.deepEqual(files, archiveFiles(releaseArchive));
  for (const path of files.filter(path => path !== 'package.json')) {
    assert.deepEqual(archiveFile(nativeArchive, path), archiveFile(releaseArchive, path), path);
  }
});

test('manifest aliases cannot overwrite a packed archive', () => {
  const root = mkdtempSync(join(tmpdir(), 'seshat manifest-alias-'));
  try {
    const output = join(root, 'output');
    const alias = join(root, 'alias');
    mkdirSync(output);
    symlinkSync(output, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const child = release(output, ['--manifest', join(alias, `binary-balance-seshat-${version}.tgz`)]);
    assert.notEqual(child.status, 0, 'an aliased manifest must not overwrite an archive');
    assert.match(child.stderr, /must not overwrite a staged package or archive/);
    assert.deepEqual(readdirSync(output), [], 'reject the collision before staging');
  } finally { rmSync(root, {recursive:true, force:true}); }
});
