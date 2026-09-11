# Linux x64 package protocol

This is the remaining native Linux x64 slice of issue 2. It reruns the x64
package after shared runtime changes settle, while preserving the existing
Debian 11/glibc 2.31 build route.

The candidate is deliberately bounded:

- GitHub `ubuntu-22.04`, native `x86_64`, Ubuntu 22.04/Jammy and host glibc
  2.35.
- Rust 1.98.1, Node 24.20.0 and npm 11.19.0.
- The package is linked against the pinned Debian 11 libraries and keeps the
  glibc 2.31 ceiling and x64 ELF machine `62` assertion.
- The workflow records the actual host kernel and fails below the candidate
  Linux 6.8 kernel family. It records the exact patch; it does not boot an
  older kernel or claim that every 6.8 patch is identical.

The native Ubuntu host is useful for the build and installed checks. The
minimum-userspace check is separate: `linux-debian.mjs` extracts the pinned
Debian 11 rootfs and Node 24.20.0 archive, then runs both installed routes in a
Bubblewrap network namespace with no host libraries, Cargo or Rustc mounted.
Debian 11 LTS ended on 2026-08-31, so this is a pinned compatibility snapshot,
not a claim that Debian 11 remains a maintained distribution.

## Workflow proof

The workflow records `preflight.json`, package metadata, the repeat-pack proof,
both retained archive hashes, native npm and standalone reports, the Debian11
report, raw logs, Rust tests and `summary.json`. It never uploads Cargo's target
directory. The summary is fail-closed: missing or invalid reports, a missing or
changed archive, a failed repeat comparison, a kernel below 6.8, or an
incomplete proof leaves `validation.passed` false and the workflow failed.

The native checks are:

- Rust tests from the locked Cargo graph on the x64 host.
- The x64 package built with `pack.mjs` and the three existing pinned Debian
  build archives. The packer continues to verify their SHA-256 values.
- The npm route's 16 package checks and 43 installed CLI scenarios.
- The same npm `.tgz` retained under the standalone artifact name. The
  standalone verifier strips npm's `package/` prefix, then runs the exact
  six-file payload with the same 43 CLI scenarios and 11 parallel process
  controls. Both consumers run with a disposable `PATH` where Cargo and Rustc
  are absent.
- Two clean packer invocations whose native binary, npm archive and standalone
  archive bytes and hashes must all match before the proof is published.
- The just-built archive installed into the checked-in Jest/Expo fixture using
  its pinned lockfile, with `normal-1,assertion-kill,survivor,before-all`.
- The just-built archive installed into the checked-in Vitest fixture using the
  locked proof dependencies, with `stack,assertion,survived,before-all`.
- The native lifecycle proof using the matching packaged proof binary. It runs
  all four cancellation phases for SIGINT and SIGTERM, plus timeout, output
  overflow and leader-exit handling, and retains cleanup and scratch results.

The installed runner reports explicitly record that Cargo and Rustc are absent,
the Rust environment settings and ambient `NODE_OPTIONS`/`SESHAT_MUTANT_ID` are
cleared, the candidate archive and executable hashes match package metadata,
source fixtures remain unchanged and each Seshat scratch directory is empty.

The Debian11 proof repeats the npm route and the generated standalone route in
the isolated userspace. It records the same CLI/process controls, glibc 2.31,
the actual shared host kernel and archive hashes. Ubuntu-only installation
success is therefore not used as the minimum-userspace result.

## Observed native proof

