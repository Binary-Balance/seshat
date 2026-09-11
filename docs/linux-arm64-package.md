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
parallel controls. The npm and standalone consumers use a disposable `PATH`
containing Node and `/bin/sh`; `cargo` and `rustc` must be absent. The CLI
checks source preservation, fresh coverage, thresholds, timeouts, SIGINT,
SIGTERM and cleanup. The workspace install remains in the npm proof. The
parallel proof runs the extracted standalone binary, including cancellation,
deadlines, worker isolation, source-integrity and descendant cleanup checks.

The workflow retains a portable preflight report, package metadata and hashes,
proof JSON, raw command logs and the two candidate archives. Missing proof
reports do not turn a failed command into a passing result. Artifact paths in
the summary use the retained artifact names rather than the runner's temporary
directories. The report also records the source commit supplied by GitHub;
that commit can be a synthetic pull-request merge commit, so it must be kept
separate from the PR head when describing provenance.

The selected runner reports Linux 6.8, currently observed as
`6.8.0-1064-azure`. Linux 6.8 is the ARM64 candidate kernel family for this
milestone. The exact Azure patch is the tested host observation, not a claim
that every 6.8 patch behaves identically. The proof does not boot an older
kernel and does not turn Node's upstream kernel requirement into a Seshat
minimum. Final support remains pending the hosted installed proof and its
review.

This slice says nothing about Windows, macOS, Alpine or other glibc versions.
Those platform gates remain separate work. It also does not publish the npm
scope or claim a public release artifact.
