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
archive with the Windows `tar.exe`, using the Unicode standalone directory as the
child `cwd` and omitting `-C` because stock `tar.exe` cannot reliably receive
that path argument, then runs the extracted executable. Consumer PATH keeps
`SystemRoot`, `ComSpec`, `System32`, Node and `npm.cmd`, while `cargo`, `rustc`
and Cargo environment variables are absent. The workflow also retains the
separately built `seshat-proofs.exe` for the shared 43-scenario legacy parity
check. It then runs `windows-runtime-cli.mjs` against the installed executable,
retaining cleanup, timeout, overflow, repeated leader-exit and
console-cancellation evidence.

The package summary is fail-closed for the preflight, two-run reproducibility,
archive identity, install, no-Rust and native Windows runtime checks. The
workflow runs the shared 43 CLI scenarios, 11 parallel controls and four
installed Jest/Expo and Vitest cases against the installed executable. Missing
or partial integration evidence remains an explicit summary gap. This slice
does not claim desktop Windows, Windows ARM64, POSIX signal semantics, signing,
notarization or public release distribution.

## Final native proof

The final proof is [workflow run 34578770812](https://github.com/Binary-Balance/seshat/actions/runs/34578770812),
with [job 103197240188](https://github.com/Binary-Balance/seshat/actions/runs/34578770812/job/103197240188)
and the retained [Windows x64 artifact](https://github.com/Binary-Balance/seshat/actions/runs/34578770812/artifacts/10191061364).
It tested merge source
`0edd0a3a546d2a94f8ddac59aa52123a22c821c8` from `refs/pull/31/merge`, with PR
head `97a19aa27ac7c78e95ccf3dcfac68befbabf3460`. The tested source tree matches
merged `main` `b1a35c594854cbb0f9958be90ec254902b56a9c9`.

The native host was Windows Server 2022 Datacenter build 20348 on the
`windows-2022` runner, with native x64 target `x86_64-pc-windows-msvc`, PE32+
machine `0x8664` and static CRT. Node was `v24.20.0`, npm `11.19.0`, and
rustc/Cargo `1.98.1`; MSVC was `19.44.35228`, the linker was `14.44.35228.0`,
and the Windows SDK/UCRT was `10.0.26100.0`. The final executable imports
`KERNEL32.dll`, `api-ms-win-core-synch-l1-2-0.dll`, `kernel32.dll` and
`ntdll.dll`, with no VCRUNTIME or MSVCP dependency.

Both routes passed with Cargo and Rustc unavailable to the consumer. The npm
route passed 43 CLI scenarios and 11 parallel controls. The standalone route
passed archive listing and extraction, matching archive, binary and `BUILD.json`
hashes, version and help checks. Jest/Expo and Vitest each ran four requested
cases against the npm installation, with originals preserved. The Windows runtime
proof passed baseline, timeout, output overflow, leader exit, repeated leader
exit and console cancellation, including Unicode/space paths, junction capture,
deadlines, descendant cleanup and empty scratch directories. The summary had no
integration gaps. Windows cancellation uses `CTRL_BREAK_EVENT` through the
native console helper; this proof does not claim POSIX signal semantics.

The npm and standalone archives are each 880,937 bytes with SHA-256
`5b7651eb45900ab291b2434175a195d77870a06d8fc84523a6306056cdf0e33d`. The
2,066,944-byte binary has SHA-256
`ab2e49aacd41c34b0e256eaddbb61a4c728801e141bea3381b9e74ee3408a912`; the
8,054-byte `BUILD.json` has SHA-256
`e807c04e5518b43c1bfc3de831a89ae7df4076dd84eeccedf23c080c22f515f7`. Two
clean packs matched all four identities and the retained installed artifact.
The complete path-free record is [outputs/platform-support.json](../outputs/platform-support.json).
The raw artifact is retained by GitHub until 2026-12-10T08:21:24Z.

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
