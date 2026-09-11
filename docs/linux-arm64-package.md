# Linux ARM64 package protocol

This protocol is the next bounded slice of issue 2 after the ARM64 host
preflight. It builds and exercises the private native ARM64 candidate on
GitHub's `ubuntu-22.04-arm` runner. The build runs on the ARM64 runner itself.
It does not cross-compile, use QEMU or lower the existing Linux x64 baseline.

The candidate is deliberately narrow:

- Linux ARM64, Ubuntu 22.04 Jammy and glibc 2.35.
- Rust 1.98.1, Node 24.20.0 and npm 11.19.0.
- `aarch64-unknown-linux-gnu`, ELF machine `183`, package CPU `arm64`.
- GLIBC symbol requirements no newer than 2.35.

The existing x64 invocation still takes the three pinned Debian 11 archives:

```sh
node packaging/pack.mjs work/debian11-inputs
```

It keeps the x64 target, archive hashes, Debian sysroot flags and glibc 2.31
ceiling. ARM64 uses an explicit mode instead:

```sh
npm ci --prefix benchmarks
npm ci --prefix benchmarks/proofs
cargo fetch --locked --manifest-path benchmarks/proofs/Cargo.toml
cargo test --locked --offline --manifest-path benchmarks/proofs/Cargo.toml
node packaging/pack.mjs --native-arm64
```

The packer checks the host before compiling. It requires Linux, `arm64`, Ubuntu
22.04 and glibc 2.35, then builds both the candidate and the legacy proof
binary from the locked Cargo graph. `BUILD.json` records the target, CPU,
glibc ceiling, symbols, linked libraries, dependency notices and binary hash.
The npm tarball and standalone archive contain the binary, `BUILD.json`,
`LICENSE`, `README.md`, `THIRD_PARTY_NOTICES.txt` and package metadata. The
workflow passes both archive hashes into the corresponding proofs. The
standalone proof checks its archive listing and hash before extraction into a
path containing spaces. Both proofs compare the installed binary hash with the
packer's recorded hash, so the standalone CLI run cannot silently switch to a
different build.

The workflow fetches Cargo and npm dependencies before any offline build or
pack command. It then runs native Rust tests, the 16 npm installation checks,
the 43 installed CLI scenarios including legacy parity, and the 11 existing
parallel controls. Each native archive is also installed into the checked-in
Jest/Expo fixture using its pinned lockfile and exercised through
`normal-1,assertion-kill,survivor,before-all`, and into the checked-in Vitest
fixture using the locked proof dependencies and
`stack,assertion,survived,before-all`. The npm and standalone consumers use a
disposable `PATH` containing Node and `/bin/sh`; `cargo` and `rustc` must be
absent. The installed runner reports also record that the Rust environment,
`NODE_OPTIONS` and `SESHAT_MUTANT_ID` are absent. The CLI checks source
preservation, fresh coverage, thresholds, timeouts, SIGINT, SIGTERM and
cleanup. The workspace install remains in the npm proof. The parallel proof
runs the extracted standalone binary, including cancellation, deadlines,
worker isolation, source-integrity and descendant cleanup checks. The native
lifecycle proof exercises all four cancellation phases for SIGINT and SIGTERM,
plus timeout, output overflow and leader-exit handling, with the matching
packaged proof binary.

The workflow retains a portable preflight report, package metadata and hashes,
the npm, standalone, Jest/Expo, Vitest and lifecycle JSON reports, raw command
logs and the two candidate archives. Missing, invalid or partial proof reports
do not turn a failed command into a passing result. Artifact paths in the
summary use the retained artifact names rather than the runner's temporary
directories. The report also records the source commit supplied by GitHub;
that commit can be a synthetic pull-request merge commit, so it must be kept
separate from the PR head when describing provenance.

## Current protocol invocation

The current ARM64 workflow invokes the added installed-runner and lifecycle
checks after the package and standalone proofs:

```sh
node benchmarks/proofs/jest-expo-check.mjs \
  --tarball work/arm64/seshat-linux-arm64.tgz \
  --cases normal-1,assertion-kill,survivor,before-all
node benchmarks/proofs/vitest-check.mjs \
  --tarball work/arm64/seshat-linux-arm64.tgz \
  --deps "$PWD/benchmarks/proofs" \
  --cases stack,assertion,survived,before-all
SESHAT_PROOF_BINARY="$PROOF_BINARY" node benchmarks/proofs/lifecycle.mjs
node benchmarks/proofs/linux-arm64-summary.mjs work/arm64
```

## Observed native proof

