# Release notice and runtime audit

Status: current artifact and notice review completed for `0.1.0-rc.1`; native
final proof on the integrated head and the five-host local-install matrix are
still pending. This records artifact, source, runtime, dependency, and notice
evidence for issue #6.

The release support boundary is the one in [`docs/release-scope.md`](../release-scope.md):
Linux x64 and ARM64, macOS x64 and ARM64, and Windows x64. The current
candidate was built from the GitHub PR 40 merge checkout
[`b48ce50c206056b3eabb45c687b9edf1f035528f`](https://github.com/Binary-Balance/seshat/commit/b48ce50c206056b3eabb45c687b9edf1f035528f),
which is the merge result for direct PR head
[`08561afd0070260b6f295604a8ac3fdcb2629681`](https://github.com/Binary-Balance/seshat/commit/08561afd0070260b6f295604a8ac3fdcb2629681).
The merge checkout is the source of the retained bytes; it is not the direct
head. The later proof wiring is integrated at `b104e01`, but new native proof
runs have not replaced these coordinates.

The machine-readable form of the records in this note is
[`release-notice-audit.json`](release-notice-audit.json). It uses portable
labels and GitHub run coordinates. The retained raw archives and proof bundles
remain external to this repository; the hashes below make those bytes
checkable after download.

The repository and linked CI runs are public. The npm package and GitHub
release remain unpublished; these records describe an unpublished release
candidate in a public repository, not a proven private distribution.

## Current artifact coordinates

The six archives below are the coordinates for the documented local-tarball
install. The entry archive is the Unix-produced canonical entry because its
member bytes match every host-produced entry and its launcher member is
executable. Each native coordinate names the release archive, not the ordinary
standalone pack. `archivePath` is the direct path inside the named downloaded
GitHub artifact; the workflow staging directory is stripped by artifact
download.

| package | target | GitHub run and artifact | archive path | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat` | universal entry | [34856550822](https://github.com/Binary-Balance/seshat/actions/runs/34856550822), `linux-x64-package-proof` | `seshat-entry.tgz` | 2,923 | `679ab5a167d3a509261585048ae46f992592e4cdb06e4ab22bc0c4428edfd7ef` |
| `@binary-balance/seshat-linux-x64` | `x86_64-unknown-linux-gnu` | [34856550822](https://github.com/Binary-Balance/seshat/actions/runs/34856550822), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 948,076 | `187c062053aa81d6f4e08cadbe1afc7cb5888c2dc4255f472dc5fadb7b315734` |
| `@binary-balance/seshat-linux-arm64` | `aarch64-unknown-linux-gnu` | [34856550810](https://github.com/Binary-Balance/seshat/actions/runs/34856550810), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 906,609 | `df5fb8f7739a5cdbbec19ea2874459e47100db54026e6c065c103a4fd84e803e` |
| `@binary-balance/seshat-darwin-x64` | `x86_64-apple-darwin` | [34856550939](https://github.com/Binary-Balance/seshat/actions/runs/34856550939), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 902,004 | `d0a2ff9665bd94a0b9401f792f71e413c662c029295fbbe23e459db478e52dac` |
| `@binary-balance/seshat-darwin-arm64` | `aarch64-apple-darwin` | [34856550939](https://github.com/Binary-Balance/seshat/actions/runs/34856550939), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 881,850 | `7f1cb4a1ad7e06c900baf9499e5e0c1a12a882b8c9d386108f6651bb8f46aac8` |
| `@binary-balance/seshat-win32-x64` | `x86_64-pc-windows-msvc` | [34856550809](https://github.com/Binary-Balance/seshat/actions/runs/34856550809), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 924,356 | `52e276dc0d662a5804b3ef338390b69d86158c59995e9a7909e0db19f88ba02e` |

Every native coordinate has `version: 0.1.0-rc.1`, source commit
`b48ce50c206056b3eabb45c687b9edf1f035528f`, a `BUILD.json` hash, a binary
hash, and a notice hash in the companion JSON. Those fields preserve the
build provenance needed to check a downloaded archive against the proof
bundle. The source and run coordinates are also recorded in each retained
`preflight.json`, `release.json`, `package-result.json`, or
the downloaded proof records. `root-artifact-audit.json` is a locally
generated audit over those downloaded bytes.

### Archive classes and member bytes

The entry archive has four members. All five host-produced entries have the
same member paths and member bytes:

| member | bytes | member SHA-256 |
| --- | ---: | --- |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` |
| `package/README.md` | 372 | `fda3929b7c05584de44710114e796500d74c3bd826e30d94f98a2bf3ee0ccb81` |
| `package/bin/seshat.mjs` | 4,753 | `ca5dc2340a31061246cb725574aaedb281c6b9ceee63373165302dd1fcfaf613` |
| `package/package.json` | 627 | `08fce683d42c3bb2ca74bcc1b3340acc96feefa389b02bf8de01b86c3d3651cf` |

The Unix entry tarballs are 2,923 bytes with SHA-256
`679ab5a167d3a509261585048ae46f992592e4cdb06e4ab22bc0c4428edfd7ef`. The
Windows tarball is 2,915 bytes with SHA-256
`e8b05216c9f0eabdcc9a1c21e63c162d6ea6f22805aad96e041458e9ff4a8954`.
The compressed archives therefore remain host-produced bytes even though the
four extracted files are identical. The Unix launcher member has mode `0755`;
the Windows tar member has mode `0644`. Installing the Windows entry on Linux
with npm produced mode `0775`, and both the installed `.bin/seshat` launcher
and `npm exec --offline -- seshat --version` returned
`seshat 0.1.0-rc.1 (candidate)`. This is the retained entry mode proof. It
does not establish every target consumer check.

The native release archives all contain exactly these six paths under
`package/`, with `bin/seshat.exe` on Windows:

```text
package/BUILD.json
package/LICENSE
package/README.md
package/THIRD_PARTY_NOTICES.txt
package/bin/seshat[.exe]
package/package.json
```

The release and ordinary archives are separate archive classes. Their binary,
`BUILD.json`, `LICENSE`, and notice member bytes match for a target, but the
release README is shorter and the `package.json` file order differs from the
ordinary pack. The ordinary npm archive and its standalone archive are
byte-identical within each retained Unix proof. The Windows ordinary archive
was generated and hashed in metadata but its named file was not retained.

| target | ordinary npm archive | standalone archive |
| --- | --- | --- |
| Linux x64 | 948,108 bytes, `da67ea8f1ba3e28c4824005292f2672272a4defa6562fb2022d9781e1e65315a` | same bytes and hash |
| Linux ARM64 | 906,639 bytes, `5edb4f5b03eaee20b57f664bf969e6c5492c50f741995f76a94621a453e47cbc` | same bytes and hash |
| macOS x64 | 902,031 bytes, `be4dc955d2e6870223288a13603a3a26a2658253cd1e8bf6c42f6821058119dc` | same bytes and hash |
| macOS ARM64 | 881,879 bytes, `31106497fd34c600024a7fb21ba4e076908dad4ba53b56dfeff8a3fb38447516` | same bytes and hash |
| Windows x64 | 924,388 bytes, `1f0f257b8c2c86435534459eb2f0eacbdf706ab31521a7fe7fffd19839a4654e` (metadata only) | same metadata hash and size |

The ordinary and standalone hashes must not be substituted for the six
release coordinates above. The audit makes no cross-host gzip or custom-tar
reproducibility promise.

## Native artifact records

The following table records the exact release archive, binary, build record,
and raw notice for each target. The `BUILD.json` and notice values are member
records extracted or independently checked by the retained root artifact
audits.

| target and package | binary | `BUILD.json` | raw `THIRD_PARTY_NOTICES.txt` | release archive |
| --- | --- | --- | --- | --- |
| Linux x64, `@binary-balance/seshat-linux-x64` | 2,026,448 bytes, `c9150b012aeeee2ca543c0c1fdadc1416b43480b3037127d8a27f3f1214a99ba` | 9,957 bytes, `97330fbc052f13ca67ee53df3ddeac9894ff86713d7d3565cd32330459f48ff1` | 2,057,665 bytes, `49ebba598a25d26340cf836ea7dfcaa58ed7a279cefe32b9e63bf7aafb52c5d5` | 948,076 bytes, `187c062053aa81d6f4e08cadbe1afc7cb5888c2dc4255f472dc5fadb7b315734` |
| Linux ARM64, `@binary-balance/seshat-linux-arm64` | 1,815,248 bytes, `4be65daf7601fe154e0afd13bfc16d157db29e913057ad8582f94333aa28a3bd` | 9,432 bytes, `aa3aaeb6bc60edb4e3577023f7a91e1ea2b8f5e1e30de9317de694db2b44436d` | 2,057,665 bytes, `49ebba598a25d26340cf836ea7dfcaa58ed7a279cefe32b9e63bf7aafb52c5d5` | 906,609 bytes, `df5fb8f7739a5cdbbec19ea2874459e47100db54026e6c065c103a4fd84e803e` |
| macOS x64, `@binary-balance/seshat-darwin-x64` | 1,867,192 bytes, `dbabfd063cd2d4ef5fadcd32d70b6e08a99285771f3fba8c1e35401ec634365e` | 9,390 bytes, `728e69662041b765060ad70985517999772a7b6bd219a3f1d07fa93b7e2a6df5` | 2,057,665 bytes, `49ebba598a25d26340cf836ea7dfcaa58ed7a279cefe32b9e63bf7aafb52c5d5` | 902,004 bytes, `d0a2ff9665bd94a0b9401f792f71e413c662c029295fbbe23e459db478e52dac` |
| macOS ARM64, `@binary-balance/seshat-darwin-arm64` | 1,823,376 bytes, `6a5ec32823e925ab8ca2538ef5de751deb62844611efbf6191be9bcb223e9761` | 9,394 bytes, `ea9ea71991d87cfcea9642a5e2359f0c5f6b53cc118faa1281f95e94c3814544` | 2,057,665 bytes, `49ebba598a25d26340cf836ea7dfcaa58ed7a279cefe32b9e63bf7aafb52c5d5` | 881,850 bytes, `7f1cb4a1ad7e06c900baf9499e5e0c1a12a882b8c9d386108f6651bb8f46aac8` |
| Windows x64, `@binary-balance/seshat-win32-x64` | 2,066,432 bytes, `2ead8510b4b395385d0d2303a8dd4a17698bd1f9b5acc61acd7146125791ff8c` | 10,229 bytes, `56adf6f0673c1a77bd966f2e2bbefd629fcbc473bbc60ad33be0ea7f0179e972` | 2,057,973 bytes, `95b852e45022f73d8986918edcea6a1ab3af5d47946f8e530007daa801365376` | 924,356 bytes, `52e276dc0d662a5804b3ef338390b69d86158c59995e9a7909e0db19f88ba02e` |

The target `BUILD.json` files all list the same 65 source packages, the Rust
commit, the source commit, the pinned notice asset hashes, and the native
inspection results. The exact per-target build fields and the source paths
used by the workflows are in the companion JSON.

## Functional acceptance state

Archive integrity is a separate result from consumer behavior. The retained
and current proof state is:

| target | retained and current result | remaining target work |
| --- | --- | --- |
| Linux ARM64 | Full package, npm, public-example, standalone, repeat-pack, Jest, Vitest, and lifecycle checks passed in [run 34856550810](https://github.com/Binary-Balance/seshat/actions/runs/34856550810). | New native package proof on the final integrated head. |
| macOS x64 | The same full check set passed in [run 34856550939](https://github.com/Binary-Balance/seshat/actions/runs/34856550939). | New native package proof on the final integrated head. |
| macOS ARM64 | The same full check set passed in [run 34856550939](https://github.com/Binary-Balance/seshat/actions/runs/34856550939). | New native package proof on the final integrated head. |
| Linux x64 | The retained package proof passed its package, npm, public-example, standalone, repeat-pack, Jest, Expo, Vitest, and lifecycle portions. Its Debian 11 consumer proof failed because the container lacked `examples/verify.mjs`; local commit `8fe0541` passes that proof. The newer all-six-archive local proof passed all four Linux consumer examples and 11 checks. | New native package proof on the final integrated head. |
| Windows x64 | The retained package proof [34856550809](https://github.com/Binary-Balance/seshat/actions/runs/34856550809) at direct head `08561afd` passed preflight and package install checks, then exhausted its aggregate 600-second budget before the next check. Follow-up [34860332470](https://github.com/Binary-Balance/seshat/actions/runs/34860332470) at direct head `8fe0541b` reached the public examples, which passed after 507 seconds, then failed only because the missing-path regex omitted `The system cannot find the path specified. (os error 3)`. After that regex fix, diagnostic [34863375890](https://github.com/Binary-Balance/seshat/actions/runs/34863375890) at direct head `4e8fc189` recorded a 406-second Jest/Expo install and a 95-second normal check before its workers=2 phase exhausted the aggregate 600-second budget. The later [34866863343](https://github.com/Binary-Balance/seshat/actions/runs/34866863343) passed all configured checks at direct head `bb3302ad`, using merge source `e0c6efc`; its Windows binary hash matches the retained binary. This supplemental proof does not replace the retained archive coordinate. | New native package proof on the final integrated head. |

The latest available evidence has Linux x64 and Linux ARM64, both macOS
targets, the supplemental successful Windows package proof in [run
34866863343](https://github.com/Binary-Balance/seshat/actions/runs/34866863343),
and the separate Windows runtime-only check succeeding. The Windows
runtime-only check is [run 34856550801](https://github.com/Binary-Balance/seshat/actions/runs/34856550801);
it is not package acceptance. The supplemental Windows proof uses merge source
`e0c6efc7574aef8df438ab8f2bc40443812f579b` and direct head
`bb3302ad0ae904eb9e1826178eef2a0d1d8a4f7c`; its binary hash is the retained
`2ead8510b4b395385d0d2303a8dd4a17698bd1f9b5acc61acd7146125791ff8c`. It does
not replace the six canonical archive coordinates above. The phase-watchdog
fix from `bb3302a` is integrated at `b104e01`; new native CI is still
pending. These results do not claim an all-target pass.

## Source and dependency review

The moved source inputs are unchanged between the retained proof and the
current checkout after line-ending normalization:

| input | checkout bytes and SHA-256 | normalized SHA-256 |
| --- | --- | --- |
| `crates/seshat/Cargo.toml` | 1,120 bytes, `ecd245a4a83405a8b4ee1620b1ec0a6009c290031b1eab11e167a92073c13b16` | 1,069 bytes, `ba22282c69d3773cd9d57e3e7a55351fd7617580febd5096e81599a87abc5dd7` |
| `crates/seshat/Cargo.lock` | 16,431 bytes, `39d94df38462d97b4859ce8e0636a4bfa458d59dc2b2b78011ee64213438e8f0` | 15,808 bytes, `9bc31fc47fe014edb449dbb172401f1bf8cc423324ec972e305880d2d1a7d243` |

The Windows `BUILD.json` records the checkout-form lock hash because that host
checked out CRLF text. Unix and macOS records use the canonical LF lock hash.
This is a representation difference, not a dependency-input change. The
reusable locked-resolution snapshot is `cargo-resolution.json`, 270,500 bytes,
SHA-256 `54c2bf6ee6db4901423a8c196d79d845e019842fc233b0f348e28b064d1166c2`,
source snapshot commit
`48e26ad57cfdea9782bb91556876e059f9515c2a`. It remains applicable while the
manifest and lock hashes above remain unchanged. The raw target metadata is
261,852 bytes with SHA-256
`fa4c84bd90c80d9b3f2b24cc47a8bc1e721055fa9651f83638d21eaf607a9af6` for
Unix/macOS and 261,356 bytes with SHA-256
`97893e9a0dbed2a11dde3c0ed1b3dd0aa551208ce97b6e274df53d7039de770e` for
Windows.

The lock resolves 66 packages including the local root and 65 source packages.
Target-filtered metadata resolves 64 packages including the root on each Unix
target and 62 on Windows. The five proc-macro packages present on all targets
are `oxc_ast_macros 0.148.0`, `phf_macros 0.14.0`, `rustversion 1.0.23`,
`seq-macro 0.3.6`, and `serde_derive 1.0.229`. Unix-only resolution includes
`errno`, `libc`, `signal-hook`, and `signal-hook-registry`; Windows-only
resolution includes `windows-link` and `windows-sys`. `autocfg` is a build edge
of `num-traits`.

These counts describe the locked source and build inventory. They do not mean
that every listed package is linked into every executable. The native import
tables below are the exact linked operating-system runtime evidence. The
packer labels the 65-entry `BUILD.json` list as
`Cargo.lock source/build inventory; includes proc-macro, build-only, and
target-specific packages and is not an exact linked-runtime subset`.

The source package inventory emitted into each notice is:

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

The notice collector in [`packaging/pack.mjs`](../../packaging/pack.mjs)
collects source packages from locked `cargo metadata`, appends matching root
`LICENSE`, `LICENCE`, `COPYING`, `NOTICE`, and `COPYRIGHT` files, and sorts the
result by package name. The retained policy also:

- keeps the root `COPYRIGHT` and `UNLICENSE` files;
- keeps `unicode-segmentation` and `unicode-width` `COPYRIGHT` files, as
  required by the Unicode attribution they reference;
- keeps the `siphasher` `COPYING` pointer naming the Rust Project Developers
  and Frank Denis, alongside complete canonical MIT and Apache-2.0 text;
- keeps all offered `memchr` license files, including `UNLICENSE`;
- applies the exact pinned Oxc fallback only to Oxc 0.148.0 revision
  `894c8f9cd89508391b01eb26a4b5ac2b846ab39b` and `oxc_index 5.0.0` revision
  `8e09fe324eb6df02f56e4eacdfac958930300380`.

## Rust runtime notice

All five binaries use Rust `1.98.1 (48a229cea 2026-09-01)`, commit
`48a229ceaefd4985c50990b14116b6d856af0985`. The pinned runtime assets are
byte-identical across the five `BUILD.json` records:

| asset | bytes | SHA-256 |
| --- | ---: | --- |
| `COPYRIGHT-library.html` | 1,512,520 | `68129500b616d5838629e68f55ff3aed5e096dacf60ce9eb41bbe599a563afa6` |
| `licenses/Apache-2.0.txt` | 10,280 | `074e6e32c86a4c0ef8b3ed25b721ca23aca83df277cd88106ef7177c354615ff` |
| `licenses/MIT.txt` | 1,078 | `b85dcd3e453d05982552c52b5fc9e0bdd6d23c6f8e844b984a88af32570b0cc0` |
| `licenses/Unicode-3.0.txt` | 1,995 | `f5062c9a188d81dfe66b56db4182dcf9e4b17c0d9b0d311a8e20b3a1b075c443` |
| `licenses/BSD-2-Clause.txt` | 1,267 | `f32fb3b417a194167cfad068223fc975ba96c5960513a10f66a3c28720aec1df` |
| `licenses/LLVM-exception.txt` | 919 | `e34c58338bd89d43e709e226610d8f32b3e3c47f4ad9a99a8dc1d4ac7842488e` |
| `compiler-builtins-LICENSE.txt` | 15,078 | `ab6eec6caf0fa5775e411c7a8bc6a45c4ef2956b0980b157ab74fc5cd62a928b` |
| `compiler-builtins-CREDITS.TXT` | 1,049 | `a9901f47a089da41e4690682d00ce4cedaa2baf41fedbe79beee366d43ac2461` |
| `libm-LICENSE.txt` | 14,088 | `3823dda7cf046602f4b4e77ec8e227863dc4736037cc85bb33d9f19febe16bb7` |

`COPYRIGHT-library.html` is the complete upstream standard-library and
third-party build inventory for this Rust version. It spans multiple targets
and build dependencies; it is not a claim that every entry is linked into all
five executables. The Rust [copyright record](https://raw.githubusercontent.com/rust-lang/rust/48a229ceaefd4985c50990b14116b6d856af0985/COPYRIGHT)
points distributors to this generated file. The compiler-builtins expression
is `MIT AND Apache-2.0 WITH LLVM-exception`, with compiler-rt attribution. The
adjacent compiler-rt credits and libm text preserve the musl, CORE-MATH, and
Jorge Aparicio credits. The fixed source texts are the Rust
[compiler-builtins license](https://raw.githubusercontent.com/rust-lang/rust/48a229ceaefd4985c50990b14116b6d856af0985/library/compiler-builtins/LICENSE.txt)
and [libm license](https://raw.githubusercontent.com/rust-lang/rust/48a229ceaefd4985c50990b14116b6d856af0985/library/compiler-builtins/libm/LICENSE.txt).

The pinned standard-library source selects `fortanix-sgx-abi` only for
`x86_64-fortanix-unknown-sgx` and `r-efi`/`r-efi-alloc` only for UEFI. None of
the five supported targets is SGX or UEFI. The pinned unwind source selects no
extra unwinder for MSVC and uses `gcc_s` on the ordinary non-`crt-static`
Linux GNU path. These source conditions explain why SGX, UEFI, and unrelated
target alternatives are not blanket runtime entries for these packages.

`rustc`, Cargo, LLVM, LLD, Apple clang, the Windows SDK, and host linkers are
build provenance. Their version strings do not show that the tools or their
source are package payloads. The notice follows the pinned asset manifest and
the actual linked or copied components instead.

## Platform runtime boundary

### Linux

Linux x64 imports `libgcc_s.so.1`, `libpthread.so.0`, `libm.so.6`,
`libdl.so.2`, `libc.so.6`, and `ld-linux-x86-64.so.2`; the highest observed
GLIBC symbol is `GLIBC_2.30`, below the packer's 2.31 ceiling. Linux ARM64
imports `libgcc_s.so.1`, `libm.so.6`, and `libc.so.6`; the highest observed
symbol is `GLIBC_2.34`, below the Ubuntu 22.04/GLIBC 2.35 ceiling.

No glibc, libgcc, or other OS shared library is present in either archive. The
x64 Debian `libc6`, `libc6-dev`, and `libgcc-s1` packages are hashed build
sysroot inputs. They are not redistributed files. If a later package copies an
`.so` or sysroot, that copied file needs its own applicable notice and terms.
The [GCC libgcc documentation](https://gcc.gnu.org/onlinedocs/gccint/Libgcc.html)
describes `libgcc_s.so.1`, and the [glibc copying guidance](https://sourceware.org/glibc/manual/2.43/html_node/Copying.html)
describes the terms for glibc and normal operating-system components.

### macOS

Both macOS binaries import `/usr/lib/libSystem.B.dylib` and
`/usr/lib/libiconv.2.dylib`. They use deployment target 15.0 and SDK 15.5.
No dylib is present in either archive. These are OS-provided libraries under
Apple's [system framework documentation](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/OSX_Technology_Overview/SystemFrameworks/SystemFrameworks.html).
If the final package embeds a dylib, inspect and notice that file separately.

### Windows x64 MSVC

The PE is `PE32+`, machine `0x8664`, with `crtStatic=true`. Its imports are
`KERNEL32.dll`, `api-ms-win-core-synch-l1-2-0.dll`, `kernel32.dll`, and
`ntdll.dll`. It has no `MSVCP*.dll` or `VCRUNTIME*.dll` import and the archive
contains no runtime DLL, `.lib`, SDK, or installer. The build uses
`-C target-feature=+crt-static` and `/Brepro`.

The exact retained preflight is Windows Server 2022 build 20348, Visual Studio
2022 Enterprise product `17.14.39`, installation `17.14.37614.0`, MSVC
toolset `14.44.35207`, redist directory `14.44.35112`, compiler and linker
`19.44.35228`/`14.44.35228.0`, and Windows SDK/UCRT `10.0.26100.0`. The
`cl.exe` probe returned status 0. The linker identity was captured with status
1100, so it is provenance evidence rather than an independent successful
linker test.

Rust's [linkage reference](https://doc.rust-lang.org/reference/linkage.html),
[static CRT codegen option](https://doc.rust-lang.org/rustc/codegen-options/),
and Microsoft's [`/MT` runtime documentation](https://learn.microsoft.com/en-us/cpp/build/reference/md-mt-ld-use-run-time-library?view=msvc-170)
explain the static CRT choice. Microsoft documents `/MT` as the multithreaded
static runtime and identifies `LIBCMT.lib` as its linker input. Its [CRT
feature table](https://learn.microsoft.com/en-us/cpp/c-runtime-library/crt-library-features?view=msvc-170)
identifies `libucrt.lib` and `libvcruntime.lib` as statically linked into the
program and `libcmt.lib` as the static CRT startup. Combined with the recorded
`-C target-feature=+crt-static`, `crtStatic=true`, and PE imports, this means
the executable contains linked CRT object code even though no `.lib` is a
package member. The current release binary is a release build.

The present output has no `MSVCP*.dll` or `VCRUNTIME*.dll` import and no VC
runtime DLL, raw library, SDK, or installer in the archive.

### Node launcher boundary

The entry package supplies `bin/seshat.mjs` and selects the native package by
the host platform. Its `optionalDependencies` name all five native packages at
`0.1.0-rc.1`; the native manifests carry their `os`/`cpu` filters and Linux
`glibc` filter. The packages have no third-party JavaScript dependencies,
bundled dependencies, lifecycle scripts, or copied Node binary. Node 24.20.0
is consumer-supplied. The committed manifests and file list match this
boundary. Refresh this check only if the package payload or linked runtime
changes.

## Reproducible audit and extraction commands

These commands use the existing archives and tooling. They do not require a
new audit framework. After downloading each named GitHub artifact, place its
six release archives under `vendor/seshat` using the names below, then verify
the coordinates:

```sh
sha256sum vendor/seshat/*.tgz
tar -tzf vendor/seshat/entry.tgz
for archive in vendor/seshat/linux-x64.tgz \
  vendor/seshat/linux-arm64.tgz vendor/seshat/darwin-x64.tgz \
  vendor/seshat/darwin-arm64.tgz vendor/seshat/win32-x64.tgz; do
  tar -tzf "$archive"
  tar -xOzf "$archive" package/BUILD.json | sha256sum
  tar -xOzf "$archive" package/THIRD_PARTY_NOTICES.txt | sha256sum
done
sha256sum crates/seshat/Cargo.toml crates/seshat/Cargo.lock
```

For dependency revalidation when either normalized source hash changes, use
the locked offline commands that the packer already uses:

```sh
cargo metadata --locked --offline --format-version 1 \
  --manifest-path crates/seshat/Cargo.toml \
  --filter-platform x86_64-unknown-linux-gnu > evidence/linux-x64.metadata.json
cargo metadata --locked --offline --format-version 1 \
  --manifest-path crates/seshat/Cargo.toml \
  --filter-platform aarch64-unknown-linux-gnu > evidence/linux-arm64.metadata.json
cargo metadata --locked --offline --format-version 1 \
  --manifest-path crates/seshat/Cargo.toml \
  --filter-platform x86_64-apple-darwin > evidence/macos-x64.metadata.json
cargo metadata --locked --offline --format-version 1 \
  --manifest-path crates/seshat/Cargo.toml \
  --filter-platform aarch64-apple-darwin > evidence/macos-arm64.metadata.json
cargo metadata --locked --offline --format-version 1 \
  --manifest-path crates/seshat/Cargo.toml \
  --filter-platform x86_64-pc-windows-msvc > evidence/windows-x64.metadata.json
```

Use `readelf -d` and `readelf --version-info` for Linux, `otool -L` and the
deployment load-command inspection for macOS, and the existing PE import and
static-CRT probes on Windows. Use the existing `packaging/pack.mjs` and
`packaging/repeat-pack.mjs` only when a final proof run needs regenerated
outputs. The audit itself compares the resulting archives, extracted members,
and recorded `BUILD.json` fields; it does not treat a source inventory as an
exact link inventory.

## Verified local six-archive install

The previously stale one-entry local-tarball lock concern is resolved for the
retained candidate archives. The verified recipe stages these six exact
release archives as `entry.tgz`, `linux-x64.tgz`, `linux-arm64.tgz`,
`darwin-x64.tgz`, `darwin-arm64.tgz`, and `win32-x64.tgz` under
`vendor/seshat`. It saves the entry as a development dependency and all five
natives as optional local dependencies. Because npm rejects combining the two
save modes, the existing recipe uses two installs followed by a clean offline
install:

```sh
npm install --save-dev --save-exact --ignore-scripts vendor/seshat/entry.tgz
npm install --save-optional --save-exact --ignore-scripts \
  vendor/seshat/linux-x64.tgz vendor/seshat/linux-arm64.tgz \
  vendor/seshat/darwin-x64.tgz vendor/seshat/darwin-arm64.tgz \
  vendor/seshat/win32-x64.tgz
npm ci --ignore-scripts --offline
./node_modules/.bin/seshat --version
./node_modules/.bin/seshat check --config ./seshat.json --json --no-progress
```

The retained `all-real-local` proof reports `npm ci` status 0, installed
version `seshat 0.1.0-rc.1 (candidate)`, and a complete check with four
mutants, three killed, one survived, zero unresolved, and score 75 on Node
24.20.0. The newer all-six-archive local proof passed all four Linux consumer
examples and 11 checks. The five-host local-install matrix remains pending;
that matrix and the hosted native proof runs are separate evidence.

## Remaining acceptance scope

The artifact and notice review is complete for the retained public CI
artifacts. The remaining release-candidate checks are:

1. Run the new native package proof on the integrated head for all five
   targets. The Windows package proof must retain the aggregate timeout and
   phase evidence if it fails again.
2. Run the documented six-archive offline install on each of the five target
   hosts, recording the exact six coordinates from
   [`release-notice-audit.json`](release-notice-audit.json).
3. If source inputs, the package payload, linked runtime, or notice changes,
   refresh the corresponding hashes and this scoped review. Otherwise, keep
   the completed review and current coordinates.
4. Run `git diff --check` and verify the links and hashes in this note and the
   companion JSON.

The old `0.0.0 (candidate)` archives and the earlier clean Linux integration
pack are historical evidence only. They explain prior notice and package
layout decisions; their bytes and hashes are not current `0.1.0-rc.1`
coordinates.
