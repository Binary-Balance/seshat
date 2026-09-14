# Seshat local macOS native payload

This is one of the `@binary-balance/seshat-darwin-x64` or
`@binary-balance/seshat-darwin-arm64` native payloads for macOS 15. The package records its target, Mach-O
architecture, macOS minimum load command, deployment target, SDK, native
libraries, binary hash and dependency versions in `BUILD.json`. Node 24.20.0
is the verified test runtime. The x64 and ARM64 packages are built on their
matching native GitHub-hosted runners and do not run through Rosetta.

Install the local tarball as a development dependency:

```sh
npm install --save-dev --save-exact --ignore-scripts --offline /absolute/path/to/binary-balance-seshat-darwin-x64-0.1.0-rc.1.tgz
./node_modules/@binary-balance/seshat-darwin-x64/bin/seshat --help
```

The installed command runs the packaged Rust executable directly. Consumers
need no Rust toolchain. The package has no install hook, npm bin alias or npm
runtime dependency. Use the direct installed command for clean JSON and direct
signal handling. The user-facing entry package supplies the npm launcher.

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
