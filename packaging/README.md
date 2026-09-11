# Seshat local npm candidate

This is a private, unpublished `@binary-balance/seshat` package for Linux x64
with glibc. It is not the cross-platform release. The package is built against
Debian 11 libraries and verified in a complete Debian 11/glibc 2.31 userspace.
glibc 2.31 is the minimum supported userspace baseline. The native x64 package
workflow records the Ubuntu 22.04 host kernel and fails below the candidate
Linux 6.8 kernel family; it does not boot an older kernel or claim identical
behaviour for every 6.8 patch. Debian 11 LTS ended on 2026-08-31; its pinned
userspace is retained as a compatibility snapshot.
Alpine/musl, glibc below 2.31, ARM64, macOS and Windows are not supported by this candidate. Node 24.20.0
is the verified test runtime. See `BUILD.json` for the exact binary hash,
native library requirements and dependency versions of a packed build.
The native protocol and its limits are documented in
`docs/linux-x64-package.md`; the complete userspace proof is in
`benchmarks/proofs/README.md`, under "Debian 11 installed-package verification".

## Install and use

Install the local tarball as a development dependency in a consuming project:

```sh
npm install --save-dev --save-exact --ignore-scripts /absolute/path/to/binary-balance-seshat-0.0.0.tgz
./node_modules/.bin/seshat --help
./node_modules/.bin/seshat check --config ./seshat.json --json > seshat-report.json
```

The installed command runs the packaged Rust executable directly. There is no
JavaScript launcher, download, install hook or npm runtime dependency. Consumers
need no Rust toolchain. Their configured test runners, typechecker and coverage
tools are still required. npm's normal command linking also permits
`npm exec --offline -- seshat --help`, or `seshat` inside a package script.
Use the direct installed command for clean JSON and direct signal handling.

Prepare `seshat.json` using `docs/configuration.md` in the source checkout. This package does not configure tests
or bundle the proof's coverage collector. Commands run only explicitly captured,
trusted project inputs; this is source isolation, not a security sandbox.

`check` runs CRAP and mutation testing, `crap` only CRAP, and `mutate` only mutation
testing with original typechecks and baselines. Exit 0 means complete with no
failed applicable threshold; 1 means unmet thresholds; 2 means invalid input or
incomplete assurance. Handled SIGINT/SIGTERM exits 130/143. `--json` keeps one
report on stdout; progress uses stderr and `--no-progress` disables it.

## Build and verify from the source checkout

With the proof dependencies and Rust toolchain already installed, prepare the
locked Cargo dependencies and three pinned Debian archives from the repository
root. Building also requires GCC, binutils and `dpkg-deb`. The archives are build
inputs; nothing is installed on the host or bundled into the package.

```sh
cargo fetch --locked --manifest-path benchmarks/proofs/Cargo.toml
mkdir -p work/debian11-inputs
curl --max-time 60 -fSL https://deb.debian.org/debian/pool/main/g/glibc/libc6_2.31-13+deb11u11_amd64.deb -o work/debian11-inputs/libc6.deb
curl --max-time 60 -fSL https://deb.debian.org/debian/pool/main/g/glibc/libc6-dev_2.31-13+deb11u11_amd64.deb -o work/debian11-inputs/libc6-dev.deb
curl --max-time 60 -fSL https://deb.debian.org/debian/pool/main/g/gcc-10/libgcc-s1_10.2.1-6_amd64.deb -o work/debian11-inputs/libgcc-s1.deb
```

Build and verify offline:

```sh
node packaging/pack.mjs work/debian11-inputs
SESHAT_PROOF_BINARY=/absolute/path/to/the/reported/proofBinary node benchmarks/proofs/npm-package.mjs /absolute/path/to/the/reported/package.tgz
```

The native workflow derives its standalone archive from the six files in that
tarball, then runs `standalone.mjs` with the same proof binary. The x64 packer
does not publish or install a separate archive.

Packing verifies archive hashes, extracts an isolated library directory and
rebuilds against it from the locked dependencies. It rejects GLIBC requirements
above 2.31. An explicit Cargo target keeps these link flags away from host build
scripts. It also builds the legacy proof executable for regression comparison;
only `seshat` enters the package. Each build uses a fresh directory under
`work/npm-pack-*`. Use its reported `proofBinary` path for the legacy comparison
when running the installed regression. It prints the tarball path,
integrity and sizes. Only the executable, package metadata, this README, build
metadata and licence texts are included. The source packaging directory is a
template, not directly installable. Nothing is published or globally installed.

The private flag prevents accidental npm publication, and platform fields
restrict normal installation. These are standard [npm package metadata](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/).
Creating a local tarball does not claim the npm scope or package name.

Seshat is MIT-licensed. `THIRD_PARTY_NOTICES.txt` preserves available licence
texts from all locked Cargo packages, including build-only and other-platform
dependencies. Missing Oxc texts come from the [recorded upstream revision](https://github.com/oxc-project/oxc/blob/894c8f9cd89508391b01eb26a4b5ac2b846ab39b/LICENSE).
The separate [oxc_index revision](https://github.com/oxc-project/oxc-index-vec/blob/8e09fe324eb6df02f56e4eacdfac958930300380/LICENSE)
has the same text; packing checks both recorded revisions.
This collection is not a completed public-release redistribution audit; review
toolchain/runtime notices and platform compatibility before public distribution.
