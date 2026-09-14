# Release notice audit

Status: bounded runtime notice integration for issue #6. This records the
single clean Linux x64 pack produced after the package layout and the remaining
five-target audit gap.

There was no existing `docs/research` convention in this checkout. This file
is the single research note for the audit. The pinned Rust runtime notice
assets live under
[`packaging/runtime-notices/`](../../packaging/runtime-notices/); they are
validated source material now appended to the native package notice. The final
five-target audit still needs to be repeated against each native archive.

## Scope and evidence

The preliminary review used [`packaging/pack.mjs`](../../packaging/pack.mjs) at
`0edd0a3` and the earlier proof package evidence below. The bounded integration
pack uses the moved [`crates/seshat/Cargo.toml`](../../crates/seshat/Cargo.toml),
its [`Cargo.lock`](../../crates/seshat/Cargo.lock), and Rust 1.98.1.

| target | binary evidence | package archive evidence | notice evidence |
| --- | --- | --- | --- |
| Linux x64, `x86_64-unknown-linux-gnu` | 2,026,496 bytes, SHA-256 `0a2af3a7f412b7f8ea6e9ef18ae2124a7fc4fbf53105a6c466ae621bd91fba23` | 906,584 bytes, SHA-256 `d7119c9ff3d57ab852a0d0e8d6e57849b872f6c6f9a5293283a0395c2aa13f69` | 485,480 bytes, SHA-256 `38b043790a3e0b57d0e6df6ae03ea97022b401a2b07c2ef03f38a050d3cdbad3` |
| Linux ARM64, `aarch64-unknown-linux-gnu` | 1,815,248 bytes, SHA-256 `1875ee97580d955079313e3ca4181cd96acb8b32db4488b540093adc963e6da0` | 862,472 bytes, SHA-256 `c9fa2f430479d2934738d6bc3df5e486091da3de9d1861f230728659ba0a2b5d` | same 485,480-byte Unix notice as Linux x64 |
| macOS x64, `x86_64-apple-darwin` | 1,867,488 bytes, SHA-256 `069dcc588b30be6034343599eb830b9005088110efd816ac280e0409bca00883` | 858,410 bytes, SHA-256 `a6aa3f8b80ea9c94995ab8fe3191dc5318c0a9d0af3617bcbe51deed5ad0b01f` | same 485,480-byte Unix notice |
| macOS ARM64, `aarch64-apple-darwin` | 1,823,648 bytes, SHA-256 `39baf5a607bc210ad340ccfa88267d23918cabac33ecba19c7c86c4d8110b0c7` | 838,416 bytes, SHA-256 `4de118e36f9b173c093f508da2437ba05756671e6b47786ce6798ef14e7a8e6d` | same 485,480-byte Unix notice |
| Windows x64 MSVC, `x86_64-pc-windows-msvc` | 2,066,944 bytes, SHA-256 `ab2e49aacd41c34b0e256eaddbb61a4c728801e141bea3381b9e74ee3408a912` | 880,937 bytes, SHA-256 `5b7651eb45900ab291b2434175a195d77870a06d8fc84523a6306056cdf0e33d` | 485,788 bytes, SHA-256 `bd36a6400cfdcbd14fac87355f0263b0e928806ac4c91b4f83692e5a14f3174e` (CRLF) |

The historical five archives contain the same six package paths, with the platform
binary name adjusted on Windows: `BUILD.json`, `LICENSE`, `README.md`,
`THIRD_PARTY_NOTICES.txt`, `bin/seshat` or `bin/seshat.exe`, and
`package.json`. The npm and standalone archives are byte-identical in each
proof. The current proof packages identify themselves as version `0.0.0
(candidate)`, which is why their hashes cannot serve as v0.1.0 release hashes.

### Bounded Linux x64 integration pack

One clean-source pack was run at commit `45e1406980f32ec3e09652df1ce40f8b4a9b02e9`
with Rust `1.98.1 (48a229ceaefd4985c50990b14116b6d856af0985)`, Node
`24.20.0`, npm `11.19.0`, and the pinned Debian 11 input directory. The command
was `node packaging/pack.mjs work/debian11-inputs`. The retained local evidence
is under `work/release-notice-audit/linux-x64/`:

