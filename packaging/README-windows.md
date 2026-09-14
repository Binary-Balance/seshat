# Seshat local Windows x64 candidate

This is a private, unpublished `@binary-balance/seshat` package for native
Windows x64 on the GitHub `windows-2022` runner. The tested OS baseline is
Windows Server 2022, kernel build 20348. It does not claim support for desktop
Windows versions or other CPU architectures. Node 24.20.0 is the verified
consumer runtime.

The executable targets `x86_64-pc-windows-msvc` and is packaged as
`bin/seshat.exe`. `BUILD.json` records the PE machine, imported Windows DLLs,
Rust and MSVC toolchain versions, Windows SDK details, source commit and binary
hash. The native build requests Rust's target-specific `crt-static` feature and
fails if the resulting executable imports the Visual C++ runtime. Windows UCRT
DLLs remain Windows OS components and are not copied into the package.

Install the local tarball in a consuming project:

```powershell
npm install --save-dev --save-exact --ignore-scripts --offline C:\path\to\binary-balance-seshat-0.0.0.tgz
& .\node_modules\.bin\seshat.cmd --help
npm exec --offline -- seshat --help
```

The package has no install hook or npm runtime dependency. Consumers need no
Rust toolchain. npm creates the normal `.bin\seshat.cmd` launcher, and package
scripts can invoke `seshat` through that launcher.

Build and verify from a clean Windows Server 2022 runner after installing the
locked proof dependencies and Rust 1.98.1:

```powershell
node packaging/pack.mjs --native-windows
$env:SESHAT_REPEAT_OUTPUT = 'work\windows\repeat-pack.json'
node packaging/repeat-pack.mjs --native-windows
```

The package and standalone checks consume the same deterministic npm `.tgz`.
The standalone check extracts it with Windows `tar.exe` into its Unicode child
`cwd` without `-C` and runs the extracted `bin\seshat.exe` without npm; this
keeps the spaces+Unicode consumer path intact. The package workflow also
retains `seshat-proofs.exe` for the shared legacy parity check and runs the
native Windows CLI and cleanup proof against the installed executable. It
retains the source, toolchain, PE imports, build metadata, archive and binary
hashes in its evidence.

This is a local proof artifact. It is not signed, notarized or published.
