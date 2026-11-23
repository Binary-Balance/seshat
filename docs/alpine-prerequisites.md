# Alpine prerequisites

This is the first slice of [#125](https://github.com/Binary-Balance/seshat/issues/125).
It tests native musl builds and the existing assessment and process supervision
proofs before changing the npm package set. Alpine support remains unpublished.

## Candidate environment

Use Alpine 3.24.2 userspace on native x64 and ARM64 Linux runners, with Rust
1.98.1 (`48a229ceaefd4985c50990b14116b6d856af0985`). The workflow pins each
architecture's image digest from `rust:1.98.1-alpine3.24`, checks the native
Rust musl target and Node architecture, and records the kernel and installed
APK versions. There is no emulation step.

Alpine's [release table](https://www.alpinelinux.org/releases/) lists 3.24 as
maintained. Its [Node package index](https://pkgs.alpinelinux.org/packages?branch=v3.24&name=nodejs)
provides Node 24. The proof installs Node and npm from that branch, rejects Node
outside Seshat's `>=24.20.0 <25` range, and records the actual versions.
APK updates are intentionally not pinned; the image is pinned, while each
run's package inventory identifies its dependency versions.

This is a candidate userspace, not an established minimum kernel or a claim
about older Alpine branches. The Node 24.20.0 minimum has not been tested on
musl by this protocol when APK supplies a later Node version. The eventual
package acceptance must settle and verify that floor separately.

## Execution and evidence

The [workflow](../.github/workflows/alpine-prerequisites.yml) checks out source
on the glibc host, then runs the [script](../benchmarks/proofs/alpine-prerequisites.sh)
inside the pinned native container. It uses read-only repository permission,
no secrets, and an init process to reap orphaned fixture processes.
Before artifact upload, the workflow returns ownership of generated `work/`
files to the host runner, including after a proof failure. This lets the upload
action traverse the proofs' private temporary directories.

The script runs the locked Rust tests, builds the release CLI and proof binary,
then reuses these existing proofs:

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
The artifact also retains the existing proofs' `result.json` files; some
proofs write their report there rather than to `SESHAT_PROOF_OUTPUT`.

For a local native x64 run, use a disposable source copy so that `npm ci` does
not replace another platform's native dependency packages:

```sh
mkdir -p work/alpine-source
git archive HEAD | tar -x -C work/alpine-source
podman run --rm --init \
  -v "$PWD/work/alpine-source:/workspace" -w /workspace \
  -e SESHAT_SOURCE_COMMIT="$(git rev-parse HEAD)" \
  rust@sha256:6d9066cf04ed2cc9d1a406016f4c9b2574bafda23f9e88bcad8e5d24fa6aec8e \
  sh -ec 'apk add --no-cache bash binutils build-base nodejs npm procps python3;
    bash benchmarks/proofs/alpine-prerequisites.sh x64'
```

Use the workflow's ARM64 image and `arm64` argument on a native ARM64 host.
The script rejects the wrong architecture. Do not treat an emulated run as
the required native platform evidence.

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

## Remaining acceptance

This prerequisite proof does not install the CLI through npm or a standalone
archive. Before declaring support, #125 still requires the two musl packages,
launcher libc selection, installed-route proofs without Rust, audited runtime
notices, eight-package release checks and provenance, both npm trusted
publishers, and regression proofs on the five existing hosts. Vitest browser
mode on Alpine is also unverified; the Node Vitest proof makes no browser
support claim. Publication requires the existing prepared-release approval.