The successful hosted proof is [workflow run 34558525165](https://github.com/Binary-Balance/seshat/actions/runs/34558525165)
from [PR 21](https://github.com/Binary-Balance/seshat/pull/21). It tested the
synthetic pull-request merge commit
`19eb8fa380543ee40df4e7571075b88b52358e3f` at `refs/pull/21/merge`; the PR
head was `b2b73186972c19e4e4e833321ca74dc1bff0913f` on
`codex/linux-x64-package`. The merge commit is the tested source and workflow
revision. It is kept separate from the PR head when describing provenance.

The committed [portable summary](../outputs/linux-x64-package.json) has
SHA-256
`0c12ff043f7a36aff78a1f2b0cce7378a43487b555a879adeb5b382933a9b9d6`.
It records `validation.passed: true`, all four package/npm/standalone/Debian11
validation flags as true, and no failures. [Package metadata](../outputs/linux-x64-package-result.json),
[preflight](../outputs/linux-x64-preflight.json), the normalized
[pack log](../outputs/linux-x64-package-pack.log), [npm log](../outputs/linux-x64-package-npm.log),
[standalone log](../outputs/linux-x64-package-standalone.log), [Debian11 log](../outputs/linux-x64-package-debian11.log)
and [Rust test log](../outputs/linux-x64-package-rust-tests.log) are retained
with it. The candidate archives remain in the hosted workflow artifact and are
not committed here.

The exact hosted inputs and results were:

| Item | Observed result |
| --- | --- |
| Runner and userspace | `ubuntu-22.04`, Ubuntu 22.04.5 LTS/Jammy, host glibc 2.35, pinned Debian 11/glibc 2.31 installed proof, image `20260907.292.1` |
| Architecture and target | Node `x64`, `uname -m` `x86_64`, `x86_64-unknown-linux-gnu`, ELF machine `62` |
| Kernel | `6.8.0-1064-azure`; Linux 6.8 is the candidate kernel family for this proof |
| Runtime | Node `v24.20.0`, npm `11.19.0` |
| Native toolchain | rustc/Cargo `1.98.1`, Rust host `x86_64-unknown-linux-gnu`, GCC/G++ `11.4.0`, Clang `14.0.0`, GNU ld `2.38`, Make `4.3` |
| Rust proof | `cargo test --locked --offline --manifest-path benchmarks/proofs/Cargo.toml`: 30 passed, 0 failed; the additional binary and doc-test targets ran 0 tests |
| npm proof | 16 retained checks, including 43 installed CLI scenarios and legacy parity |
| Standalone proof | 43 installed CLI scenarios and 11 parallel controls; archive listing and extraction passed |
| Debian11 proof | Both installed routes passed in the pinned rootfs: npm 43 CLI/11 parallel and standalone 43 CLI/11 parallel; Rust was unavailable inside the proof |
| GLIBC metadata | Required symbols through `GLIBC_2.30`, within the declared 2.31 ceiling; libraries `libgcc_s.so.1`, `libpthread.so.0`, `libm.so.6`, `libdl.so.2`, `libc.so.6` |

The npm log intentionally records exit 2 for incomplete/invalid-input controls
and exit 1 for threshold and platform-rejection controls. Those are expected
scenario results; the 16-check verifier passed.

The npm tarball is 973,904 bytes with SHA-256
`e34054e4703d4343b41009b03bdd15397ec3e31d86de5f3570edd773a9c821bf`.
The standalone archive is 964,574 bytes with SHA-256
`de5dd9add7fef2a3df286b723aacb8b55ceb37e5c0da91c93fa3f8ff96574f0a`.
The 2,449,008-byte binary has SHA-256
`7a16e50a4e910467da94f44306003f2bc2633dffe7986a69d6fee14d3df0522a` in
the package metadata, and the locked Cargo graph is identified by
`bb820a335e5eb7b35e9185cedaabf68b1608f4712c48f73bafcd2bac180e757d`.

These hashes identify the successful run's outputs. The run does not prove
byte-identical reproducibility across separate builds: builds can retain
identical executable sections while differing in symbol-table/build-ID
ordering, and standalone archive timestamps vary. A later cross-platform
reproducibility, lifecycle and runner audit remains separate work.

## Historical native binary reproducibility

The pair below predates the current native release policy. At source commit
`655a10c`, `benchmarks/proofs/Cargo.toml` used `lto = "thin"` and
`strip = "symbols"`. The Linux packer also passed `-Wl,--build-id=none` through
`cc` in both native Linux modes. This removed link metadata during the normal
build; it did not rewrite the binary after linking. The x64 Debian route kept
its existing sysroot flags alongside the linker control.

Two clean x64 builds were run from main `655a10c` with the
pinned local Rust 1.98.1 toolchain, Node 24.20.0, npm 11.19.0, locked Cargo
graph (`Cargo.lock` SHA-256
`bb820a335e5eb7b35e9185cedaabf68b1608f4712c48f73bafcd2bac180e757d`) and the
existing Debian 11 input archives. The host was Debian 13, x86_64, Linux
6.12.107 with host glibc 2.41; the package was linked against the pinned
sysroot and required no symbol newer than `GLIBC_2.30`. Both binaries ran
`seshat --version`, and the binary, `BUILD.json` and npm archive compared
byte-for-byte:

| Item | SHA-256 | Bytes |
| --- | --- | ---: |
| Native binary | `6ab68bebbb33974443a5d584380dde96e4eb794c2740742b85227f1b5a5b4493` | 1,939,872 |
| `BUILD.json` | `396fcaa9fb9a9ddabb66d9cbcc8b9fe2cbbc2b488f892f2ed65332940add8476` | 7,692 |
| npm archive | `ddc1779d84bb3a0436db746b96fa3a6ed9dc484338dd25f625cf165d7015544c` | 889,270 |

The final npm archive was installed twice into disposable consumers with offline
npm and real child-process spawning. Each installed executable passed
`--version` and `--help` with Cargo and Rustc absent from `PATH`. This is
reproducibility evidence for the named Linux x64 source, host, toolchain and
sysroot only. It does not claim byte identity for Linux ARM64, macOS or
Windows. macOS uses the standard Cargo stripping setting but has no byte
identity evidence here; Windows linker rules remain separate. The current
standalone artifact reuses the npm archive bytes, while the older historical
standalone tarball evidence above retains its original metadata.

## Current native reproducibility policy

Native proof builds now use the source-controlled `benchmarks/proofs/Cargo.toml`
release profile with explicit `lto = "off"` and `strip = "symbols"`. The packer
continues to pass `-Wl,--build-id=none` for Linux and keeps `CARGO_BUILD_JOBS=1`
for serial build scheduling. The repeat-pack gate remains strict: it publishes
evidence only when every compared binary, `BUILD.json` and archive byte stream
matches.

The earlier [Linux x64 run 34570511950](https://github.com/Binary-Balance/seshat/actions/runs/34570511950)
tested synthetic merge source `a84cdd145f1bdc2ecef73f9061bfd86bbf7e8c52`,
which merged PR head `febcac1d2040197812701182f8c84f8f878c337b` into base
`c128248d55cc8d4f2cd876108125f10979d9a2b8`, and correctly rejected a pair of
different binaries. Both were 1,957,000 bytes; the first hash was
`1f6030a792ce1210cb947cd73ff88cefc29eb4bc573a21d1c493a8e374996f78` and the
second was `8942c72ad7a539793214fd3a539f820b13405b9c5a51b155e92ae25058699c44`.
The first binary was not retained by that run, so this remains mismatch evidence
and does not identify the differing bytes.

A bounded [six-build diagnostic](https://github.com/Binary-Balance/seshat/actions/runs/34575675229)
used later source `3251118dbc4612334bfff825f03ed2f04b8ed029`, pinned Rust
1.98.1/LLVM 22.1.8, Node/npm versions, Debian 11 inputs and serial Cargo
scheduling. A tree comparison found no changes in the relevant compiled Rust
inputs (`benchmarks/proofs/src/**`, `benchmarks/proofs/Cargo.toml` and
`benchmarks/proofs/Cargo.lock`) between the failed merge and this diagnostic;
the intervening changes were in proof/reporting and packaging retention. The
commits therefore remain distinct full-repository sources even though those
compiled inputs were unchanged. Four builds used the manifest's
`lto = "thin"`; two controls used `CARGO_PROFILE_RELEASE_LTO=off`. All four
ThinLTO builds matched at 1,957,000 bytes with SHA-256
`8942c72ad7a539793214fd3a539f820b13405b9c5a51b155e92ae25058699c44`; both
controls matched at 2,026,288 bytes with SHA-256
`5f27cad598e8186907d827f114eebcd7fede502859eac07b44b0f6d5340f4de7`.
The diagnostic therefore did not reproduce the earlier mismatch. It supports
the bounded workaround without proving that ThinLTO caused the earlier failure.
The explicit non-LTO policy costs 69,288 bytes, or about 3.54%, for the
diagnostic's source, toolchain and input set.

The [Rust issue 126976](https://github.com/rust-lang/rust/issues/126976) reports
ThinLTO module-hash variance in LLVM 22 and a fix in LLVM 23; the related
[LLVM change](https://github.com/llvm/llvm-project/commit/965f9d87adb0a7376454374fbc140ab69bd796a)
is an upstream risk signal, not a Seshat root-cause diagnosis. Each repeat proof
records its source commit, toolchain, host and build inputs; the source-controlled
manifest at its recorded commit supplies the release profile. These controls do
not establish arbitrary cross-host or cross-platform byte identity.

## Local checks

These checks do not require a package build:

```sh
node benchmarks/proofs/linux-x64-preflight.mjs --self-check
node benchmarks/proofs/linux-x64-summary.mjs --self-check
node packaging/repeat-pack-failure-check.mjs
node --check benchmarks/proofs/linux-debian.mjs
node --check packaging/repeat-pack.mjs
node --check benchmarks/proofs/jest-expo-check.mjs
node --check benchmarks/proofs/vitest-check.mjs
node --check benchmarks/proofs/lifecycle.mjs
```

The local checks are syntax and self-check coverage for the proof helpers. The
hosted run above is the source of the actual runner, kernel, userspace, package
and installed-proof values.

The selected host verifies the candidate Linux 6.8 family floor on the exact
recorded `6.8.0-1064-azure` patch; it does not boot an older kernel or claim
that every 6.8 patch behaves identically. The pinned Debian 11 userspace is a
compatibility snapshot after Debian 11 LTS ended on 2026-08-31. This protocol
does not establish support for glibc below 2.31, musl, another Linux userspace,
macOS or Windows. It also does not publish the private npm candidate or close
issue 2.
