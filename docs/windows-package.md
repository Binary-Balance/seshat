# Windows x64 package protocol

This protocol covers the native Windows x64 package slice of issue 2. The
build runs on the GitHub `windows-2022` runner, which provides Windows Server
2022 kernel build 20348, Node 24.20.0 and Rust 1.98.1. The candidate target is
`x86_64-pc-windows-msvc`.

`packaging/pack.mjs --native-windows` builds the `seshat.exe` and
`seshat-proofs.exe` binaries with a target-specific
`-C target-feature=+crt-static` flag and MSVC `/Brepro`. It reads the PE header
and import table from the final executable. The pack fails if the machine is
not `0x8664`, the image is not PE32+, or it imports `VCRUNTIME*.dll` or
`MSVCP*.dll`. The build metadata records the imported DLLs, compiler, linker,
Windows SDK, OS, source commit and binary hash. Windows UCRT system components
are allowed and are not copied into the package.

The packer uses npm's normal deterministic `.tgz` as both the npm artifact and
the standalone artifact. `packaging/repeat-pack.mjs --native-windows` runs two
clean packs and retains binary, `BUILD.json`, npm archive and standalone archive
hash comparisons. The package workflow binds those two runs to the retained
artifact hashes before writing its summary.

The installed proof uses a disposable consumer under a path containing spaces
and Unicode. It runs the installed executable, npm's generated `.bin\seshat.cmd`
launcher, `npm exec`, a package script and offline `npm ci`. It extracts the same
archive with the Windows `tar.exe` and runs the extracted executable. Consumer
PATH keeps `SystemRoot`, `ComSpec`, `System32`, Node and `npm.cmd`, while
`cargo`, `rustc` and Cargo environment variables are absent. It then runs
`windows-runtime-cli.mjs` against the installed executable, retaining cleanup,
timeout, overflow, repeated leader-exit and console-cancellation evidence.

The package summary is fail-closed for the preflight, two-run reproducibility,
archive identity, install, no-Rust and native Windows runtime checks. The
workflow runs the shared 43 CLI scenarios, 11 parallel controls and four
installed Jest/Expo and Vitest cases against the installed executable. Missing
or partial integration evidence remains an explicit summary gap. This slice
does not claim desktop Windows, Windows ARM64, POSIX signal semantics, signing,
notarization or public release distribution.

Run the local script checks from the repository root:

```sh
node --check packaging/pack.mjs
node --check packaging/repeat-pack.mjs
node --check benchmarks/proofs/windows-package-preflight.mjs
node --check benchmarks/proofs/windows-package-install.mjs
node --check benchmarks/proofs/windows-package-summary.mjs
node benchmarks/proofs/windows-package-preflight.mjs --self-check
node benchmarks/proofs/windows-package-summary.mjs --self-check
```

The native build and install proof require the Windows Server 2022 runner and
are dispatched by `.github/workflows/windows-package.yml`.
