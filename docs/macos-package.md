# macOS package protocol

This is the macOS slice of issue 2. It builds and installs private candidate
packages on the native `macos-15-intel` and `macos-15` GitHub-hosted runners.
The two jobs use the common macOS 15 candidate floor, Node 24.20.0, Rust
1.98.1 and `MACOSX_DEPLOYMENT_TARGET=15.0`.

The preflight runs before dependency fetches, tests or packaging. It records the
macOS patch, kernel, native process and host architecture, Rosetta translation
status, SDK, Clang, Rust host, Node, npm and deployment target. The build then
uses `x86_64-apple-darwin` or `aarch64-apple-darwin` as appropriate. The packer
checks the Mach-O architecture with `file`, the minimum OS load command with
`otool -l` and linked libraries with `otool -L`. `BUILD.json` retains the
architecture, minimum OS, deployment target, SDK, Clang, native libraries and
binary hash.

Native proof builds use the source-controlled `[profile.release]` in
`benchmarks/proofs/Cargo.toml`, which explicitly sets `lto = "off"` and
`strip = "symbols"`.

Both npm and standalone proofs install the candidate into disposable paths
containing spaces and Unicode. They verify archive contents and hashes, npm
exec and package scripts, exit status, offline installation, workspaces,
source preservation, coverage, cancellation, deadlines, process-group and
descendant cleanup, pipe closure, symlinks and parallel workers.
The installed consumer has no Rust or Cargo on its `PATH`. macOS has no libc
package dimension, so its npm proof retains 14 checks. Wrong-OS and wrong-CPU
controls remain active and invert the actual macOS platform. The shared
lifecycle helper uses the same portable liveness path for separate process
cleanup regressions.

Each matrix job then installs the same current npm archive into the pinned
Jest/Expo and Vitest fixtures. Jest/Expo runs
`normal-1,assertion-kill,survivor,before-all`; Vitest runs
`stack,assertion,survived,before-all`. The runner reports retain the complete
and partial per-case JSON, raw logs, archive and executable hashes, no-Rust and
cleared-environment evidence, source-preservation checks and empty scratch
directories. The summary rejects a missing or partial runner report, a changed
archive identity or incomplete runner evidence.

The packer produces one deterministic npm `.tgz`, and the workflow retains that
same byte stream under the npm and standalone artifact names. The standalone
proof strips npm's `package/` prefix before running without npm. The matrix
summary is fail-closed: a missing or invalid preflight, repeat-pack proof,
package, npm or standalone report, a differing archive hash, or incomplete
runner evidence fails the job. The uploaded artifact contains raw logs,
reports, `BUILD.json`, the two retained archive names and the portable summary.
It does not contain Cargo targets or npm dependency directories.

The repeat-pack gate uses the same strict byte comparison on both native macOS
runners. Both final jobs passed that comparison and their retained evidence was
reviewed; the gate does not weaken the signing or publication boundaries.

The workflow verifies private candidate packages. It does not publish an npm
package, provide publisher code signing or notarization, or create a public
release artifact. A local ad-hoc `codesign --sign -` signature, if used for a
structural check, is not publisher signing or notarization. Signing,
notarization and public npm publication remain issue 6 work.

## Current protocol invocation

The workflow runs these installed controls after packaging on both matrix CPUs:

```sh
node benchmarks/proofs/jest-expo-check.mjs \
  --tarball work/macos/$CPU/seshat-macos-$CPU.tgz \
  --cases normal-1,assertion-kill,survivor,before-all
node benchmarks/proofs/vitest-check.mjs \
  --tarball work/macos/$CPU/seshat-macos-$CPU.tgz \
  --deps "$GITHUB_WORKSPACE/benchmarks/proofs" \
  --cases stack,assertion,survived,before-all
node benchmarks/proofs/macos-package-summary.mjs work/macos/$CPU
```

`$CPU` is the matrix value `x64` or `arm64`. The workflow still runs the
existing native preflight, packaging, npm, standalone and eleven-case lifecycle
checks around these controls.

## Final native proofs

The final x64 proof is [job 103197240025](https://github.com/Binary-Balance/seshat/actions/runs/34578770831/job/103197240025)
in [workflow run 34578770831](https://github.com/Binary-Balance/seshat/actions/runs/34578770831),
with [artifact 10191201858](https://github.com/Binary-Balance/seshat/actions/runs/34578770831/artifacts/10191201858).
The final ARM64 proof is [job 103197240243](https://github.com/Binary-Balance/seshat/actions/runs/34578770831/job/103197240243)
with [artifact 10191030456](https://github.com/Binary-Balance/seshat/actions/runs/34578770831/artifacts/10191030456).
Both tested merge source
`0edd0a3a546d2a94f8ddac59aa52123a22c821c8` from `refs/pull/31/merge`, whose
tree matches merged `main` `b1a35c594854cbb0f9958be90ec254902b56a9c9`. The PR
head recorded by both jobs was `97a19aa27ac7c78e95ccf3dcfac68befbabf3460`.

Both hosts were native macOS 15.7.9 with Darwin 24.6.0, Node `v24.20.0`, npm
`11.19.0`, rustc/Cargo `1.98.1`, Apple Clang 17.0.0, SDK 15.5 and deployment
target 15.0. The x64 target was `x86_64-apple-darwin`; ARM64 was
`aarch64-apple-darwin`. The binaries are Mach-O and use `/usr/lib/libSystem.B.dylib`
and `/usr/lib/libiconv.2.dylib`; neither job used Rosetta translation.

Both npm and standalone routes passed with Cargo and Rustc absent. The npm route
passed 43 CLI scenarios. The standalone route verified the matching binary
identity and passed the same 43 CLI scenarios plus 11 parallel controls.
Jest/Expo and Vitest separately installed the npm tarball; each ran four
requested cases with originals preserved. The native lifecycle record passed all
11 SIGINT/SIGTERM, timeout, overflow and leader-exit cases, including bounded
deadlines, descendant cleanup and empty scratch directories. Two clean packs
matched the installed archive, binary and `BUILD.json` identities.

The x64 npm and standalone archives are each 858,410 bytes with SHA-256
`a6aa3f8b80ea9c94995ab8fe3191dc5318c0a9d0af3617bcbe51deed5ad0b01f`; its
1,867,488-byte binary is
`069dcc588b30be6034343599eb830b9005088110efd816ac280e0409bca00883` and its
7,152-byte `BUILD.json` is
`b921ae331a4fdb4b1b0cb4f965fc43b9669b3354172e9edf387a8320374d13e5`.
The ARM64 archive identity is
`4de118e36f9b173c093f508da2437ba05756671e6b47786ce6798ef14e7a8e6d` / 838,416;
its binary is
`39baf5a607bc210ad340ccfa88267d23918cabac33ecba19c7c86c4d8110b0c7` /
1,823,648 and its 7,154-byte `BUILD.json` is
`554fe3c012e173bc280396d7b4676f6e4b5b30218926ab6942dcbfdb59741f0e`.
The path-free hash and pass record is [outputs/platform-support.json](../outputs/platform-support.json).
GitHub retains these raw artifacts until 2026-12-10T08:21:24Z.
