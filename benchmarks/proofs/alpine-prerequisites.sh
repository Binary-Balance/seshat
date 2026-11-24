#!/usr/bin/env bash
# Native musl build and installed-package evidence; never publishes packages.
set -euo pipefail
cd "$(dirname "$0")/../.."

arch="${1:?usage: alpine-prerequisites.sh x64|arm64}"
case "$arch" in
  x64) target=x86_64-unknown-linux-musl ;;
  arm64) target=aarch64-unknown-linux-musl ;;
  *) exit 2 ;;
esac
export CARGO_TARGET_DIR="$PWD/work/alpine/$arch/target"
output="$PWD/work/alpine/$arch/evidence"
test ! -e "$output" || { echo "Use a fresh evidence directory: $output" >&2; exit 2; }
mkdir -p "$output" work/assurance-proofs
# Some existing proofs choose their own result path. Retain their JSON even on failure.
retain_results() {
  python3 - "$output" <<'PYTHON'
from pathlib import Path
import shutil
import sys
for source in Path('work/assurance-proofs').rglob('result.json'):
    destination = Path(sys.argv[1], 'raw-results', source.relative_to('work/assurance-proofs'))
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
PYTHON
}
trap retain_results EXIT
export SESHAT_CLI_BINARY="$CARGO_TARGET_DIR/release/seshat"
export SESHAT_PROOF_BINARY="$CARGO_TARGET_DIR/release/seshat-proofs"
# Keep the experiment's runtime selection independent of ambient build flags.
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS

node --input-type=module - "$arch" "$target" "$output" <<'JS'
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {release} from 'node:os';
import {loadRuntimeNoticeAssets} from './packaging/runtime-notice-check.mjs';
const [arch, target, output] = process.argv.slice(2);
const run = (cmd, args) => execFileSync(cmd, args, {encoding:'utf8'}).trim();
const rust = run('rustc', ['-vV']);
const alpine = readFileSync('/etc/alpine-release', 'utf8').trim();
assert.equal(process.arch, arch, 'requires a native host of the requested architecture');
assert.match(alpine, /^3\.24\./);
assert.ok(rust.includes(`host: ${target}\n`), 'requires the native musl toolchain');
assert.ok(rust.includes('commit-hash: 48a229ceaefd4985c50990b14116b6d856af0985\n'));
assert.equal(process.report.getReport().header.glibcVersionRuntime, undefined);
assert.match(process.versions.node, /^24\./);
assert.ok(Number(process.versions.node.split('.')[1]) >= 20);
const muslNotices = loadRuntimeNoticeAssets('packaging/runtime-notices/rust-1.98.1-musl');
writeFileSync(output + '/host.json', JSON.stringify({alpine, arch, target, kernel:release(),
  sourceCommit:process.env.SESHAT_SOURCE_COMMIT ?? null,
  workflowRun:process.env.SESHAT_WORKFLOW_RUN ?? null,
  image:process.env.SESHAT_PROOF_IMAGE ?? null,
  nodeArchiveSha256:process.env.SESHAT_NODE_ARCHIVE_SHA256 ?? null,
  nodeExecutableSha256:createHash('sha256').update(readFileSync(process.execPath)).digest('hex'),
  muslRuntimeNoticeAssets:muslNotices.files.map(({path, bytes, sha256}) => ({path, bytes, sha256})),
  rust, node:process.version, npm:run('npm', ['--version']),
  packages:run('apk', ['info', '-v']),
}, null, 2) + '\n');
JS

node --test benchmarks/proofs/liveness.test.mjs 2>&1 | tee "$output/liveness-tests.log"
node --test packaging/launcher.test.mjs packaging/musl.test.mjs 2>&1 | tee "$output/packaging-tests.log"
npm ci --prefix benchmarks --ignore-scripts --no-audit --no-fund 2>&1 | tee "$output/npm-benchmarks.log"
npm ci --prefix benchmarks/proofs --ignore-scripts --no-audit --no-fund 2>&1 | tee "$output/npm-proofs.log"
# The offline notice inventory includes dependencies from every locked target.
cargo fetch --locked --manifest-path crates/seshat/Cargo.toml 2>&1 | tee "$output/cargo-fetch.log"
cargo test --release --locked --offline --manifest-path crates/seshat/Cargo.toml 2>&1 | tee "$output/rust-tests.log"
# Repeat packing requires committed, clean source and builds in two fresh owned directories.
SESHAT_REPEAT_OUTPUT="$output/repeat-pack.json" RUSTFLAGS=invalid CARGO_ENCODED_RUSTFLAGS=invalid \
  node packaging/repeat-pack.mjs --native-musl 2>&1 | tee "$output/repeat-pack.log"
