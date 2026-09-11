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

The matrix summary is fail-closed. A missing or invalid preflight, package,
npm or standalone report fails the job. The uploaded artifact contains raw
logs, reports, `BUILD.json`, package archives and the portable summary. It does
not contain Cargo targets or npm dependency directories.

The workflow is implementation and verification scaffolding for a private
candidate. It does not publish an npm package, claim public release support,
publisher code signing or notarization. A local ad-hoc `codesign --sign -`
signature, if used for a structural check, is not publisher signing or
notarization. Native hosted evidence is pending until both matrix jobs pass
and the retained summaries are reviewed.
