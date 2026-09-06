# Seshat local npm candidate

This is a private, unpublished `@binary-balance/seshat` package for Linux x64
with glibc. It is not the cross-platform release. The current binary references
glibc 2.39 symbols and has been tested on glibc 2.41 only. Alpine/musl, older
glibc, ARM64, macOS and Windows are not supported by this candidate. Node 24.20.0
is the verified test runtime. See `BUILD.json` for the exact binary hash,
native library requirements and dependency versions of a packed build.
The source checkout also has an older-glibc linking experiment, documented in
`benchmarks/proofs/README.md`; that separate build does not change this package's
compatibility claim.

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

Prepare `seshat.json` using the source checkout's root README and verified runner
examples in `benchmarks/proofs/README.md`. This package does not configure tests
or bundle the proof's coverage collector. Commands run only explicitly captured,
trusted project inputs; this is source isolation, not a security sandbox.

`check` runs CRAP and mutation testing, `crap` only CRAP, and `mutate` only mutation
testing with original typechecks and baselines. Exit 0 means complete with no
failed applicable threshold; 1 means unmet thresholds; 2 means invalid input or
incomplete assurance. Handled SIGINT/SIGTERM exits 130/143. `--json` keeps one
report on stdout; progress uses stderr and `--no-progress` disables it.

## Build and verify from the source checkout

With the proof dependencies and Rust toolchain already installed, run from the
Seshat repository root:

```sh
node packaging/pack.mjs
node benchmarks/proofs/npm-package.mjs /absolute/path/to/the/reported/package.tgz
```

Packing rebuilds the native binary offline from the locked dependencies, then
uses a fresh directory under `work/npm-pack-*`. It prints the tarball path,
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
