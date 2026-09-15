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
  --notices linux-x64=/absolute/path/to/THIRD_PARTY_NOTICES.txt \
  --manifest work/release-0.1.0/release.json
```

Use `--layout-only` to inspect all six manifests without creating archives.
The staged native `BUILD.json` is augmented with package identity and binary
hash fields. Supply `--build-info target=/path/to/BUILD.json` when a target's
native packer already produced full build metadata; pass its staged
`THIRD_PARTY_NOTICES.txt` with `--notices`. A final release evidence
run must use a clean committed source so `sourceCommit` binds every artifact
to the reviewed revision.

## Verify a local npm installation

The real npm proof uses a disposable loopback registry because the exact
optional packages are unpublished. It installs the entry package and the
matching native package with normal npm platform selection, checks that the
entry package owns `.bin/seshat`, exercises launcher argument, output, exit,
unsupported, missing and version-mismatch paths, forwards cancellation, and
then runs `npm ci --offline` with the loopback registry unavailable.

The first install must populate the disposable npm cache. The retained lockfile
and that cache are prerequisites for the offline step.

```sh
node benchmarks/proofs/npm-package.mjs \
  work/release-0.1.0/binary-balance-seshat-0.1.0.tgz \
  work/release-0.1.0/binary-balance-seshat-linux-x64-0.1.0.tgz
```

The existing standalone, lifecycle and runner proofs remain separate native
evidence. The package checkpoint does not claim the full hosted cross-platform
release acceptance or public redistribution audit; those follow-up slices
must add native Windows console proof and the remaining public setup, notices
and release evidence before publication.

`repeat-pack.mjs` invokes the ordinary native packer twice from a clean source
and compares the native binary, `BUILD.json`, npm archive and standalone bytes.
It writes evidence only after every comparison passes. A failed comparison
retains one archive per completed run in `repeat-pack-failure/` and records the
failure before discarding large temporary target trees. Run
`node packaging/repeat-pack-failure-check.mjs` for the cheap retention check.

Seshat is MIT-licensed. Native package notices preserve licence text available
from all locked Cargo packages, including the recorded Oxc revisions. Review
toolchain, runtime and platform notices before any public distribution.
