import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function readProvenance(directory) {
  const provenancePath = join(directory, 'provenance.json');
  assert.ok(existsSync(provenancePath), `runtime notice provenance is missing: ${provenancePath}`);
  return JSON.parse(readFileSync(provenancePath, 'utf8'));
}

export function validateRustToolchain(provenance, {versionOutput, verboseOutput}) {
  const expected = provenance.toolchain;
  assert.ok(expected && typeof expected === 'object', 'runtime notice toolchain provenance is missing');
  assert.match(expected.rustcVersion, /^\d+\.\d+\.\d+$/, 'runtime notice Rust version is invalid');
  assert.match(expected.rustCommit, /^[0-9a-f]{40}$/i, 'runtime notice Rust commit is not a full hash');
  assert.equal(versionOutput.trim(), expected.rustcBuild, 'rustc version does not match pinned runtime notices');
  assert.equal(verboseOutput.match(/^release:\s*(\S+)$/m)?.[1], expected.rustcVersion,
    'rustc release does not match pinned runtime notices');
  assert.equal(verboseOutput.match(/^commit-hash:\s*(\S+)$/m)?.[1], expected.rustCommit,
    'rustc commit does not match pinned runtime notices');
  return expected;
}

export function loadRuntimeNoticeAssets(directory) {
  const root = resolve(directory);
  const provenance = readProvenance(root);
  assert.equal(provenance.format, 'seshat-runtime-notices', 'unexpected runtime notice format');
  assert.equal(provenance.formatVersion, 1, 'unsupported runtime notice format version');
  assert.ok(provenance.integration?.failClosedOnAssetHashChange === true,
    'runtime notice provenance must require fail-closed asset checks');
  assert.ok(provenance.integration?.sourceFactsAreNoticePayload === false,
    'source facts must not be runtime notice payload');
  assert.ok(Array.isArray(provenance.noticeFiles) && provenance.noticeFiles.length > 0,
    'runtime notice asset manifest is empty');
  assert.deepEqual(provenance.integration.appendOrder, provenance.noticeFiles.map(asset => asset.path),
    'runtime notice append order differs from the asset manifest');

  const paths = new Set();
  const files = provenance.noticeFiles.map(asset => {
    assert.ok(asset && typeof asset.path === 'string' && asset.path.length > 0,
      'runtime notice asset path is missing');
    assert.ok(!paths.has(asset.path), `duplicate runtime notice asset: ${asset.path}`);
    paths.add(asset.path);
    assert.ok(!asset.path.startsWith('/') && !asset.path.split('/').includes('..'),
      `runtime notice asset escapes its directory: ${asset.path}`);
    assert.ok(!asset.path.startsWith('source-facts/'),
      `source fact cannot be runtime notice payload: ${asset.path}`);
    assert.ok(Number.isInteger(asset.bytes) && asset.bytes >= 0,
      `runtime notice byte count is invalid: ${asset.path}`);
    assert.match(asset.sha256, /^[0-9a-f]{64}$/i, `runtime notice hash is invalid: ${asset.path}`);

    const path = join(root, asset.path);
    assert.equal(relative(root, path).replaceAll('\\', '/'), asset.path,
      `runtime notice asset path is unsafe: ${asset.path}`);
    assert.ok(existsSync(path) && lstatSync(path).isFile(), `runtime notice asset is not a file: ${asset.path}`);
    const data = readFileSync(path);
    assert.equal(data.length, asset.bytes, `runtime notice byte count changed: ${asset.path}`);
    assert.equal(sha256(data), asset.sha256, `runtime notice hash changed: ${asset.path}`);
    return {...asset, data};
  });
  return {directory:root, provenance, files};
}

export function renderRuntimeNotice({provenance, files}) {
  const heading = provenance.integration?.noticeHeading;
  assert.ok(typeof heading === 'string' && heading.length > 0, 'runtime notice heading is missing');
  const scope = 'Scope: This conservative upstream inventory spans multiple targets and standard-library build dependencies; it is not a target-specific linked-object inventory.';
  const chunks = [Buffer.from(`${heading}\n${scope}\n\n`, 'utf8')];
  for (const {path, data} of files) {
    chunks.push(Buffer.from(`${path}\n`, 'utf8'), data, Buffer.from('\n\n', 'utf8'));
  }
  return Buffer.concat(chunks);
}

