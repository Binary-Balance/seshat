# Seshat 0.2.0 release audit

Status: the five native package proofs, the Windows runtime proof and the six
archive audit passed. The local install matrix, publisher dry run on `main`,
registry checks and publication remain release gates.

This audit covers the 0.2.0 archives built by the PR 128 workflows from the
merge source
[`d5bbd70867c2e4e5a276f4ce23ad67b8af3e9ef3`](https://github.com/Binary-Balance/seshat/commit/d5bbd70867c2e4e5a276f4ce23ad67b8af3e9ef3)
(`refs/pull/128/merge`). The PR head was
[`2dc97566ad29ed414798abb499e1f87c004d2279`](https://github.com/Binary-Balance/seshat/commit/2dc97566ad29ed414798abb499e1f87c004d2279).
The three audited source trees are `crates`
`8df0781116bd98e88e430aeb060103f590cc2bf4`, `packages`
`b4ed804f1b45f0b49bb91485b2e35abe0ad08dd5` and `packaging`
`2d4b720a08f48227a0efa75b50a382ddf2f95576`. They are identical at the PR head.

The [machine-readable audit](release-notice-audit.json) is the source for every
value in this note. It was generated from the downloaded GitHub Actions
artifacts, which were read and hashed directly; no archive was repacked. The
[0.1.0 audit](../releases/0.1.0-audit.md) and
[0.1.0-rc.1 audit](../releases/0.1.0-rc.1-audit.md) are historical.

## Archive coordinates

Each coordinate names a `.tgz` file in its GitHub Actions artifact. The
artifacts expire on `2027-01-01T11:14:46Z`.

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [37119032646](https://github.com/Binary-Balance/seshat/actions/runs/37119032646), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 954,482 | `199f8dc059915cac3acfa240e913fbc9833e6f7bccbeb58c5d6fb004ef0d2c71` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [37119032632](https://github.com/Binary-Balance/seshat/actions/runs/37119032632), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 900,196 | `4ed46b3a530c410ca8194ce4dea5b40704b148857ac79d31e8cd2f67c2d3e412` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [37119032678](https://github.com/Binary-Balance/seshat/actions/runs/37119032678), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 898,491 | `9342d4d61bf48b8951312eb3529ebacbc1b6e03b5a6fe3750b853da8624b69f8` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [37119032678](https://github.com/Binary-Balance/seshat/actions/runs/37119032678), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 875,423 | `84d24214d94415b453129449c1ec2ce4807b707a1339fea367868a04f040c183` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [37119032658](https://github.com/Binary-Balance/seshat/actions/runs/37119032658), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 913,580 | `d89e3c16c45b0469cc27331128daf3dcfa180f7a876ac51f24f704c03367f2bc` |
| `@binary-balance/seshat` | `universal` entry | [37119032646](https://github.com/Binary-Balance/seshat/actions/runs/37119032646), `linux-x64-package-proof` | `seshat-entry.tgz` | 5,217 | `b4217202b420e9e74ef692722f7d1fd03f1eba56844ddf654c03729ff9defd38` |

The entry archive from the Linux x64 artifact is the one to publish. The Linux
ARM64 and macOS runs produced a byte-identical entry archive. The Windows run
produced the same four member files in a different tarball
(5,219 bytes, `1e737c1fd813cc06332d471c8238e5e7e5c1dafabe688f933b6b6f3f60f5a12c`), which is not published.

## Archive members

The entry archive contains exactly these four members:

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 752 | `11297aa7f5cab9a7313227e745ed302ce73ed60fa44aa0e02b518884732b431b` | `0644` |
| `package/README.md` | 5,710 | `9a48e021a8f044a0608efccaa72d6f0fd1ddeb9a188d703936197cd34c924d71` | `0644` |

Each native archive contains exactly six members under `package/`. `LICENSE`
is 1,074 bytes with SHA-256
`d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` in all five.
`README.md` and the full member list with modes are in the JSON. The other
members are:

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,014,168 bytes, `8f09d5a808eaddf4012373e39e57b5451bc0c0febde746d8d0bd6e6e96b4cbdd`, `0755` | 9,952 bytes, `51eeb3bd1869b81ee23b722135fa6482a46732c9a78b1deb5fd817b2b2c9e134` | 497 bytes, `86b656e2d33df7d829618387cdf24dd063c8c827b6552cdd054998f6d81a225a` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 1,798,864 bytes, `92b8f856472f7293cc9dffb80977827575c5dcbf77f2b7c643f3d4108ca94751`, `0755` | 9,427 bytes, `266c345568e2405c9b26ba97e5b95d237e2eb3783288bc4a49ce052771eec927` | 503 bytes, `ccda52902796448915fcaa5efe7bcc0e42fdfcc4bdf548be6c2b9bbb31fe7af0` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 1,849,920 bytes, `a243d5de3d641b89ee62d5f099c17864a628ab593680b308f8d58a0b58cdebad`, `0755` | 9,385 bytes, `5862fa3e2c176e67860d5d9bef2faf5808eb3beaaee916b4de744f30aa0cf700` | 471 bytes, `c7e90c4815737cb544a29f6d3c091730ff3168e66dceaff3ae4e9e5369db79c1` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 1,805,968 bytes, `de57ea0a371929378a55a538cb20bea4793ce0f0903ad46f9a2b415b7b352fe2`, `0755` | 9,389 bytes, `38ca1f533571eadd9fbfe7a92356211ae9b50a4240c416c689c044e776a4586a` | 477 bytes, `bfbb8f0c420a9639076e1dba194028a61edd9b720f30e41c620af47ad31afc6f` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,028,544 bytes, `f8342a0ba16c644ddc4a8fd13a1de994081fa005a42a6748d8ca04c0379920b9`, `0644` | 10,224 bytes, `6aa2d12c1b8eddd015220366e333f764a5d8297704b73024a63f5c5420c0cf73` | 472 bytes, `8b0c73ab30b01e2d9eabfbfa36ffbbbcb939a579c984aece26727b94973ec0d1` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

For each target, the binary hash in `BUILD.json`, the hash in the workflow's
`summary.json` and the hash of the member extracted from the release archive
are the same.

## Dependencies and notices

Compared with the published 0.1.0 Linux x64 archive:

- The dependency list in `BUILD.json` is identical: 65 locked packages.
- The Rust toolchain is the same: `rustc 1.98.1 (48a229cea 2026-09-01)`.
- The nine Rust runtime notice source files are identical. Their review is in
  the [0.1.0 audit](../releases/0.1.0-audit.md#runtime-boundaries-and-notices).
- `THIRD_PARTY_NOTICES.txt` gained one paragraph, attributing Windows launch
  argument and path handling adapted from Rust 1.98.1.

The notice file is now byte-identical on all five targets: 2,057,917 bytes,
SHA-256 `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8`. In 0.1.0 the Windows copy had different line endings.

`Cargo.lock` differs from 0.1.0 only in the root package version. All five
build records give its SHA-256 as
`610b44af7b009d6e66eacc9fa6c0b79c56af892ba4e5320f5e6f8884605c9f96`.

## Proof results

All five package workflows passed on the PR head, and each `summary.json`
reports `validation.passed: true` for source commit `d5bbd70867c2`.
The builds and baseline checks used Node 24.20.0.

The Windows runtime run [37119032649](https://github.com/Binary-Balance/seshat/actions/runs/37119032649)
passed its six scenarios: baseline, timeout, overflow, leader exit, repeat
leader exit and console cancellation. It builds its own binary
(`954c6bf0188d200fca6a1664cd1c8d5a3f81590a4b8f9bd01996f1f79104d5f7`), which is not the published Windows binary.

## Checks run on this audit

```sh
node benchmarks/proofs/release-local-archive-stager.mjs \
  --manifest docs/research/release-notice-audit.json \
  --output work/npm-publishing/archives \
  --evidence work/npm-publishing/archive-staging.json
node benchmarks/proofs/npm-publishing.mjs \
  --manifest docs/research/release-notice-audit.json \
  --archives work/npm-publishing/archives \
  --staging-evidence work/npm-publishing/archive-staging.json \
  --revision <sha> --version 0.2.0 \
  --report work/npm-publishing/dry-run.json
```

The stager downloaded the six archives again, matched every size and SHA-256
to this audit and confirmed the three source trees match the checkout. The
publisher dry run against the PR head passed with tag `latest`.

## Remaining release gates

- Run the release local install workflow on all five targets.
- Run the publisher dry run from the reviewed `main` commit.
- After publication, verify the six registry versions, tarball bytes and
  provenance against this audit.
- Create the GitHub release with the six audited archives.

This audit does not claim a local install matrix result, a registry result or
publication.
