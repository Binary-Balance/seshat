# Seshat 0.1.0 release notice and archive audit

Status: the five native package proofs, Windows runtime proof and six canonical
archive audit passed. The local six-archive consumer matrix, publisher dry run,
public registry checks and publication remain release gates.

This audit covers the 0.1.0 candidate built from PR50's synthetic merge source
[`e1b91b39a8aa0fcbfb3d4ca6089de8b416ee61c7`](https://github.com/Binary-Balance/seshat/commit/e1b91b39a8aa0fcbfb3d4ca6089de8b416ee61c7).
The workflow runs were dispatched at direct PR head
[`cf236285b2847d23593c24791d4742d20d7c7563`](https://github.com/Binary-Balance/seshat/commit/cf236285b2847d23593c24791d4742d20d7c7563).
The three audited source trees are `crates`
`d49aa0c0c90870c261b2b97241aaed94912db7a1`, `packages`
`f96ac4792a59d04f6144f4fd707b7cd3674db79d`, and `packaging`
`39712dab851a10491c3869f9988a7c12d72e10ec`.

The [machine-readable audit](release-notice-audit.json) is the source for all
run, artifact, archive, member, build and raw-report coordinates in this note.
Its paths are relative to the retained evidence root
`work/release-0.1.0`; runner-specific absolute paths are omitted. The old
[0.1.0-rc.1 audit](../releases/0.1.0-rc.1-audit.md) and
[machine-readable rc.1 record](../releases/0.1.0-rc.1-audit.json) remain
historical and are not reattributed to this candidate.

## Canonical archive coordinates

Each coordinate below names a direct `.tgz` member in its downloaded GitHub
Actions artifact. The entry archive is canonical from the Linux x64 artifact
because its launcher member is executable. It is the only universal entry
coordinate; the five host-produced entry archives are recorded as variants in
the JSON. The native coordinates name the release archive, not the ordinary or
standalone proof archive.

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [34930424788](https://github.com/Binary-Balance/seshat/actions/runs/34930424788), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 948,121 | `6898244abba370d6a62c533c3a5abe3817988062e56f6aea05f2f0f6a3e3cf28` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [34930424853](https://github.com/Binary-Balance/seshat/actions/runs/34930424853), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 906,714 | `4ffaf49a692c96d27660eb0ba2a0a69c4c3ebdb138d30dd1df18de8efc95f989` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [34930424782](https://github.com/Binary-Balance/seshat/actions/runs/34930424782), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 902,040 | `2cec1cc1a2a5afbfe10d4c57be1d9b766b956e99c8938f5027446b640326d7da` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [34930424782](https://github.com/Binary-Balance/seshat/actions/runs/34930424782), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 881,858 | `19257b84e36cd11688e0be5044a1a2336b978a2798d9203a05aeb4833132a3ab` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [34930424839](https://github.com/Binary-Balance/seshat/actions/runs/34930424839), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 924,369 | `4d4093bc60968d5788ff9b5dd56b62c446070d4ae0e90f15a8a89651729b57a1` |
| `@binary-balance/seshat` | `universal` entry | [34930424788](https://github.com/Binary-Balance/seshat/actions/runs/34930424788), `linux-x64-package-proof` | `seshat-entry.tgz` | 4,065 | `91ce080e4a03e309755f6f3f92222230c30e059ef0158e7f0757d08303179afd` |

The JSON repeats each coordinate with `canonical: true`, package and version,
run ID, artifact name, direct `archivePath` and `archiveFile`, archive bytes
and SHA-256, and `buildProvenance.sourceCommit`. It also records the job URL,
artifact ID, artifact API URL, artifact digest, creation time and expiry.
GitHub's retained artifact metadata reports `expired: false` for all five
groups; the common expiry is `2026-12-14T04:51:18Z`.

## Archive member audit

The canonical entry archive contains exactly these four members:

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/README.md` | 3,489 | `22c5a1217a51614893638e29d6e495f9f6a4593d811b4e7054465f4b0d54235b` | `0644` |
| `package/bin/seshat.mjs` | 4,753 | `ca5dc2340a31061246cb725574aaedb281c6b9ceee63373165302dd1fcfaf613` | `0755` |
| `package/package.json` | 746 | `ad656684378c0f241b2b0dc27f40dedda409f00297621afe1927dba002ef18c3` | `0644` |

The Unix and macOS entry archives have the same four member bytes and are 4,065
bytes with the canonical hash. The Windows entry archive has the same member
bytes but is a separate 4,058-byte host-produced tarball; it is not a second
universal coordinate.

Each native release archive contains exactly six members under `package/`.
All native LICENSE members are 1,074 bytes with SHA-256
`d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` and mode
`0644`. The remaining member records are:

| target | binary member | `BUILD.json` | README | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,026,432 bytes, `031dfc5c8696c2ed0a236867d4c93ceef7047f477fab45f19f65b2577908a151`, `0755` | 9,952 bytes, `c5e9ee7b81819b306c4ec228a75b34ff575cf712780e56e87644e3d322c60db0` | 144 bytes, `209e4fd0564a09c6cbb0c67a93d32f72cd1e5c87a8129a05dc579b21861f96ed` | 2,057,665 bytes, `49ebba598a25d26340cf836ea7dfcaa58ed7a279cefe32b9e63bf7aafb52c5d5` |
| `linux-arm64` | `package/bin/seshat`, 1,815,248 bytes, `f34e8114a43148bc9b5e61e57b73ec73c68453a250704ca0eeb4b0377f6ec8c6`, `0755` | 9,427 bytes, `5c7cf921d4af7030025d51073919f9ec479fc9219e5bcaf140a0d9d6fc9840f0` | 146 bytes, `cd3609cef8f447be21219d27fc540694cf4d27583baae56e5ce9bfe6e9c28af8` | 2,057,665 bytes, `49ebba598a25d26340cf836ea7dfcaa58ed7a279cefe32b9e63bf7aafb52c5d5` |
| `darwin-x64` | `package/bin/seshat`, 1,867,200 bytes, `c7b2b829af04e6e5e3ed68426ff82ebc9156c1ef6717b99c889c618fdcf27a9a`, `0755` | 9,385 bytes, `a263d5c95f88bf4d3cd976d7250a4e1b79b8869d01ad15aef460c4ed13e64619` | 145 bytes, `aaad95b6b8374aa9b330b2f5d165bc1909719d4df04961fa1dc5cc5f91dd15d8` | 2,057,665 bytes, `49ebba598a25d26340cf836ea7dfcaa58ed7a279cefe32b9e63bf7aafb52c5d5` |
| `darwin-arm64` | `package/bin/seshat`, 1,823,360 bytes, `dbcd21aa52265ca54cc55ee64d15c52da8073ebc975eb6e47723fd7bf5359599`, `0755` | 9,389 bytes, `57a4cf243cfd7d62359613a4f5cbb9e82cfc10903eb9dd451983882d8a3586e6` | 147 bytes, `b88e82affa32d7107dcbafc759ea56b307fe2183793781e25c8ff63f6f61e0e0` | 2,057,665 bytes, `49ebba598a25d26340cf836ea7dfcaa58ed7a279cefe32b9e63bf7aafb52c5d5` |
| `win32-x64` | `package/bin/seshat.exe`, 2,066,944 bytes, `2accb4b57c02c24c34729174005987215136d3fb7f0eec6d49ba8d1a28269fa7`, `0644` | 10,224 bytes, `d6b28241124052fc1e179c56241bf74c14613c47b38b4be111fdfd626395cf17` | 144 bytes, `de83b9d3175643138b5cb0e73e7832d2d8696d93706646745696c7196feb773b` | 2,057,973 bytes, `95b852e45022f73d8986918edcea6a1ab3af5d47946f8e530007daa801365376` |

The JSON retains the full member list, including package manifests and member
modes, for every archive. The native binary hashes above are extracted from
the corresponding release tarballs, not inferred from an ordinary or
standalone package.

## Package metadata and launcher boundary

The entry `package.json` is exactly:

```json
{
  "name": "@binary-balance/seshat",
  "version": "0.1.0",
  "description": "A native CLI for TypeScript and TSX complexity analysis and mutation testing.",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Binary-Balance/seshat.git"
  },
  "type": "module",
  "engines": { "node": "24.20.0" },
  "bin": { "seshat": "bin/seshat.mjs" },
  "files": ["bin/seshat.mjs", "README.md", "LICENSE"],
  "optionalDependencies": {
    "@binary-balance/seshat-linux-x64": "0.1.0",
    "@binary-balance/seshat-linux-arm64": "0.1.0",
    "@binary-balance/seshat-darwin-x64": "0.1.0",
    "@binary-balance/seshat-darwin-arm64": "0.1.0",
    "@binary-balance/seshat-win32-x64": "0.1.0"
  }
}
```

Each native manifest has the same MIT license, repository, Node engine and
file list (`bin/seshat` on Unix-like targets and `bin/seshat.exe` on Windows),
with its exact target description and platform filters:

| target | `os` | `cpu` | `libc` |
| --- | --- | --- | --- |
| `linux-x64` | `linux` | `x64` | `glibc` |
| `linux-arm64` | `linux` | `arm64` | `glibc` |
| `darwin-x64` | `darwin` | `x64` | absent |
| `darwin-arm64` | `darwin` | `arm64` | absent |
| `win32-x64` | `win32` | `x64` | absent |

The audited entry has no third-party JavaScript dependencies, bundled
dependencies or lifecycle scripts. The launcher supplies the `seshat` command,
selects the host package and forwards arguments, output and status. Node is
consumer-supplied; no Node binary is in any archive.

## Build, source and dependency review

The source comparison used the retained 0.1.0-rc.1 baseline at main
`6446c28` and the fresh build source `e1b91b39a8aa0fcbfb3d4ca6089de8b416ee61c7`.
The exact source inputs are recorded in the JSON with their source commit,
bytes and SHA-256. The comparison found only the package version change in
`crates/seshat/Cargo.toml` and the local package version change in
`crates/seshat/Cargo.lock`; dependency declarations and locked dependency
records are unchanged. The baseline already contains the repository metadata,
descriptions and README changes from PRs 48/49, and `packaging/release.mjs`
generates the release manifests. PR 50 changes `packaging/pack.mjs` only by
removing the candidate suffix from its version assertion; fresh package
members were audited from the new archives.

The lock contains 66 packages including the local root and 65 source/build
packages. All five `BUILD.json` dependency arrays contain the same 65 entries
and inventory SHA-256
`cf6bb036d02042dc3e4bf1909d2c9923b62a5d1f11db889107232a181d41e1d9`. The
inventory includes proc-macro, build-only and target-specific packages; it is
not an exact linked-runtime subset. The Unix and macOS build records use lock
SHA-256 `3e06c061bc4b7535aa27ece96e379ee57eadff5f9cc31c6fde12e18201d3ddbb`.
The Windows checkout records CRLF lock bytes as
`c331c5a33a3179fddf6db5b94203bbf99eaa66c183fde7ee349539e7451f1665`; its
normalized dependency content is the same.

All five builds identify Rust `1.98.1 (48a229cea 2026-09-01)` with Rust commit
`48a229ceaefd4985c50990b14116b6d856af0985`. The native target, linked-library
inspection, compiler, SDK, CRT and glibc evidence is retained in each
`BUILD.json` record and summarized below.

## Runtime boundaries and notices

| target | preflight | native boundary |
| --- | --- | --- |
| `linux-x64` | `ubuntu-22.04`, Ubuntu 22.04.5, glibc 2.35, kernel `6.8.0-1064-azure` | `x86_64-unknown-linux-gnu`; highest observed GLIBC symbol `2.30`, compatibility proof at Debian 11/glibc 2.31; imports `libgcc_s.so.1`, `libpthread.so.0`, `libm.so.6`, `libdl.so.2`, `libc.so.6`, `ld-linux-x86-64.so.2` |
| `linux-arm64` | `ubuntu-22.04-arm`, Ubuntu 22.04.5, glibc 2.35, kernel `6.8.0-1064-azure` | `aarch64-unknown-linux-gnu`; highest observed GLIBC symbol `2.34` on the glibc 2.35 host; imports `libgcc_s.so.1`, `libm.so.6`, `libc.so.6` |
| `darwin-x64` | `macos-15-intel`, macOS 15.7.9, native x86_64, Rosetta false | `x86_64-apple-darwin`; Mach-O x86_64, deployment target 15.0, SDK 15.5; imports `/usr/lib/libiconv.2.dylib` and `/usr/lib/libSystem.B.dylib` |
| `darwin-arm64` | `macos-15`, macOS 15.7.9, native arm64, Rosetta false | `aarch64-apple-darwin`; Mach-O arm64, deployment target 15.0, SDK 15.5; imports `/usr/lib/libiconv.2.dylib` and `/usr/lib/libSystem.B.dylib` |
| `win32-x64` | `windows-2022`, Windows Server 2022 build 20348, native x64 | `x86_64-pc-windows-msvc`; PE32+ machine `0x8664`, static CRT, `/Brepro`; imports `KERNEL32.dll`, `api-ms-win-core-synch-l1-2-0.dll`, `kernel32.dll`, `ntdll.dll` |

No glibc, dylib, Windows runtime DLL, SDK file, installer or raw shared
library is present in the native archives. The Windows preflight retained
Visual Studio 2022 Enterprise `17.14.39`, MSVC `19.44.35228`, linker
`14.44.35228.0`, and Windows SDK/UCRT `10.0.26100.0`. These versions are build
provenance, not package payload.

The native notice member is generated from the pinned Rust runtime notice
directory `packaging/runtime-notices/rust-1.98.1` and Rust commit
`48a229ceaefd4985c50990b14116b6d856af0985`. The nine retained source assets
and exact hashes are in `rustRuntimeNotice.assets` in the JSON. The key
records are:

| notice asset | bytes | SHA-256 |
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

Unix and macOS notices are 2,057,665 raw bytes with SHA-256
`49ebba598a25d26340cf836ea7dfcaa58ed7a279cefe32b9e63bf7aafb52c5d5`.
Windows is 2,057,973 raw bytes with SHA-256
`95b852e45022f73d8986918edcea6a1ab3af5d47946f8e530007daa801365376`.
After line-ending normalization, all five notices are 2,057,445 bytes with
SHA-256 `1ee76ac60d64ffbde5db8f75d8b097916e1d907854408b4aaa5617546c0840bd`.

## Fresh proof results

All five `summary.json` records report `validation.passed: true`, no failures,
and source commit `e1b91b39a8aa0fcbfb3d4ca6089de8b416ee61c7`. The repeat-pack
reports passed for binary, build record, npm archive and standalone archive
byte/hash comparisons across two clean packer invocations. This is
reproducibility evidence for those proof outputs; the canonical release
archives above were independently read and hashed from the retained artifacts.

The proof scope is summarized below. Every report path, raw byte count and
SHA-256 is retained in the JSON `rawEvidence.files` list.

| proof | result on each native target |
| --- | --- |
| npm package proof | passed; 14 checks on Unix/macOS and 16 on Windows |
| standalone and installed CLI | passed; 43 CLI scenarios and 11 parallel controls on Unix/macOS; Windows shared reports retain the same counts |
| public consumer examples | passed for Node, Jest/Expo, Vitest and workspaces; equality, failure and incomplete threshold states were exercised |
| Jest/Expo integration | 4 requested cases completed |
| Vitest integration | 4 requested cases completed |
| lifecycle | 11 cases passed on Unix/macOS; the Windows runtime record covers its native cancellation and lifecycle scenarios |
| Linux x64 Debian 11 proof | passed with glibc 2.31 and the isolated CLI checks |

The Windows runtime run [34930424803](https://github.com/Binary-Balance/seshat/actions/runs/34930424803)
and retained `windows-runtime-cli-evidence.json` passed on Windows Server 2022
build 20348. Its six scenarios are baseline, timeout, overflow, leader exit,
repeat leader exit and console cancellation. The runtime binary hash is the
same `2accb4b57c02c24c34729174005987215136d3fb7f0eec6d49ba8d1a28269fa7`
binary recorded in the Windows release archive.

The README fixture proof for issue #46 used the native binary extracted from
the canonical Linux x64 release archive. Its retained reports record
`seshat 0.1.0`, exit status 0, complete mutation, 2 planned, 2 killed, 0
survived, 0 unresolved and score 100. The binary SHA-256 is
`031dfc5c8696c2ed0a236867d4c93ceef7047f477fab45f19f65b2577908a151`.
This is direct native invocation evidence from the README fixture; it does not
establish a registry installation or the npm shim route.

## Raw evidence and review commands

The retained input records are `build-runs.json`, `build-source-ref.json`,
`native-runs.json`, `windows-runtime-run.json`, `readme-example.json` and
`readme-example-summary.json`. The JSON records each file's portable path,
bytes, SHA-256 and role. It also records every retained target `.json` report
and `.log` file without copying their full contents into the repository.

The audit used the existing archive and proof tools. The essential checks are:

```sh
jq empty docs/research/release-notice-audit.json
git rev-parse HEAD:crates HEAD:packages HEAD:packaging
git diff --check
tar -tzf seshat-entry.tgz
tar -tzf seshat-linux-x64-release.tgz
sha256sum seshat-entry.tgz seshat-*-release.tgz
```

The archive reads were performed directly against the retained GitHub
artifact files. No canonical archive was repacked. The existing read-only
stager and publisher verifier remain the consumers for the next release
steps; they enforce the direct archive basenames, six-coordinate schema,
source-tree equivalence and archive hashes.

## Remaining release gates

- Run the local six-archive install matrix on Linux x64/ARM64, macOS x64/ARM64
  and Windows x64, and retain its staging and verifier reports.
- Run the read-only publisher dry run against these six staged archives and
  the reviewed revision.
- After publication, compare all six public registry versions, tarball bytes,
  signatures and `https://slsa.dev/provenance/v1` attestations with this audit.
- Create or update the matching GitHub release with the six audited archives
  after the registry checks pass.

The current audit does not claim a local matrix result, registry result,
publisher write, GitHub release or public package publication.