export function assertArchiveNotice(archive, expected) {
  const tar = process.platform === 'win32' ? 'tar.exe' : 'tar';
  const actual = execFileSync(tar, ['-xOf', archive, 'package/THIRD_PARTY_NOTICES.txt'], {
    maxBuffer: expected.length + 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  assert.deepEqual(actual, expected, 'archive notice differs from staged notice');
}

function assertAutocrlfCheckout(repo) {
  const root = mkdtempSync(join(tmpdir(), 'seshat-runtime-notice-checkout-'));
  const checkout = join(root, 'checkout');
  try {
    execFileSync('git', ['clone', '--no-local', '--no-checkout', '--quiet', repo, checkout], {stdio:'ignore'});
    execFileSync('git', ['-C', checkout, 'config', 'core.autocrlf', 'true'], {stdio:'ignore'});
    execFileSync('git', ['-C', checkout, 'checkout', '--force', 'HEAD'], {stdio:'ignore'});
    loadRuntimeNoticeAssets(join(checkout, 'packaging/runtime-notices/rust-1.98.1'));
  } finally {
    rmSync(root, {recursive:true, force:true});
  }
}

function selfCheck() {
  const directory = join(dirname(fileURLToPath(import.meta.url)), 'runtime-notices/rust-1.98.1');
  const assets = loadRuntimeNoticeAssets(directory);
  const expectedToolchain = assets.provenance.toolchain;
  validateRustToolchain(assets.provenance, {
    versionOutput: expectedToolchain.rustcBuild,
    verboseOutput: `release: ${expectedToolchain.rustcVersion}\ncommit-hash: ${expectedToolchain.rustCommit}\n`,
  });
  const notice = renderRuntimeNotice(assets);
  assert.ok(notice.includes(assets.files[0].data), 'rendered notice dropped sourced bytes');
  assert.throws(() => validateRustToolchain(assets.provenance, {
    versionOutput: 'rustc 1.98.0 (wrong)',
    verboseOutput: `release: ${expectedToolchain.rustcVersion}\ncommit-hash: ${expectedToolchain.rustCommit}\n`,
  }), /does not match pinned/);
  assertAutocrlfCheckout(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

  const root = mkdtempSync(join(tmpdir(), 'seshat-runtime-notice-check-'));
  try {
    const synthetic = join(root, 'assets');
    mkdirSync(synthetic);
    const data = Buffer.from('notice\n');
    writeFileSync(join(synthetic, 'notice.txt'), data);
    writeFileSync(join(synthetic, 'provenance.json'), JSON.stringify({
      format: 'seshat-runtime-notices', formatVersion: 1,
      toolchain: expectedToolchain,
      noticeFiles: [{path: 'notice.txt', bytes: data.length, sha256: sha256(data)}],
      integration: {appendOrder: ['notice.txt'], sourceFactsAreNoticePayload: false, failClosedOnAssetHashChange: true,
        noticeHeading: 'Synthetic runtime notice'},
    }));
    const valid = loadRuntimeNoticeAssets(synthetic);
    writeFileSync(join(synthetic, 'notice.txt'), Buffer.from('badbad\n'));
    assert.throws(() => loadRuntimeNoticeAssets(synthetic), /hash changed/);

    const archiveRoot = join(root, 'package');
    mkdirSync(archiveRoot);
    writeFileSync(join(archiveRoot, 'THIRD_PARTY_NOTICES.txt'), notice);
    const archive = join(root, 'package.tgz');
    execFileSync('tar', ['-czf', archive, '-C', root, 'package'], {stdio: ['ignore', 'pipe', 'inherit']});
    assertArchiveNotice(archive, notice);
    assert.ok(valid.files.length === 1, 'synthetic positive asset check failed');
  } finally {
    rmSync(root, {recursive:true, force:true});
  }
  console.log('runtime notice checks passed');
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) selfCheck();
