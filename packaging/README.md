# Seshat release packaging

The release crate in `crates/seshat/Cargo.toml` owns version `0.1.0`.
`pack.mjs` builds one native payload for the current platform. `release.mjs`
stages the user-facing `@binary-balance/seshat` package and the five exact
optional native package names:

- `@binary-balance/seshat-linux-x64`
- `@binary-balance/seshat-linux-arm64`
- `@binary-balance/seshat-darwin-x64`
- `@binary-balance/seshat-darwin-arm64`
- `@binary-balance/seshat-win32-x64`

The entry package is the only package with an npm `seshat` bin. Each native
archive still contains `bin/seshat` or `bin/seshat.exe` for direct execution,
but leaves the npm `bin` field unset so npm always links the Node launcher.
The launcher resolves the matching optional package, checks its name and
version, preserves the child process contract, and reports bootstrap failures
using the CLI's schemaVersion 1 JSON envelope when `--json` is requested.

No package is published by these scripts. The staged release manifest records
the package names, versions, platform metadata and archive identities for a
later publication or hosted proof step.

npm packing runs offline, with lifecycle scripts disabled and a private cache,
prefix and empty user/global npm configuration for each call. Ambient npm
configuration is ignored; the registry remains `https://registry.npmjs.org`.
On Windows, npm runs through Node without a shell. `npm_execpath` is accepted
only for `npm-cli.js` within an npm package; otherwise the scripts use
`node_modules/npm/bin/npm-cli.js` next to `node.exe`. Install Node with its
bundled npm if neither location exists. On other platforms, npm is found on
`PATH` and runs without a shell. Paths containing spaces, `&`, `%` and `=` stay
literal; quote them when invoking a script from your shell.

## Build a native payload

With locked Cargo and proof dependencies already available, the Linux x64
packer needs the three pinned Debian 11 archives. They are build inputs and
are not installed on the host or bundled into the package.

```sh
cargo fetch --locked --manifest-path crates/seshat/Cargo.toml
mkdir -p work/debian11-inputs
curl --max-time 60 -fSL https://deb.debian.org/debian/pool/main/g/glibc/libc6_2.31-13+deb11u11_amd64.deb -o work/debian11-inputs/libc6.deb
curl --max-time 60 -fSL https://deb.debian.org/debian/pool/main/g/glibc/libc6-dev_2.31-13+deb11u11_amd64.deb -o work/debian11-inputs/libc6-dev.deb
curl --max-time 60 -fSL https://deb.debian.org/debian/pool/main/g/gcc-10/libgcc-s1_10.2.1-6_amd64.deb -o work/debian11-inputs/libgcc-s1.deb
node packaging/pack.mjs work/debian11-inputs
```

The packer builds `seshat` and retains `seshat-proofs` for the existing
proof-only regression checks. It records the exact Cargo lock hash, native
library requirements, dependency licences, binary hash, release version and
source commit in `BUILD.json`. The Linux payload is checked against glibc
2.31; the ARM64, macOS and Windows workflows use their target-specific
preflight checks. A fresh target directory is used for every pack.

The deterministic native archive is also the standalone route. Extract it
under a disposable directory and run `bin/seshat` directly; no npm install or
compiler is needed at runtime.

## Stage the package set

Pass one built binary per target to produce packed entry and native archives:

```sh
node packaging/release.mjs \
  --output work/release-0.1.0 \
  --binary linux-x64=/absolute/path/to/seshat \
  --build-info linux-x64=/absolute/path/to/BUILD.json \
  --notices linux-x64=/absolute/path/to/THIRD_PARTY_NOTICES.txt \
  --manifest work/release-0.1.0/release.json
```

Each supplied binary requires its packer's `BUILD.json` and
`THIRD_PARTY_NOTICES.txt`. Staging checks package identity, target, source
revision, Cargo lock hash, pinned Rust and notice provenance, dependency
inventory, and binary/notice hashes and sizes before writing output. It copies
those validated inputs unchanged; it never fills in missing build evidence.
Use a clean checkout of the build's source revision for final release evidence.
Platform build and installation proofs remain required before publication.

The output must be new or empty, and a separate manifest path must not already
exist. Staging refuses reuse without deleting anything, including when the next
run supplies fewer targets. Choose a new output directory for a rerun.

Use `--layout-only` to inspect all six manifests without creating archives.
It can copy optional binary, build-info and notice inputs for inspection, but
it does not validate their build provenance or invent missing fields. Its
report says `mode: "layout-only"`, and all archive records are null. Packed
output says `mode: "packed"`; targets without a supplied binary retain null
archive records.

Native CI compares the original packer's archive with the staged native archive
using `node packaging/metadata.test.mjs <pack archive> <release archive>`.
The comparison covers manifest fields, packed file lists and payload bytes.
Canonical release archives and their recorded hashes remain the publication
inputs; staging is not a substitute for testing those exact archives.

## Verify a local npm installation

The local npm proof uses a disposable loopback registry to test the supplied
archives independently of public registry availability. It installs the entry
package and matching native package with normal npm platform selection, checks
that the entry package owns `.bin/seshat`, exercises launcher argument, output, exit,
unsupported, missing and version-mismatch paths, forwards cancellation, and
then runs `npm ci --offline` with the loopback registry unavailable.

The first install must populate the disposable npm cache. The retained lockfile
and that cache are prerequisites for the offline step.

```sh
node benchmarks/proofs/npm-package.mjs \
  work/release-0.1.0/binary-balance-seshat-0.1.0.tgz \
  work/release-0.1.0/binary-balance-seshat-linux-x64-0.1.0.tgz
```

The standalone, lifecycle and runner proofs remain separate native evidence.
The local package check alone does not establish release acceptance. Version
0.1.0 completed the hosted installation, notice and publication checks recorded
in the [release audit](../docs/research/release-notice-audit.md) and
[project release status](../README.md#release-status). Future releases must retain
their own required evidence; fixes on `main` since 0.1.0 remain unreleased.

`repeat-pack.mjs` invokes the ordinary native packer twice from a clean source
and compares the native binary, `BUILD.json`, npm archive and standalone bytes.
The packer clears caller `RUSTFLAGS` and `CARGO_ENCODED_RUSTFLAGS` before setting
its target-specific flags. Native CI supplies deliberately invalid values for
both during the repeat proof, so compilation also checks that neither leaks
into the release build.
It writes evidence only after every comparison passes. A failed comparison
retains one archive per completed run in `repeat-pack-failure/` and records the
failure before discarding large temporary target trees. Run
`node packaging/repeat-pack-failure-check.mjs` for the cheap retention check.

Seshat is MIT-licensed. Native package notices preserve licence text available
from all locked Cargo packages, including the recorded Oxc revisions. Review
toolchain, runtime and platform notices before any public distribution.