- `binary-balance-seshat-linux-x64-0.1.0-rc.1.tgz`: 948,125 bytes,
  SHA-256 `4ea2fdb4acac6b051e648ef28c5e3f5799a1c1d79ceda437a98810b43ab93381`.
- `pack-result.json`: 1,995 bytes, SHA-256
  `92f437bbfb0224233572988883a6a12cb814c6da5e765eb1ca55c09f9c47f8d7`.
- Extracted `bin/seshat`: 2,028,296 bytes, SHA-256
  `49a6ed93d8d13d0ed8166d0e93066c9d54275694ed5d85505953ebfda56ddc60`.
- Extracted `BUILD.json`: 9,785 bytes, SHA-256
  `cd834c82caab0d7d9614371a5a8c691ffb34fb0c90181ad95aa167319ef35501`.
- Extracted `THIRD_PARTY_NOTICES.txt`: 2,057,665 bytes, SHA-256
  `49ebba598a25d26340cf836ea7dfcaa58ed7a279cefe32b9e63bf7aafb52c5d5`.

The archive contains exactly `BUILD.json`, `LICENSE`, `README.md`,
`THIRD_PARTY_NOTICES.txt`, `bin/seshat`, and `package.json`. The extracted
`BUILD.json` binds `sourceCommit` to the clean pack commit and records the
notice hash, all nine pinned Rust asset hashes and byte counts, and the full
Rust commit. The archive notice check compared its extracted bytes with the
staged notice. It contains the root `COPYRIGHT` and `UNLICENSE`, the siphasher
`COPYING` attribution naming the Rust Project Developers and Frank Denis plus
complete MIT/Apache terms, the conservative multi-target Rust inventory, and
the compiler-builtins, compiler-rt credits, and libm texts.

This is local Linux x64 evidence for the integration code. It does not establish
final applicability for Linux ARM64, macOS, or Windows, and it does not replace
the final five-target native audit.

The extracted `BUILD.json` files are: Linux x64, 7,720 bytes, SHA-256
`38440c9abb91510696411168d3a0de014b21f0dce270f13ecb8fed0fcdcd991f`; Linux
ARM64, 7,193 bytes, `e7308a6b07cfb2c8d29cf84676589d202d8e0e10915c033a0c374907e213a6dc`;
macOS x64, 7,152 bytes, `b921ae331a4fdb4b1b0cb4f965fc43b9669b3354172e9edf387a8320374d13e5`;
macOS ARM64, 7,154 bytes,
`554fe3c012e173bc280396d7b4676f6e4b5b30218926ab6942dcbfdb59741f0e`; and
Windows x64, 8,054 bytes,
`e807c04e5518b43c1bfc3de831a89ae7df4076dd84eeccedf23c080c22f515f7`.

