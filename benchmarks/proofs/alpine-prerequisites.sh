#!/usr/bin/env bash
# Native feasibility evidence only; this does not stage or publish musl packages.
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
mkdir -p "$output" work/assurance-proofs
rm -f "$output/result.json"
export SESHAT_CLI_BINARY="$CARGO_TARGET_DIR/release/seshat"
export SESHAT_PROOF_BINARY="$CARGO_TARGET_DIR/release/seshat-proofs"
# Keep the experiment's runtime selection independent of ambient build flags.
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS

node --input-type=module - "$arch" "$target" "$output" <<'JS'
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {release} from 'node:os';
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
writeFileSync(output + '/host.json', JSON.stringify({alpine, arch, target, kernel:release(),
  sourceCommit:process.env.SESHAT_SOURCE_COMMIT ?? null,
  workflowRun:process.env.SESHAT_WORKFLOW_RUN ?? null,
  image:process.env.SESHAT_PROOF_IMAGE ?? null,
  rust, node:process.version, npm:run('npm', ['--version']),
  packages:run('apk', ['info', '-v']),
}, null, 2) + '\n');
JS

npm ci --prefix benchmarks --ignore-scripts --no-audit --no-fund 2>&1 | tee "$output/npm-benchmarks.log"
npm ci --prefix benchmarks/proofs --ignore-scripts --no-audit --no-fund 2>&1 | tee "$output/npm-proofs.log"
cargo test --release --locked --manifest-path crates/seshat/Cargo.toml 2>&1 | tee "$output/rust-tests.log"
for binary in seshat seshat-proofs; do
  cargo rustc --release --locked --manifest-path crates/seshat/Cargo.toml --bin "$binary" -- \
    -C "link-arg=-Wl,-Map,$output/$binary.map" 2>&1 | tee "$output/build-$binary.log"
done
rustc --print cfg > "$output/rust-cfg.txt"
cc --version > "$output/cc.txt"
ld --version > "$output/ld.txt"
find "$(rustc --print target-libdir)" -type f \( -name '*.a' -o -name '*.o' \) \
  -exec sha256sum {} + > "$output/runtime-archives.sha256"
sha256sum "$SESHAT_CLI_BINARY" "$SESHAT_PROOF_BINARY" > "$output/binaries.sha256"
# Retain the actual ELF linkage; a static musl runtime needs its own notice audit.
readelf -h -l -d "$SESHAT_CLI_BINARY" > "$output/cli-elf.txt"
readelf -h -l -d "$SESHAT_PROOF_BINARY" > "$output/proof-elf.txt"

proof() {
  local name="$1"
  shift
  SESHAT_PROOF_OUTPUT="$output/$name.json" "$@" 2>&1 | tee "$output/$name.log"
}
proof cli node benchmarks/proofs/cli.mjs
SESHAT_PARALLEL_CLI=1 proof parallel node benchmarks/proofs/parallel.mjs
proof lifecycle node benchmarks/proofs/lifecycle.mjs
proof unix-supervision python3 benchmarks/proofs/unix-supervision.py
proof execute-cancellation node benchmarks/proofs/execute-cancellation.mjs
proof job-deadlines node benchmarks/proofs/job-deadlines.mjs --cli "$SESHAT_CLI_BINARY"
proof vitest node benchmarks/proofs/vitest-check.mjs --cli "$SESHAT_CLI_BINARY" --cases stack,assertion,survived,before-all
npm ci --prefix benchmarks/proofs/fixtures/jest-expo --ignore-scripts --no-audit --no-fund 2>&1 | tee "$output/npm-jest.log"
proof jest-expo node benchmarks/proofs/jest-expo-check.mjs --cli "$SESHAT_CLI_BINARY" --cases normal-1,assertion-kill,survivor,before-all
printf '{"completed":true}\n' > "$output/result.json"
