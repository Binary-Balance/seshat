import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {loadRuntimeNoticeAssets, renderRuntimeNotice} from './runtime-notice-check.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function muslNotices(directory) {
  const assets = loadRuntimeNoticeAssets(join(directory, 'rust-1.98.1-musl'));
  return {...assets, text:renderRuntimeNotice(assets), metadata:{
    assets:assets.files.map(({path, bytes, sha256}) => ({path, bytes, sha256})),
    provenanceSha256:sha256(readFileSync(join(assets.directory, 'provenance.json'))),
  }};
}

// Static PIE can contain PT_DYNAMIC; only an interpreter or DT_NEEDED adds a runtime dependency.
export function staticMuslElf(bytes, machine) {
  assert.equal(bytes.subarray(0, 6).toString('hex'), '7f454c460201', 'expected little-endian ELF64');
  assert.equal(bytes.readUInt16LE(18), machine, 'unexpected musl ELF machine');
  const offset = Number(bytes.readBigUInt64LE(32));
  const size = bytes.readUInt16LE(54);
  const count = bytes.readUInt16LE(56);
  assert.ok(size >= 56 && count > 0 && offset + count * size <= bytes.length, 'invalid ELF program headers');
  for (let index = 0; index < count; index++) {
    const header = offset + index * size;
    const type = bytes.readUInt32LE(header);
    assert.notEqual(type, 3, 'musl payload must not have a PT_INTERP');
    if (type !== 2) continue;
    const start = Number(bytes.readBigUInt64LE(header + 8));
    const length = Number(bytes.readBigUInt64LE(header + 32));
    assert.ok(start + length <= bytes.length && length % 16 === 0, 'invalid ELF dynamic section');
    for (let item = start; item < start + length; item += 16) {
      const tag = bytes.readBigInt64LE(item);
      if (tag === 0n) break;
      assert.notEqual(tag, 1n, 'musl payload must not have DT_NEEDED');
    }
  }
  return {interpreter:null, needed:[]};
}

export function muslRuntimeInputs(map, libraryDirectory, auditedInputs) {
  const loads = [...map.matchAll(/^LOAD (.+)$/gm)].map(match => match[1]);
  const selected = [...new Set(loads.filter(path => path.endsWith('.a') || path.includes('/self-contained/')))];
  for (const path of loads.filter(path => path.endsWith('.o') && !path.includes('/self-contained/'))) {
    assert.ok(path.endsWith('.rcgu.o') || /\/rustc[^/]+\/symbols\.o$/.test(path),
      'unexpected non-Rust runtime object: ' + path);
  }
  const names = selected.map(path => basename(path)).sort();
  const startup = names.includes('rcrt1.o') ? 'rcrt1.o' : 'crt1.o';
  const suffix = startup === 'rcrt1.o' ? 'S' : '';
  assert.deepEqual(names, [startup, 'crti.o', 'crtbegin' + suffix + '.o', 'libc.a', 'libunwind.a', 'crtend' + suffix + '.o', 'crtn.o'].sort(),
    'unexpected native runtime inputs; audit new runtime objects before packaging');
  return selected.map(path => {
    const name = basename(path);
    assert.equal(path, join(libraryDirectory, 'self-contained', name), 'runtime input is outside the pinned Rust sysroot');
    const bytes = readFileSync(path);
    const logicalPath = 'self-contained/' + name;
    assert.equal(sha256(bytes), auditedInputs?.[logicalPath], 'runtime input differs from audited Rust distribution: ' + name);
    return {path:logicalPath, bytes:bytes.length, sha256:sha256(bytes)};
  }).sort((a, b) => a.path.localeCompare(b.path));
}

export function validateMuslBuild(build, bytes, machine, notices) {
  assert.deepEqual(build.nativeLibraries, [], 'static musl payload must have zero dynamic libraries');
  assert.deepEqual(build.glibcSymbols, [], 'static musl payload must have no glibc requirements');
  assert.deepEqual(build.linkage?.elf, staticMuslElf(bytes, machine), 'musl ELF metadata mismatch');
  assert.equal(build.linkage?.kind, 'static-musl');
  assert.equal(build.linkage?.muslVersion, notices.provenance.musl.version);
  assert.deepEqual(build.linkage?.notices, notices.metadata, 'musl notice provenance mismatch');
  assert.match(build.linkage?.mapSha256 ?? '', /^[0-9a-f]{64}$/);
  const inputs = build.linkage?.runtimeInputs;
  assert.ok(Array.isArray(inputs) && inputs.length === 7, 'musl runtime input evidence is missing');
  for (const row of inputs) {
    assert.match(row.path, /^self-contained\/(?:r?crt1\.o|crti\.o|crtbeginS?\.o|libc\.a|libunwind\.a|crtendS?\.o|crtn\.o)$/);
    assert.ok(Number.isInteger(row.bytes) && row.bytes > 0);
    assert.match(row.sha256, /^[0-9a-f]{64}$/);
    assert.equal(row.sha256, notices.provenance.auditedRuntimeInputs?.[build.target]?.[row.path],
      'runtime input differs from audited Rust distribution: ' + row.path);
  }
  const startup = machine === 62 ? ['rcrt1.o','crtbeginS.o','crtendS.o'] : ['crt1.o','crtbegin.o','crtend.o'];
  assert.deepEqual(inputs.map(row => row.path).sort(),
    [...startup, 'crti.o', 'crtn.o', 'libc.a', 'libunwind.a'].map(name => 'self-contained/' + name).sort(),
    'unexpected musl runtime input inventory');
}
