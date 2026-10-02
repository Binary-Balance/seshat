# Rust compiler and dependency support

## Tested compiler requirement

Source builds of `crates/seshat` support Rust 1.98.1. The manifest declares
`rust-version = "1.98.1"` as the conservative supported compiler floor.
Cargo accepts newer compilers, but the release packer requires the exact
`rustc 1.98.1 (48a229cea 2026-09-01)` build, commit
`48a229ceaefd4985c50990b14116b6d856af0985`. Installed npm packages do not
require a Rust compiler.

The locked dependency graph was inspected with
`cargo metadata --locked --offline --format-version 1 --manifest-path crates/seshat/Cargo.toml`.
Its highest declared compiler requirement is Rust 1.96.0, from the Oxc 0.148.0
crates. On 2026-10-02, the locked offline build of all binaries and native Linux
x64 tests passed on Rust 1.98.1. No lower compiler was built or tested, so 1.96.0
is a dependency lower bound, not a proven minimum for Seshat. Edition 2024 alone
does not establish compiler support. Cargo's
[Rust version documentation](https://doc.rust-lang.org/cargo/reference/rust-version.html)
explains the support declaration and compiler diagnostics.

Use the [build and regression guide](../benchmarks/proofs/README.md) for local
commands. Existing native package workflows build and test with Rust 1.98.1 on
the five supported targets. A Windows cross-target compiler check on Linux
does not replace the native Windows tests.

## Locked dependencies and updates

`crates/seshat/Cargo.toml` sets allowed dependency versions. Oxc's direct crates
use matching exact requirements because their APIs must move together. The
`serde` and `serde_json` major-version requirements allow compatible updates.
`crates/seshat/Cargo.lock` records exact resolved versions, sources and checksums
for both, including transitive and target-specific dependencies. Release and CI
builds use `--locked` to reject a missing or changed resolution. Exact manifest
requirements do not freeze transitive dependencies; replacing every range with
an exact requirement adds no release reproducibility beyond the committed lock.
See Cargo's [dependency requirements](https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html)
and [`--locked` documentation](https://doc.rust-lang.org/cargo/commands/cargo-build.html#manifest-options).

Update a dependency deliberately, review its manifest and lockfile changes,
check its compiler requirement and release notes, then run the advisory scan,
locked build and affected native regressions. Keep Oxc's direct versions aligned.
Do not regenerate the lockfile just to run a scan.

Changing the release compiler requires new pinned
[runtime notice assets and provenance](../packaging/runtime-notices/README.md)
and the [native packaging proofs](../packaging/README.md). The private Windows
launcher derives its executable lookup and quoting from the exact Rust 1.98.1
source. Keep its attribution, [command contract](windows-package.md#primary-thread-ownership)
and native differential tests against `std::process::Command` in that review,
including `.cmd`/`.bat` escaping and CR/LF rejection. A compiler build passing
does not establish that Windows launch behavior is unchanged. Dependency
updates also require fresh package dependency inventories, notices and release
evidence; existing release manifests do not cover changed inputs.

## Advisory scan

[Rust dependency advisories](../.github/workflows/rust-advisories.yml) checks
`crates/seshat/Cargo.lock` against RustSec on relevant pull requests and pushes
to `main`, every Monday at 03:17 UTC, and by manual dispatch. It uses the official
[cargo-audit 0.22.2 release](https://github.com/rustsec/rustsec/releases/tag/cargo-audit%2Fv0.22.2)
x86_64 Linux musl binary archive, verified against SHA-256
`7fb9497f8594b389e5fce5ef9b92db08432996895b2e0c5a0167a69ed445c428`.
No scan action selects a floating tool version or modifies dependencies.

For local use on any supported cargo-audit host, install that version with its
packaged lockfile, then run from the repository root:

```sh
cargo install cargo-audit --version '=0.22.2' --locked
mkdir -p work
set -o pipefail
cargo audit --file crates/seshat/Cargo.lock --no-yanked --deny warnings --json \
  | tee work/rust-advisories.json
```

The workflow fetches the current RustSec database into a fresh directory.
Known vulnerabilities fail the check; `--deny warnings` also fails on reported
informational advisories. RustSec database fetch and tool failures fail the check.
`--no-yanked` excludes registry yank checks because cargo-audit 0.22.2 does not
reliably fail on registry lookup errors. The retained JSON identifies the
database commit and findings. Tool selection is fixed; findings can change as
RustSec data change. Review results against that run's database revision.
The [upstream tool documentation](https://github.com/rustsec/rustsec/blob/cargo-audit/v0.22.2/cargo-audit/README.md)
describes its scope and advisory handling.

The scan includes the whole release lockfile, with build, proc-macro and
target-specific crates. It does not scan the separate historical
`benchmarks/rust` experiment, npm packages, the Rust standard library or system
libraries. A clean report means no findings in the queried RustSec data, not
proof that the code is free of vulnerabilities.

For a finding, read the advisory and trace the locked dependency to its callers
and enabled features. Prefer a tested dependency update. If an exception is
needed, record the advisory ID, concrete reason, owner and review date in a
reviewed change; do not silently add `--ignore` or disable warning failures.
There are no exceptions currently. To update cargo-audit, review its release
notes, select an exact version and official archive digest, update this guide
and the workflow together, and rerun the scan. Never pin an old database merely
to keep the check passing.

## Focused compiler lints

The manifest denies [`unused_must_use`](https://doc.rust-lang.org/rustc/lints/listing/warn-by-default.html#unused-must-use),
which catches accidentally ignored results, and
[`unsafe_op_in_unsafe_fn`](https://doc.rust-lang.org/rustc/lints/listing/allowed-by-default.html#unsafe-op-in-unsafe-fn),
which requires explicit unsafe blocks inside unsafe functions. Ordinary Cargo
builds and tests enforce both. Deliberately ignored best-effort cleanup remains
explicit in the code. Broad warning denial, Clippy pedantic/restriction groups
and blanket `unwrap` bans are not enabled. They would also affect test assertions
and deliberate invariants without establishing better error handling at input
or process boundaries.
