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
runners. Native macOS byte identity remains unclaimed until those matrix jobs
pass and their retained evidence is reviewed; the gate does not weaken the
comparison or signing/publication boundaries.

The workflow is implementation and verification scaffolding for a private
candidate. It does not publish an npm package, claim public release support,
publisher code signing or notarization. A local ad-hoc `codesign --sign -`
signature, if used for a structural check, is not publisher signing or
notarization. Native hosted evidence is pending until both matrix jobs pass
and the retained summaries are reviewed. This protocol records no historical
macOS runner result or support claim before that review.

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
