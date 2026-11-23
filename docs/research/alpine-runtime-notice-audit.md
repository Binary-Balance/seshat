# Alpine runtime notice prerequisites

Checked 2026-11-23 for [#125](https://github.com/Binary-Balance/seshat/issues/125).
The retained native x64 and ARM64 maps require additional musl and LLVM runtime
attribution before npm musl packages can be prepared. The assets in
[`rust-1.98.1-musl`](../../packaging/runtime-notices/rust-1.98.1-musl/provenance.json)
record that prerequisite; they are not wired into packaging. The existing five
targets and their Rust notice payload remain unchanged.

## Artifact identity

[PR #308](https://github.com/Binary-Balance/seshat/pull/308) retained the maps in
[Actions run 45143532749](https://github.com/Binary-Balance/seshat/actions/runs/45143532749).
The artifact head is `5cf94be2387603363c83a2a0a9849da00ababa1f`.
`host.json` records GitHub's tested merge
`97ccb8629ac67e3c3f4465a22012e4668d3f337d`; its Git tree and the reviewed head's
tree are both `b3da54d99378bb4f8cd4dc2032f3c5f02e626d35`. These are the same
source tree, not separate unreviewed implementation inputs.

| Target | Artifact ID | ZIP SHA-256 |
| --- | --- | --- |
| `x86_64-unknown-linux-musl` | `14802609465` | `e3be1a30111f3f5b72a5424222cf8d20fef90c28d61177766b8ed6aaef549ccb` |
| `aarch64-unknown-linux-musl` | `14802693868` | `eb4e2912778d2245f9c2789de5832deeb46dfb5c9735ef2f6acbc06d2cf946ce` |

The ZIP digests match GitHub's artifact metadata. The companion
[audit inventory](alpine-runtime-notice-audit.json) records portable ZIP member
paths, map/ELF/binary-hash report identities, every retained runtime archive
hash, and the archive members admitted by both the CLI and proof-binary links.
The raw ZIPs are retained locally as `work/alpine-prerequisites/ci-{x64,arm64}.zip`;
the artifact IDs and hashes identify them independently of those local names.

## Linked runtimes

Both maps load `libc.a` and `libunwind.a` from the pinned Rust target's
`lib/rustlib/<target>/lib/self-contained/`, rather than Alpine's library paths.
The x64 links load `rcrt1.o`, `crti.o`, `crtbeginS.o`, `crtendS.o`, and `crtn.o`;
the ARM64 links load `crt1.o`, `crti.o`, `crtbegin.o`, `crtend.o`, and `crtn.o`.
The ELF reports have no interpreter or dynamic section. The maps show no other
native `.a` archives; their Rust `.rlib` inputs remain covered by the existing
Cargo/Rust notice process. The available sanitizer archives in x64's hash report
are not linked by these maps.

| Target | `libc.a` SHA-256 | `libunwind.a` SHA-256 |
| --- | --- | --- |
| x64 | `e699c64b0c6b427d89ad5bf767bf78beb30c19930c5dedff635951636e8f9f70` | `eb16569e611a5d6cdda2e7604fd6402a3ad810817dd8d63ed50baa2ce8070aaa` |
| ARM64 | `b03473b6f1efb72f700f561b4407a88885b37e0edb5cdb2a64de0df5499e813f` | `06977ce3e033cf2c06fcbac9b25b7c9213c7b4aa09f2a4d4b4427fb809b9f203` |

The CLI/proof maps admit 299 libc members on x64 and 295 on ARM64. Both admit
`libunwind`, `UnwindLevel1`, `UnwindLevel1-gcc-ext`, `UnwindRegistersSave`, and
`UnwindRegistersRestore` objects. Admission can precede discarded sections;
these counts do not claim that every member's code survives garbage collection.

## Source and notice selection

The toolchain is `rustc 1.98.1 (48a229cea 2026-09-01)`, full Rust commit
[`48a229ceaefd4985c50990b14116b6d856af0985`](https://github.com/rust-lang/rust/tree/48a229ceaefd4985c50990b14116b6d856af0985).
Its LLVM submodule is
[`52ed14fcd56afc30f9cccd8ca8ce237c2eef7e04`](https://github.com/llvm/llvm-project/tree/52ed14fcd56afc30f9cccd8ca8ce237c2eef7e04).
Retained bootstrap excerpts show that musl libc/startup objects are copied into
the self-contained directory, libunwind is built from that LLVM tree, and
`crtbegin`/`crtend` are built from compiler-rt's `lib/builtins` sources.
Those CRT objects are not evidence of a linked GCC runtime.

Rust's pinned `musl.sh` and `musl-toolchain.sh` select **musl 1.2.5**, with
CVE-2025-26519, CVE-2026-6042 and CVE-2026-40200 patches. The checked
[musl 1.2.5 release archive](https://musl.libc.org/releases/musl-1.2.5.tar.gz)
matches the SHA-1 recorded by Rust's pinned musl-cross-make commit; its SHA-256
is in the manifest. All four patches apply to the release archive; retained musl notice bytes
remain identical after applying them. The patches add no new license notices.
Alpine's
`musl-1.2.6-r2` in `host.json` identifies the host installation, not the linked
Rust libc. This audit does not infer runtime provenance from the host version.

The additional notice collection preserves:

- Full musl `COPYRIGHT`, including MIT terms, contributors, port notices and
  startup/header attribution exceptions.
- Exact per-file notices for mapped musl math sources and their data headers,
  Sun's `cbrt`, qsort, x64 thread assembly, and Arm's AArch64 `memcpy`/`memset`.
  The Arm source headers say 2012–2020; the full upstream `COPYRIGHT` has its
  own broader description. Both are retained without rewriting either.
- Full pinned libunwind and compiler-rt `LICENSE.TXT`, including Apache terms,
  LLVM exceptions and legacy licenses; compiler-rt's referenced credits; and
  the DWARF constant attribution in libunwind's `dwarf2.h`.

Musl source selection follows its Makefile's architecture override rule and
matches admitted archive member basenames. Some basenames identify multiple
candidate source files, so the inventory retains those candidates rather than
claiming a unique source mapping. The notice scan also checked math data
headers and libunwind's mapped translation units and source-directory headers.
The manifest records full-source identities and exact byte ranges for excerpts.
The existing base Rust collection is still required for standard-library,
compiler-builtins, and libm attribution.

The full libunwind license references `CREDITS.TXT`, but the pinned
[libunwind root](https://github.com/llvm/llvm-project/tree/52ed14fcd56afc30f9cccd8ca8ce237c2eef7e04/libunwind)
has no such file. The retained directory inventory records this upstream gap.
Compiler-rt's credits are included for compiler-rt and are not represented as
libunwind's missing credits.

## Verification and remaining gates

`node packaging/runtime-notice-check.mjs` checks both collections' notice hashes,
source-evidence hashes, rendered notice bytes and an autocrlf checkout. The
existing rendered Rust payload remains 1,558,830 bytes with SHA-256
`197bb2926160e87d1120dd6140c9219ae5607320098784ef08900451e1476a85`.
No existing runtime asset or manifest changed.

The maps and recorded archive hashes identify the runtime inputs used by these
links. Bootstrap sources establish their intended source provenance; this is
not an independently reproduced, byte-for-byte rebuild of Rust's runtime
archives or a claim of legal completeness beyond the checked sources. Repeat
the audit if the toolchain, target link inputs or dependency set changes.

Remaining work includes musl package target/loader selection, target-specific
notice assembly and build metadata, native package and entry-package tarball
verification, and release-support/compatibility gates for both architectures.
No musl npm target, platform-support claim, version bump or publication is
introduced here. npm publication still requires approval of a prepared release.