The successful hosted proof is [workflow run 34554949984](https://github.com/Binary-Balance/seshat/actions/runs/34554949984)
from [PR 19](https://github.com/Binary-Balance/seshat/pull/19). It tested the
synthetic pull-request merge commit
`068902abc983d8444932796aa78e2a5b12421653` at
`refs/pull/19/merge`; the PR head was
`c62bb69dbf300532d2a80f91f02f39648d031fe9`. The merge commit is the tested
source and workflow revision. It is not the same provenance claim as testing
the PR head directly.

The committed [portable summary](../outputs/linux-arm64-package.json) has
SHA-256
`51d62ccc2388117b68d4e088c9f8725bc463204d629ebd17901a566f65ad7047`.
Its validation is `passed: true` with no recorded failures.
[Package metadata](../outputs/linux-arm64-package-result.json), the normalized
[pack log](../outputs/linux-arm64-package-pack.log),
[npm log](../outputs/linux-arm64-package-npm.log),
[standalone log](../outputs/linux-arm64-package-standalone.log) and raw
[Rust test log](../outputs/linux-arm64-package-rust-tests.log) are retained
with it. The candidate archives are retained by the workflow artifact and are
not committed to the repository.

The exact hosted inputs and results were:

| Item | Observed result |
| --- | --- |
| Runner and userspace | `ubuntu-22.04-arm`, Ubuntu 22.04.5 LTS/Jammy, glibc 2.35, image `20260907.126.1` |
| Architecture and target | Node `arm64`, `uname -m` `aarch64`, `aarch64-unknown-linux-gnu`, ELF machine check `183`, package CPU `arm64` |
| Kernel | `6.8.0-1064-azure`; Linux 6.8 is the candidate kernel family for this proof |
| Runtime | Node `v24.20.0`, npm `11.19.0` |
| Native toolchain | rustc/Cargo `1.98.1`, Rust host `aarch64-unknown-linux-gnu`, GCC/G++ `11.4.0`, Clang `14.0.0`, GNU ld `2.38`, Make `4.3` |
| Rust proof | `cargo test --locked --offline --manifest-path benchmarks/proofs/Cargo.toml`: 30 passed, 0 failed; the additional binary and doc-test targets ran 0 tests |
| npm proof | 16 retained checks, including 43 installed CLI scenarios and legacy parity |
| Standalone proof | 43 installed CLI scenarios and 11 parallel controls; archive listing and extraction passed |
| GLIBC metadata | Required symbols through `GLIBC_2.34`, within the declared 2.35 ceiling; libraries `libgcc_s.so.1`, `libm.so.6`, `libc.so.6` |

The historical run's locked dependency fetches, offline test and package proofs
were:

```sh
cargo test --locked --offline --manifest-path benchmarks/proofs/Cargo.toml
node packaging/pack.mjs --native-arm64
node benchmarks/proofs/npm-package.mjs work/arm64/seshat-linux-arm64.tgz
SESHAT_PROOF_BINARY="$PROOF_BINARY" node benchmarks/proofs/standalone.mjs \
  work/arm64/seshat-linux-arm64-standalone.tar.gz "$PROOF_BINARY"
node benchmarks/proofs/linux-arm64-summary.mjs work/arm64
```

The npm tarball is 951,117 bytes with SHA-256
`50bb9e2cb60ff5e0d394e53a8119dfaf7b9b9f5e2e25da1cac0c596b23d2a12d`.
The standalone archive is 929,461 bytes with SHA-256
`e88bd754dba5d9521a8215c15e4895b63c5326b423fc192cab46bd07b1cda661`.
The 2,367,976-byte binary has SHA-256
`c258be2dff7219c7d691d2753045e68869bb2b3368092f8c11eb92e6eab981b8` in
both archives, and the locked Cargo graph is identified by
`bb820a335e5eb7b35e9185cedaabf68b1608f4712c48f73bafcd2bac180e757d`.
Each archive contains `BUILD.json`, `LICENSE`, `README.md`,
`THIRD_PARTY_NOTICES.txt`, `bin/seshat` and `package.json`.

The earlier [run 34554344746](https://github.com/Binary-Balance/seshat/actions/runs/34554344746)
is explicitly invalid installation evidence. Its summary recorded missing npm
and standalone results and failed validation after both proof entry points hit
`ENOENT` creating their scratch directories. Shell pipelines also masked those
failures, so its green job status did not prove an installation. The corrected
run above is the first retained successful installed proof for this slice.

The existing x64 route was also checked by reusing the retained candidate and
matching x64 proof binary:

```sh
SESHAT_PROOF_BINARY=work/npm-pack-kFmKF4/target/x86_64-unknown-linux-gnu/release/seshat-proofs \
  node benchmarks/proofs/npm-package.mjs \
  work/npm-pack-kFmKF4/binary-balance-seshat-0.0.0.tgz
```

That verifier passed 16 checks and 43 installed CLI scenarios. It does not
alter the existing Debian 11 x64 archive route.

The selected runner reports Linux 6.8, currently observed as
`6.8.0-1064-azure`. Linux 6.8 is the ARM64 candidate kernel family for this
milestone. The exact Azure patch is the tested host observation, not a claim
that every 6.8 patch behaves identically. The proof does not boot an older
kernel and does not turn Node's upstream kernel requirement into a Seshat
minimum. Final support remains pending review of this hosted proof.

This slice says nothing about Windows, macOS, Alpine or other glibc versions.
Those platform gates remain separate work. It also does not publish the npm
scope or claim a public release artifact.
