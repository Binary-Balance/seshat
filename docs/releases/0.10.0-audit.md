# 0.10.0 release notice audit

Captured 2026-10-26. Native audit complete; local install and publication checks remain.

Build source [a1aa63b0f46ad0a2c9c486feb5eba27af221b5fe](https://github.com/Binary-Balance/seshat/commit/a1aa63b0f46ad0a2c9c486feb5eba27af221b5fe), ref `refs/pull/236/merge`.

Reviewed head [de3f53a9ec0231e942ef545174ffbd1a6e49f573](https://github.com/Binary-Balance/seshat/commit/de3f53a9ec0231e942ef545174ffbd1a6e49f573), [pull request](https://github.com/Binary-Balance/seshat/pull/236).

| source directory | Git tree |
| --- | --- |
| `crates` | `7be18faf8851217439f522bddd33c9857b7060cd` |
| `packages` | `f0def6505038c2cd06697bc668f48021160c48c3` |
| `packaging` | `3e7b2adf4aae5ae182b15ec4b6574f7fcce7b10b` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [40416308408](https://github.com/Binary-Balance/seshat/actions/runs/40416308408), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,103,051 | `29296db193ac6c421bb6d1e81f51261c2f56de36532105640b0fd243454e0ab6` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [40416308416](https://github.com/Binary-Balance/seshat/actions/runs/40416308416), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 1,038,308 | `871cd9a795b7749e5e0a978dfdfa7a584554f807ad1b04813857a7d06fec2546` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [40416308390](https://github.com/Binary-Balance/seshat/actions/runs/40416308390), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 1,042,331 | `da767ec3340989a1f7c70731a950e4cc86682249619817ab6318d57cafec86ff` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [40416308390](https://github.com/Binary-Balance/seshat/actions/runs/40416308390), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 1,009,491 | `ae9173b6b9962a5f54fda3ef86bcedc7e161bfd840ee9620609fd862033c6325` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [40416308384](https://github.com/Binary-Balance/seshat/actions/runs/40416308384), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,063,854 | `2be17f112e8a61136ba726f8456b1d7d05d4e2012934e7c946d3cf02e8195f87` |
| `@binary-balance/seshat` | `universal` | [40416308408](https://github.com/Binary-Balance/seshat/actions/runs/40416308408), `linux-x64-package-proof` | `seshat-entry.tgz` | 6,077 | `ff7732378226c10441dc708cced27ebc8b4fa34fd6c59f85c501cd8b9cd09c46` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 758 | `b0c19b472312632a773d38e078f2a56e79f99d98e5e7ec804ffce8c0c8d6c05d` | `0644` |
| `package/README.md` | 7,857 | `2affbcb637e93a915da66535fce33c8f0586f2b957d9bf2c27bf4a83984afab4` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,391,392 bytes, `540aedf7d75bb68d990cd7c9ee34a6e50ea4bc8e52dc1816eb25822789e44e71`, `0755` | 9,953 bytes, `982f81f87d8ff0c1698b66875f2bc6606019d6e4dcb1e4b75f52a06f6cb812b9` | 498 bytes, `e60066d09bf3e88da63c1719e517641b452d7b9a70e7ff70b2f7b1fc1088a5b9` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 2,122,448 bytes, `22072c44acd2ed2d93925cc515d47bff0c4bdf865a88b001b3902f630de46867`, `0755` | 9,428 bytes, `465e2abcfc3b403f603e471768496888c85419f44421745c077cae5cae80fafa` | 504 bytes, `b87016133eb326fa4b9c4b8fc95bfb2049c3d8762a049a81761578e16b84bd72` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,206,728 bytes, `6ba7db366dab9c8f096c3cb1a1deae94012449ce2071681b53189c9de173cc74`, `0755` | 9,386 bytes, `d6ad70b51b1f776c1c6c3a2c74118ed4beda66b50645a6799e3bea00bdc037a7` | 472 bytes, `7afdb4791da84f9922847c0ad5ad43548d5da9e2239a61a336a195cd6de6e9a9` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 2,107,680 bytes, `95cde94305a41b7471afcf8a40b975be9370e3bd528953c7b355780e5a365149`, `0755` | 9,390 bytes, `577fa868d7743d26be223612f299cd119a9fef34a4c57fcfe00a44a2c87bb643` | 478 bytes, `80b46a54defc61419f0ea3b0f7f721211ff15895821d927f8ec594cf8394a0c4` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,496,512 bytes, `8b823557a0db9f0623e3539a088847ccce7f567dcb551c3f590f041f4b4bbb69`, `0644` | 10,225 bytes, `c5e3a8157d74b42f2ae10f0617b808e95a3cb395433061dc70125510bce378d6` | 473 bytes, `61da0faae24c89ee296ea098c03d3ac418eab92b21c3fec6828e68a355135180` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.9.0`.

| check | matches previous release |
| --- | --- |
| Dependency inventory | true |
| Runtime notice assets | true |
| Rust toolchain | true |

Notice bytes and SHA-256 match the previous release.

| item | added | removed | changed |
| --- | ---: | ---: | ---: |
| Dependencies | 0 | 0 | 0 |
| Runtime notice assets | 0 | 0 | 0 |

Rust toolchain: `rustc 1.98.1 (48a229cea 2026-09-01)` → `rustc 1.98.1 (48a229cea 2026-09-01)`.

## Windows runtime

[Run 40416308383](https://github.com/Binary-Balance/seshat/actions/runs/40416308383) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.
