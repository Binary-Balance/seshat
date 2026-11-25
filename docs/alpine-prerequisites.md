# Alpine prerequisites

This tracks native build and packaging slices of [#125](https://github.com/Binary-Balance/seshat/issues/125).
It tests native musl builds and the existing assessment and process supervision
proofs, then stages and installs the musl packages locally. Alpine support remains unpublished.

## Candidate environment

Use Alpine 3.24.2 userspace on native x64 and ARM64 Linux runners, with Rust
1.98.1 (`48a229ceaefd4985c50990b14116b6d856af0985`). The workflow pins each
architecture's image digest from `rust:1.98.1-alpine3.24`, checks the native
Rust musl target and Node architecture, and records the kernel and installed
APK versions. There is no emulation step.

Alpine's [release table](https://www.alpinelinux.org/releases/) lists 3.24 as
maintained. CI uses hash-pinned Node 24.20.0 musl archives from the
[Node unofficial-builds project](https://github.com/nodejs/unofficial-builds),
with bundled npm 11.19.0, to check Seshat's advertised minimum. These are
upstream experimental builds, not official Node binary distributions. The
workflow pins both archive hashes from the release's
[SHA-256 list](https://unofficial-builds.nodejs.org/download/release/v24.20.0/SHASUMS256.txt)
and rejects a hash or Node-version mismatch before running proofs. The host
record retains the archive and executable hashes. APK build/proof tools follow
the 3.24 repositories; each run records their actual versions.

This is a candidate userspace, not an established minimum kernel or a claim
about older Alpine branches. The earlier
[native run](https://github.com/Binary-Balance/seshat/actions/runs/45143532749)
passed with APK Node 24.22.3. The later
[installed-package run](https://github.com/Binary-Balance/seshat/actions/runs/45404075369)
passed on both native architectures with Node 24.20.0, including npm and
standalone routes without Rust in the consuming environment. These experimental
0.18.0 archives establish prerequisites, not 0.19.0 release acceptance.

## Execution and evidence

The [workflow](../.github/workflows/alpine-prerequisites.yml) checks out source
on the glibc host, then runs the [script](../benchmarks/proofs/alpine-prerequisites.sh)
inside the pinned native container. It uses read-only repository permission,
no secrets, and an init process to reap orphaned fixture processes.
Before artifact upload, the workflow returns ownership of generated `work/`
files to the host runner, including after a proof failure. This lets the upload
action traverse the proofs' private temporary directories.

The script runs the locked Rust tests and two clean native packs, requiring
identical binaries, build metadata and archives. It stages all eight manifests,
checks original/staged archive parity, and runs npm and standalone installation
proofs without Cargo or Rustc in their consumer PATH. It then reuses these proofs:

- CLI reports, failure exits, source preservation and scratch cleanup.
- Parallel workers, cancellation and error handling.
- Lifecycle SIGINT/SIGTERM cancellation, deadlines, output truncation and
  owned-descendant cleanup, including an unrelated-process control.
- Unix detached-process limits and proof-execution cancellation.
- Job deadline continuation and opt-in timeout scoring.
- Vitest `stack,assertion,survived,before-all` and Jest/Expo
  `normal-1,assertion-kill,survivor,before-all`.

An error stops the script. Only the end of a successful run writes
`work/alpine/<arch>/evidence/result.json` with `completed: true`. The workflow
retains logs, reports, binary hashes, ELF headers/dependencies, linker maps,
compiler/linker versions and Rust runtime archive hashes even on failure.
The artifact copies existing proofs' `result.json` files under `raw-results/`,
including on failure; some proofs choose their own report path.
The host check validates the additional musl notice assets and records their
identities alongside the Node input hashes.

For a local native x64 trial with Alpine's packaged Node, use a disposable
source copy so that `npm ci` does
not replace another platform's native dependency packages:

```sh
git clone --no-hardlinks . work/alpine-source
# Repeat packing requires a clean, committed checkout.
podman run --rm --init \
  -v "$PWD/work/alpine-source:/workspace" -w /workspace \
  -e SESHAT_SOURCE_COMMIT="$(git rev-parse HEAD)" \
  rust@sha256:6d9066cf04ed2cc9d1a406016f4c9b2574bafda23f9e88bcad8e5d24fa6aec8e \
  sh -ec 'apk add --no-cache bash binutils build-base git nodejs npm procps python3;
    git config --global --add safe.directory /workspace;
    bash benchmarks/proofs/alpine-prerequisites.sh x64'
```

Use the workflow's ARM64 image and `arm64` argument on a native ARM64 host.
The script rejects the wrong architecture. Do not treat an emulated run as
the required native platform evidence. To reproduce the CI minimum instead
of the packaged Node version, use the workflow's pinned download commands.

## Runtime notice gate

Both Rust musl targets default to a static CRT:
[x64 target](https://github.com/rust-lang/rust/blob/48a229ceaefd4985c50990b14116b6d856af0985/compiler/rustc_target/src/spec/targets/x86_64_unknown_linux_musl.rs),
[ARM64 target](https://github.com/rust-lang/rust/blob/48a229ceaefd4985c50990b14116b6d856af0985/compiler/rustc_target/src/spec/targets/aarch64_unknown_linux_musl.rs).
Rust's [bootstrap assembly](https://github.com/rust-lang/rust/blob/48a229ceaefd4985c50990b14116b6d856af0985/src/bootstrap/src/core/build_steps/compile.rs)
supplies musl libc/startup objects, LLVM compiler-rt startup objects and
LLVM libunwind. Its [musl build script](https://github.com/rust-lang/rust/blob/48a229ceaefd4985c50990b14116b6d856af0985/src/ci/docker/scripts/musl-toolchain.sh)
selects patched musl 1.2.5. The host's APK musl version does not identify the
runtime embedded in the resulting executable.

Before packaging, use the retained maps and archive identities to establish
the actual linked components. Audit and preserve full musl COPYRIGHT and
applicable per-file notices, plus the matching full
[LLVM libunwind licence](https://github.com/llvm/llvm-project/blob/52ed14fcd56afc30f9cccd8ca8ce237c2eef7e04/libunwind/LICENSE.TXT).
Audit any Alpine/GCC runtime selected by the actual link separately. The
existing Rust/libm notices do not establish full musl coverage, and an ELF
with no dynamic dependencies does not establish notice completeness.
The [runtime audit](research/alpine-runtime-notice-audit.md) now records those
linked components and the prepared additional notice assets. Target-specific
notice assembly is checked in the original and staged archives. The packer
validates selected self-contained objects against that audit, records their
actual hashes and binds the retained portable map to `BUILD.linkage`. Source
facts alone are not linkage evidence.

## Remaining acceptance

The artifact has a flat root containing `summary.json`, `BUILD.json`,
`THIRD_PARTY_NOTICES.txt`, `seshat-entry.tgz` and
`seshat-linux-<arch>-musl-release.tgz`, with archive and binary hashes in the
summary. Raw logs, JSON, portable linker map, runtime input hashes and both
repeat-pack attempts remain alongside these files. Use a fresh evidence
directory for every run.

The publisher, registry checks, audit generator and archive stager now require
all eight packages for 0.19.0 and newer; historical releases keep six. Source
version 0.19.0 is being prepared and remains unpublished. The
[release audit](research/release-notice-audit.md) records exact 0.19.0 archives
from all seven native targets. Release acceptance still needs seven-host local
installation and the remaining existing-host browser regression evidence. Both musl npm package records and trusted
publishers must be ready before the reviewed-main publisher dry run and
prepared-release approval. Registry availability, signature/provenance and
seven-host consumption checks follow publication. See the
[draft release notes](releases/0.19.0.md).

The Node floor proof uses experimental upstream musl builds. Alpine 3.24.2 is
the verified candidate userspace, with Linux 7.0.0-1017-azure observed in the
installed-package run; older Alpine branches and kernels are unverified.
The embedded runtime is Rust's patched musl 1.2.5, as recorded in the
[runtime audit](research/alpine-runtime-notice-audit.md), rather than the host's
APK musl version. Vitest browser mode on Alpine is unverified; the Node Vitest
proof makes no browser support claim. Publication requires prepared-release
approval.