pack_result="$(find "$output/repeat-pack-attempts" -name result-0.json)"
test -f "$pack_result"
export SESHAT_CLI_BINARY="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).binaryPath' "$pack_result")"
export SESHAT_PROOF_BINARY="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).proofBinary' "$pack_result")"
node --input-type=module - "$pack_result" "$output" "$arch" <<'JS'
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {copyFileSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
const [result, output, arch] = process.argv.slice(2);
const pack = JSON.parse(readFileSync(result));
const key = 'linux-' + arch + '-musl';
const release = join(output, 'staged');
execFileSync(process.execPath, ['packaging/release.mjs', '--output', release,
  '--binary', key + '=' + pack.binaryPath,
  '--build-info', key + '=' + join(pack.packageStage, 'BUILD.json'),
  '--notices', key + '=' + join(pack.packageStage, 'THIRD_PARTY_NOTICES.txt')],
  {stdio:'inherit'});
const manifest = JSON.parse(readFileSync(join(release, 'release.json')));
const native = manifest.native.find(row => row.key === key);
const nativeArchive = join(release, native.archive.file);
execFileSync(process.execPath, ['packaging/metadata.test.mjs', pack.tarball, nativeArchive], {stdio:'inherit'});
copyFileSync(join(release, manifest.entry.archive.file), join(output, 'seshat-entry.tgz'));
copyFileSync(nativeArchive, join(output, 'seshat-' + key + '-release.tgz'));
for (const name of ['BUILD.json', 'THIRD_PARTY_NOTICES.txt']) copyFileSync(join(pack.packageStage, name), join(output, name));
copyFileSync(join(dirname(pack.packageStage), 'seshat.map'), join(output, 'seshat.map'));
assert.equal(manifest.native.length, 7);
JS
rustc --print cfg > "$output/rust-cfg.txt"
cc --version > "$output/cc.txt"
ld --version > "$output/ld.txt"
find "$(rustc --print target-libdir)" -type f \( -name '*.a' -o -name '*.o' \) \
  -exec sha256sum {} + > "$output/runtime-archives.sha256"
sha256sum "$SESHAT_CLI_BINARY" "$SESHAT_PROOF_BINARY" > "$output/binaries.sha256"
readelf -h -l -d "$SESHAT_CLI_BINARY" > "$output/cli-elf.txt"
readelf -h -l -d "$SESHAT_PROOF_BINARY" > "$output/proof-elf.txt"

proof() {
  local name="$1"
  shift
  SESHAT_PROOF_OUTPUT="$output/$name.json" "$@" 2>&1 | tee "$output/$name.log"
}
export SESHAT_BINARY_SHA256="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).binary' "$pack_result")"
export SESHAT_NATIVE_TARBALL_SHA256="$(sha256sum "$output/seshat-linux-$arch-musl-release.tgz" | cut -d ' ' -f 1)"
export SESHAT_ENTRY_TARBALL_SHA256="$(sha256sum "$output/seshat-entry.tgz" | cut -d ' ' -f 1)"
SESHAT_STANDALONE_SHA256="$SESHAT_NATIVE_TARBALL_SHA256" proof standalone node benchmarks/proofs/standalone.mjs "$output/seshat-linux-$arch-musl-release.tgz" "$SESHAT_PROOF_BINARY"
proof npm-package node benchmarks/proofs/npm-package.mjs "$output/seshat-entry.tgz" "$output/seshat-linux-$arch-musl-release.tgz"
proof cli node benchmarks/proofs/cli.mjs
SESHAT_PARALLEL_CLI=1 proof parallel node benchmarks/proofs/parallel.mjs
proof lifecycle node benchmarks/proofs/lifecycle.mjs
proof unix-supervision python3 benchmarks/proofs/unix-supervision.py
proof execute-cancellation node benchmarks/proofs/execute-cancellation.mjs
proof job-deadlines node benchmarks/proofs/job-deadlines.mjs --cli "$SESHAT_CLI_BINARY"
proof vitest node benchmarks/proofs/vitest-check.mjs --cli "$SESHAT_CLI_BINARY" --cases stack,assertion,survived,before-all
npm ci --prefix benchmarks/proofs/fixtures/jest-expo --ignore-scripts --no-audit --no-fund 2>&1 | tee "$output/npm-jest.log"
proof jest-expo node benchmarks/proofs/jest-expo-check.mjs --cli "$SESHAT_CLI_BINARY" --cases normal-1,assertion-kill,survivor,before-all
node --input-type=module - "$output" "$arch" <<'JS'
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
const [output, arch] = process.argv.slice(2);
const read = name => JSON.parse(readFileSync(output + '/' + name + '.json'));
const artifact = file => {
  const bytes = readFileSync(output + '/' + file);
  return {file, bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex')};
};
const build = read('BUILD');
const npm = read('npm-package');
const standalone = read('standalone');
assert.equal(npm.build.binarySha256, build.binarySha256);
assert.equal(standalone.build.binarySha256, build.binarySha256);
const provenance = {
  repository:process.env.GITHUB_REPOSITORY ?? null, ref:process.env.GITHUB_REF ?? null,
  workflow:process.env.GITHUB_WORKFLOW ?? null, workflowRef:process.env.GITHUB_WORKFLOW_REF ?? null,
  workflowSha:process.env.GITHUB_WORKFLOW_SHA ?? null, job:process.env.GITHUB_JOB ?? null,
  runId:process.env.GITHUB_RUN_ID ?? null, runAttempt:process.env.GITHUB_RUN_ATTEMPT ?? null,
  sourceCommit:build.sourceCommit,
};
const summary = {schemaVersion:1, kind:'seshat-linux-' + arch + '-musl-package-proof',
  sourceCommit:build.sourceCommit, host:read('host'), node:process.version,
  preflight:{provenance, validation:{passed:true}},
  artifacts:{entryArchive:artifact('seshat-entry.tgz'),
    releaseNativeArchive:artifact('seshat-linux-' + arch + '-musl-release.tgz'),
    binary:{bytes:build.binaryBytes, sha256:build.binarySha256}},
  package:{name:build.package, version:build.packageVersion, target:build.target, binarySha256:build.binarySha256},
  build, archives:{entry:artifact('seshat-entry.tgz'), native:artifact('seshat-linux-' + arch + '-musl-release.tgz')},
  validation:{passed:true, installedNpm:true, installedStandalone:true, repeatPack:true,
    lifecycle:true, supervision:true, cancellation:true, deadlines:true, vitest:true, jest:true},
};
writeFileSync(output + '/summary.json', JSON.stringify(summary, null, 2) + '\n');
writeFileSync(output + '/result.json', '{"completed":true}\n');
JS
