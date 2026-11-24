import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {releasePackages} from './release-targets.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');

export function archiveContents(data) {
  const tar = gunzipSync(data);
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


// Recheck supplied audits against the exact hashed bytes at each release boundary.
export function validateReleaseEntry(data, version) {
  const member = archiveContents(data).find(file => file.record.path === 'package/package.json');
  assert.ok(member, 'entry package manifest is missing');
  const manifest = JSON.parse(member.data);
  assert.equal(manifest.name, '@binary-balance/seshat', 'entry package identity differs');
  assert.equal(manifest.version, version, 'entry package version differs');
  assert.deepEqual(manifest.optionalDependencies, Object.fromEntries(releasePackages(version)
    .filter(target => target.role === 'native-release').map(target => [target.package, version])),
  'entry optional dependency set or versions differ');
}
