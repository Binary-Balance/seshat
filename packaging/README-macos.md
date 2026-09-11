# Seshat local npm candidate for macOS

This is a private, unpublished `@binary-balance/seshat` package for native
macOS 15 on one CPU architecture. The package records its target, Mach-O
architecture, macOS minimum load command, deployment target, SDK, native
libraries, binary hash and dependency versions in `BUILD.json`. Node 24.20.0
is the verified test runtime. The x64 and ARM64 packages are built on their
matching native GitHub-hosted runners and do not run through Rosetta.

Install the local tarball as a development dependency:

```sh
npm install --save-dev --save-exact --ignore-scripts --offline /absolute/path/to/binary-balance-seshat-0.0.0.tgz
./node_modules/.bin/seshat --help
```

The installed command runs the packaged Rust executable directly. Consumers
need no Rust toolchain. The package has no install hook or npm runtime
dependency. Use the direct installed command for clean JSON and direct signal
handling. npm also links `seshat` for package scripts and `npm exec --offline`.

The candidate uses `MACOSX_DEPLOYMENT_TARGET=15.0` and declares macOS in npm
metadata. It does not claim support for older macOS versions, the other CPU
architecture, Linux or Windows. No publisher code signing or notarization is
performed. A local ad-hoc signature made with `codesign --sign -` is only a
structural test signature, not publisher signing and not notarization.

Prepare `seshat.json` using `docs/configuration.md` in the source checkout.
The package does not configure tests or bundle the proof's coverage collector.
Commands run only explicitly captured, trusted project inputs; this is source
isolation, not a security sandbox.

`check` runs CRAP and mutation testing, `crap` only CRAP, and `mutate` only
mutation testing with original typechecks and baselines. Exit 0 means complete
with no failed applicable threshold; 1 means unmet thresholds; 2 means invalid
input or incomplete assurance. Handled SIGINT/SIGTERM exits 130/143.

The native package is a local proof artifact. It is not published to npm and
the packaging workflow makes no release, update, signing or notarization claim.