`packaging/pack.mjs` obtains `cargo metadata --locked --offline`, selects every
package with a crates.io or Git `source`, and sorts them by name. Cargo's
`license` field is declared package metadata, as described in the [Cargo
manifest reference](https://doc.rust-lang.org/cargo/reference/manifest.html#the-license-and-license-file-fields)
and [cargo metadata reference](https://doc.rust-lang.org/cargo/commands/cargo-metadata.html).
It is useful for inventory, but it does not prove that the declared text is a
complete attribution or that the package's code is in a particular target
binary.

## Rust crate inventory in the current packages

The current lockfile has SHA-256
`9bc31fc47fe014edb449dbb172401f1bf8cc423324ec972e305880d2d1a7d243` and
resolves 66 packages, including the local root, and 65 source packages. The
following is the exact source package inventory emitted into each current
notice file. Windows has the same sections and bytes after CRLF normalization.

| declared license | packages and versions |
| --- | --- |
| `MIT` | `castaway 0.2.4`, `compact_str 0.10.0`, `cow-utils 0.1.3`; `oxc_allocator`, `oxc_ast`, `oxc_ast_macros`, `oxc_ast_visit`, `oxc_data_structures`, `oxc_diagnostics`, `oxc_ecmascript`, `oxc_estree`, `oxc_parser`, `oxc_regular_expression`, `oxc_span`, `oxc_str`, `oxc_syntax` all `0.148.0`; `oxc_index 5.0.0`; `phf`, `phf_generator`, `phf_macros`, `phf_shared` all `0.14.0`; `smawk 0.3.3`, `textwrap 0.16.2`, `zmij 1.0.23` |
| `MIT OR Apache-2.0` | `allocator-api2 0.2.21`, `bitflags 2.13.1`, `cfg-if 1.0.4`, `errno 0.3.14`, `glob 0.3.3`, `hashbrown 0.17.1`, `itoa 1.0.18`, `libc 0.2.189`, `nonmax 0.5.5`, `num-bigint 0.5.1`, `num-integer 0.1.47`, `num-traits 0.2.19`, `percent-encoding 2.3.2`, `proc-macro2 1.0.107`, `quote 1.0.47`, `rustversion 1.0.23`, `seq-macro 0.3.6`, `serde 1.0.229`, `serde_core 1.0.229`, `serde_derive 1.0.229`, `serde_json 1.0.151`, `signal-hook 0.4.4`, `signal-hook-registry 1.4.8`, `smallvec 1.16.0`, `static_assertions 1.1.0`, `syn 2.0.119`, `syn 3.0.5`, `unicode-segmentation 1.13.3`, `unicode-width 0.2.2`, `windows-link 0.2.1`, `windows-sys 0.61.2` |
| `Apache-2.0 OR MIT` | `autocfg 1.5.1`, `fastrand 2.5.0`, `rustc-hash 2.1.3` |
| `Apache-2.0` | `unicode-linebreak 0.1.5` |
| `Apache-2.0/MIT` | `bytecount 0.6.9` |
| `MIT/Apache-2.0` | `siphasher 1.0.3` |
| `Unlicense OR MIT` | `memchr 2.8.3` |
| `(MIT OR Apache-2.0) AND Unicode-3.0` | `unicode-id-start 1.4.0`, `unicode-ident 1.0.24` |
| `Apache-2.0 WITH LLVM-exception OR BSL-1.0` | `dragonbox_ecma 0.1.12` |

The target normal dependency graph has the Oxc parser/AST stack plus
`serde`, `serde_json`, `glob`, and `percent-encoding` on all five targets.
Unix targets additionally use `signal-hook`, `signal-hook-registry`, `errno`,
and `libc`; Windows uses `windows-sys` and `windows-link` instead of that Unix
signal path. The current packer still emits all 65 source packages for every
target, including packages selected only for another target.

The build graph also contains proc-macro or build support such as
`oxc_ast_macros`, `phf_macros`, `serde_derive`, `seq-macro`, `rustversion`,
`autocfg`, and their macro support (`proc-macro2`, `quote`, `syn`,
`unicode-ident`, `phf_generator`, `fastrand`, and related packages). These are
used to produce the binary and are not runtime libraries in the package. The
current full inventory is a reasonable conservative attribution appendix.
`BUILD.json` labels its `dependencies` list with
`dependencyInventoryScope`, which identifies the locked source/build inventory
and keeps it separate from an exact linked-runtime claim.

### License files collected and gaps

For each source package, the packer appends root files whose names match
`LICENSE`, `LICENCE`, `COPYING`, or `NOTICE`, case-insensitively, followed by
the declared license string. That captures the full dual MIT/Apache files for
most packages, the Unicode license files for `unicode-id-start` and
`unicode-ident`, `LICENSE-Apache2-LLVM` and `LICENSE-Boost` for `dragonbox_ecma`,
and the Oxc fallback described below.

The integration decisions for these three items are explicit:

1. `unicode-segmentation 1.13.3` and `unicode-width 0.2.2` each ship a root
   `COPYRIGHT` file and their generated sources point to it. The package
   matcher includes it. The [Unicode License
   V3](https://www.unicode.org/license.txt) requires the copyright and permission
   notice to accompany copies or associated documentation.
2. `siphasher 1.0.3` ships only a `COPYING` pointer naming the Rust Project
   Developers and Frank Denis and pointing to either Apache-2.0 or MIT. Keep
   that pointer and append the complete canonical Apache-2.0 and MIT texts.
   This preserves the upstream attribution rather than replacing it with a
   Seshat copyright.
3. `memchr 2.8.3` ships `COPYING`, `LICENSE-MIT`, and `UNLICENSE`; the matcher
   retains all three offered files.

The Oxc crates in the proof omit a root license file. The packer only accepts
the exact pinned versions and `.cargo_vcs_info.json` revisions, then appends
`packaging/OXC-LICENSE`. The recorded revisions are Oxc 0.148.0 at
`894c8f9cd89508391b01eb26a4b5ac2b846ab39b` and `oxc_index 5.0.0` at
`8e09fe324eb6df02f56e4eacdfac958930300380`. The fallback matches the pinned
[Oxc MIT license](https://github.com/oxc-project/oxc/blob/894c8f9cd89508391b01eb26a4b5ac2b846ab39b/LICENSE)
and the [pinned oxc_index license](https://github.com/oxc-project/oxc-index-vec/blob/8e09fe324eb6df02f56e4eacdfac958930300380/LICENSE).
Keep the revision checks when the crate is moved.

## Rust runtime and compiler provenance

All five proof binaries report `rustc 1.98.1 (48a229cea 2026-09-01)`. The
bundled toolchain uses LLVM 22.1.8. The pinned assets copy the matching
sysroot's `COPYRIGHT-library.html` byte-for-byte and retain the complete
Apache-2.0, MIT, Unicode-3.0, BSD-2-Clause, and LLVM-exception texts. The
asset manifest records each byte count, SHA-256, source URL, and the Rust
commit. The generated Rust file states that the standard library is primarily
Apache-2.0 OR MIT and records the in-tree material used by the library. In the
inspected toolchain that includes:

- Rust Project standard-library code under Apache-2.0 OR MIT.
- Rust standard-library Unicode tables under Unicode-3.0, attributed to
  Unicode, Inc.
- `library/backtrace` under Apache-2.0 OR MIT, with Alex Crichton and Rust
  Project attribution.
- the Crossbeam synchronization code under Apache-2.0 OR MIT, with Crossbeam
  and Rust Project attribution.
- the Fuchsia synchronization file under BSD-2-Clause plus Apache-2.0 OR MIT.

The generated file also includes a long out-of-tree list for the standard
library build, including code for targets that are not necessarily present in
these five executables. It contains entries with licenses such as MPL-2.0 and
LGPL-2.1-or-later. The committed asset keeps that complete upstream inventory,
with a scope label that says it spans multiple targets and build dependencies;
it does not claim that every listed entry is linked into every Seshat binary.
The [Rust 1.98.1 copyright file](https://raw.githubusercontent.com/rust-lang/rust/48a229ceaefd4985c50990b14116b6d856af0985/COPYRIGHT)
specifically points distributors to the generated standard-library copyright
file. The pinned asset directory carries the matching full license texts and
does not silently apply them to another Rust version.

The pinned compiler-builtins license records `MIT AND Apache-2.0
WITH LLVM-exception`, not an either/or expression for the crate. It includes
the compiler-rt attribution. The adjacent fixed LLVM `CREDITS.TXT` and
`libm-LICENSE.txt` preserve the referenced compiler-rt, musl, CORE-MATH, and
Jorge Aparicio credits. Include these files in the runtime notice when
compiler-builtins is present. The [fixed compiler-builtins source](https://raw.githubusercontent.com/rust-lang/rust/48a229ceaefd4985c50990b14116b6d856af0985/library/compiler-builtins/LICENSE.txt)
and [fixed libm source](https://raw.githubusercontent.com/rust-lang/rust/48a229ceaefd4985c50990b14116b6d856af0985/library/compiler-builtins/libm/LICENSE.txt)
are recorded in the manifest.

The pinned `std/Cargo.toml` source fact selects `fortanix-sgx-abi` only for
`x86_64-fortanix-unknown-sgx` and `r-efi`/`r-efi-alloc` only for
`target_os = "uefi"`. None of the five supported targets is SGX or UEFI, so
the Fortanix MPL-2.0 entry and the UEFI MIT OR Apache-2.0 OR LGPL-2.1-or-later
alternatives are target-specific. They are not blanket licenses for the five
Seshat packages. The pinned unwind source fact selects no extra unwinder for
MSVC and links `gcc_s` for the ordinary non-`crt-static` Linux GNU path. Final
native link evidence still decides whether another target runtime notice is
needed.

`rustc`, Cargo, LLVM, LLD, Apple clang, the Windows SDK, and the Linux linker
are build-only tools. Their version strings in `BUILD.json`, including the
observed LLVM/LLD version, do not prove that the tool binaries or compiler
source are in the package. Keep their versions as reproducibility provenance;
do not add compiler or LLVM notices to the consumer package solely because a
compiler produced it. The conservative asset uses the exact host sysroot
available for Rust 1.98.1. It does not claim that the host sysroot is a
complete inspection of every target sysroot.

## Platform runtime boundary

### Linux x64 and ARM64

The x64 binary imports `libgcc_s.so.1`, `libpthread.so.0`, `libm.so.6`,
`libdl.so.2`, `libc.so.6`, and `ld-linux-x86-64.so.2`; its observed GLIBC
symbols reach `GLIBC_2.30`, below the packer's 2.31 ceiling. The ARM64 binary
imports `libgcc_s.so.1`, `libm.so.6`, and `libc.so.6`; its observed symbols
reach `GLIBC_2.34`, below the native Ubuntu 22.04/GLIBC 2.35 ceiling.

Neither package archive contains a glibc or libgcc shared object. For x64,
the three pinned Debian `.deb` files (`libc6`, `libc6-dev`, and `libgcc-s1`)
are build sysroot inputs recorded by hash in `BUILD.json`, not redistributed
payload files. ARM64 uses the native Ubuntu build environment and records no
glibc package files. The current package should document these shared runtime
prerequisites and their observed symbol ceilings. The [GCC libgcc
documentation](https://gcc.gnu.org/onlinedocs/gccint/Libgcc.html) identifies
`libgcc_s.so.1` as the low-level runtime supplied by GCC; GCC's [runtime
library terms](https://gcc.gnu.org/onlinedocs/libstdc++/manual/license.html)
describe the GCC Runtime Library Exception for covered files. The [glibc
copying guidance](https://sourceware.org/glibc/manual/2.43/html_node/Copying.html)
describes the LGPL terms and notes the treatment of normal operating-system
components.

If a future package starts copying those `.so` files or a complete sysroot,
the files become redistribution inputs and the release must carry the
applicable glibc LGPL/source materials and GCC runtime terms. The current
archives do not provide evidence for that bundled case.

### macOS x64 and ARM64

Both Mach-O binaries depend on `/usr/lib/libSystem.B.dylib` and
`/usr/lib/libiconv.2.dylib`, and both are built for a 15.0 deployment target
with SDK 15.5. No dylib is present in either archive. Apple's [system
framework documentation](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/OSX_Technology_Overview/SystemFrameworks/SystemFrameworks.html)
describes the system dynamic libraries under `/usr/lib`, and the [framework
linking documentation](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPFrameworks/Tasks/IncludingFrameworks.html)
explains that system framework code is in a shared library rather than copied
into the executable. Treat these as OS-provided prerequisites for the current
bytes. If the final package ever embeds a dylib, inspect and notice that file
separately.

### Windows x64 MSVC static CRT

The PE proof is `PE32+`, machine `0x8664`, and imports only `KERNEL32.dll`,
`api-ms-win-core-synch-l1-2-0.dll`, `kernel32.dll`, and `ntdll.dll`. It has no
`MSVCP*.dll` or `VCRUNTIME*.dll` import. The build records
`-C target-feature=+crt-static` and `/Brepro`, MSVC 19.44.35228, linker
14.44.35228.0, and Windows SDK/UCRT 10.0.26100.0.

Rust's [linkage reference](https://doc.rust-lang.org/reference/linkage.html)
and [rustc codegen options](https://doc.rust-lang.org/rustc/codegen-options/)
define the `crt-static` setting. Microsoft's [`/MT` runtime-library
documentation](https://learn.microsoft.com/en-us/cpp/build/reference/md-mt-ld-use-run-time-library?view=msvc-170)
states that the multithreaded static runtime uses `LIBCMT.lib`; the [CRT
library feature table](https://learn.microsoft.com/en-us/cpp/c-runtime-library/crt-library-features?view=msvc-170)
also identifies the static UCRT, VCRUNTIME, and CRT libraries used by `/MT`.
This explains the lack of VC runtime DLL imports, but it does not turn the
MSVC static libraries into Cargo dependencies.

The archive does not contain a Visual C++ redistributable DLL. Windows system DLLs remain OS-provided. Retained run `34578770812` evidence identifies Visual Studio 2022 Enterprise, MSVC tools `14.44.35207`, the redist directory version `14.44.35112`, and Windows SDK/UCRT `10.0.26100.0`. No raw `.lib`, DLL, SDK, or Visual Studio installer is a package payload.

### Node launcher packages

The current packer stages no third-party JavaScript dependency, runs npm with
`--ignore-scripts`, and does not copy a Node binary. Node is consumer-supplied.
For v0.1.0-rc.1, inspect each of the new launcher and native-payload package
manifests after the crate move: `dependencies`, `optionalDependencies`,
`bundledDependencies`, `files`, lifecycle scripts, and archive contents. Any
new runtime dependency or copied executable changes the notice and runtime
boundary described here.

## Final v0.1.0-rc.1 checklist

Repeat these checks for the final five native artifacts:

1. Run locked, offline metadata and target-specific `cargo tree` from the
   moved `crates/seshat` manifest for all five triples. Record the new lockfile
   hash and identify runtime, proc-macro, build-only, and target-only packages.
2. Extract every final npm and standalone archive. Record archive and binary
   SHA-256 values, the six or five expected payload paths for each new package,
   and the hashes of `BUILD.json`, `LICENSE`, and `THIRD_PARTY_NOTICES.txt`.
   Keep normalized line endings when comparing Windows notices.
3. Regenerate the dependency notice from the final lockfile. Include root
   `COPYRIGHT` for `unicode-segmentation` and `unicode-width`, preserve the
   `siphasher` pointer alongside complete MIT/Apache text, and retain
   `memchr`'s `UNLICENSE`. Recheck the pinned Oxc revisions before applying
   the fallback.
4. Add the pinned Rust runtime notice assets from
   `packaging/runtime-notices/rust-1.98.1/`. Retain the complete
   `COPYRIGHT-library.html` inventory and the matching Apache, MIT, Unicode,
   BSD, compiler-builtins, compiler-rt credits, and libm texts. Label the
   inventory as spanning multiple targets and standard-library build
   dependencies. Keep the source and hash record beside the notice.
5. Re-run platform inspection on the final executable: Linux `readelf` dynamic
   imports and GLIBC versions, macOS `otool -L` and deployment load commands,
   and Windows PE imports plus the static-CRT/MSVC/SDK record.
6. Inspect final Node package manifests and npm file lists for hidden runtime
   dependencies, bundled files, install hooks, or downloads. Confirm Node is
   still consumer-supplied if that remains the design.
7. Run `git diff --check`, verify every external citation, and preserve the
   final evidence beside the artifact hashes without maintainer-local paths.

## Outstanding evidence gaps

- The final five-target v0.1.0-rc.1 package bytes do not exist in the retained
  evidence. A single clean Linux x64 integration archive is recorded above;
  the other four native archives still need their final runs.
- The crate move, new package manifests, launcher, and final lockfile can
  change both the dependency set and the archive file list. The old
  `Cargo.lock` hash must not be reused.
- Only the host Linux x64 Rust sysroot was inspected locally. The committed
  1.98.1 assets intentionally preserve the complete upstream standard-library
  inventory across targets rather than claiming an exact linked-object subset.
  Matching target sysroots for Linux ARM64, macOS x64/ARM64, and
  Windows MSVC still need final native link review for any additional
  target-specific material.
- The Linux proof directories retain compressed archives and test metadata,
  but not unpacked `BUILD.json` and notices. The macOS and Windows directories
  retain `BUILD.json`; their notice files still need extraction from the
  archives for a portable final evidence set.
- The local Linux x64 archive check confirms root `COPYRIGHT` and `UNLICENSE`
  inclusion and the `siphasher` full-text policy. Repeat those checks against
  the other four final native archives.
- Current `BUILD.json` records compiler/runtime provenance but does not itself
  establish that compiler or LLVM source is in the package. Final notices must
  follow linked and physically copied components, not version strings.
