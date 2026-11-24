#!/usr/bin/env bash
# Run only in the pinned native Alpine consumer image; no Rust build is needed.
set -euo pipefail
mode="${1:?local|registry}"
arch="${2:?x64|arm64}"
node_sha256="${3:?Node archive SHA-256}"
case "$mode" in local|registry) ;; *) exit 2 ;; esac
case "$arch" in x64|arm64) ;; *) exit 2 ;; esac
if command -v rustc || command -v cargo; then
  echo "Alpine consumer must not include a Rust toolchain" >&2
  exit 2
fi
git config --global --add safe.directory /workspace
curl --fail --location --max-time 120 --retry 3 \
  "https://unofficial-builds.nodejs.org/download/release/v24.20.0/node-v24.20.0-linux-${arch}-musl.tar.xz" \
  -o /tmp/node.tar.xz
echo "$node_sha256  /tmp/node.tar.xz" | sha256sum -c -
mkdir /opt/node
tar -xJf /tmp/node.tar.xz --strip-components=1 -C /opt/node
export PATH="/opt/node/bin:$PATH"
export SESHAT_TARGET="linux-${arch}-musl"
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {validateHost} from './benchmarks/proofs/registry-install.mjs';
assert.equal(process.version, 'v24.20.0');
assert.equal(execFileSync('npm', ['--version'], {encoding:'utf8'}).trim(), '11.19.0');
validateHost(process.env.SESHAT_TARGET);
NODE
if [ "$mode" = registry ]; then
  mkdir -p "work/registry-install/$SESHAT_TARGET"
  node --test --test-isolation=none benchmarks/proofs/registry-install.test.mjs \
    2>&1 | tee "work/registry-install/$SESHAT_TARGET/negative-checks.log"
  node benchmarks/proofs/registry-install.mjs --target "$SESHAT_TARGET" \
    --output "work/registry-install/$SESHAT_TARGET/registry-install.json" \
    2>&1 | tee "work/registry-install/$SESHAT_TARGET/registry-install.log"
else
  node examples/verify.mjs --archives "work/release-local-install/$SESHAT_TARGET/archives" \
    --output "work/release-local-install/$SESHAT_TARGET/verifier.json" \
    2>&1 | tee "work/release-local-install/$SESHAT_TARGET/verifier.log"
  node --input-type=module <<'NODE'
  import assert from 'node:assert/strict';
  import {readFileSync} from 'node:fs';
  const target = process.env.SESHAT_TARGET;
  const read = path => JSON.parse(readFileSync(path));
  const audit = read('docs/research/release-notice-audit.json');
  const staging = read(`work/release-local-install/${target}/archive-staging.json`);
  const verifier = read(`work/release-local-install/${target}/verifier.json`);
  const coordinate = audit.coordinates.find(value => value.target === target);
  assert.ok(coordinate, `missing audit coordinate: ${target}`);
  assert.equal(staging.validation.passed, true);
  assert.equal(verifier.validation.passed, true);
  assert.deepEqual(verifier.installed.host, {platform:process.platform, arch:process.arch});
  assert.equal(verifier.installed.native.package, coordinate.package);
  assert.equal(verifier.installed.native.sha256, coordinate.buildProvenance.binary.sha256);
  assert.equal(verifier.installed.native.bytes, coordinate.buildProvenance.binary.bytes);
NODE
fi
