# Seshat local Linux ARM64 payload

This is the `@binary-balance/seshat-linux-arm64` native payload for Linux ARM64
on Ubuntu 22.04 with glibc 2.35. The package records its target, binary hash,
native library requirements and dependency versions in `BUILD.json`. Node
24.20.0 is the verified test runtime.

Install the local tarball as a development dependency:

```sh
npm install --save-dev --save-exact --ignore-scripts /absolute/path/to/binary-balance-seshat-linux-arm64-0.1.0-rc.1.tgz
./node_modules/@binary-balance/seshat-linux-arm64/bin/seshat --help
```

The installed command runs the packaged Rust executable directly. Consumers
need no Rust toolchain. The package has no install hook, npm bin alias or npm
runtime dependency. The binary is built on the native `ubuntu-22.04-arm` runner. The
candidate does not claim support for other glibc versions, Alpine, macOS or
Windows, and the hosted proof does not establish a historical kernel floor.

The source checkout's `docs/linux-arm64-package.md` documents the complete
native build, npm installation, standalone extraction, CLI and process-control
checks.
