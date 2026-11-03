# 0.12.0 release notice audit

Captured 2026-11-03. Native audit complete; local install and publication checks remain.

Build source [5c493ef546ad9845ba3a1670be9f2b87f6ca7bc9](https://github.com/Binary-Balance/seshat/commit/5c493ef546ad9845ba3a1670be9f2b87f6ca7bc9), ref `refs/pull/256/merge`.

Reviewed head [a311b2fdac98c844e9af9b4b9889ccb3ff1955d6](https://github.com/Binary-Balance/seshat/commit/a311b2fdac98c844e9af9b4b9889ccb3ff1955d6), [pull request](https://github.com/Binary-Balance/seshat/pull/256).

| source directory | Git tree |
| --- | --- |
| `crates` | `a4047c963a2426cb964a6763c5e2d9413afbc371` |
| `packages` | `f0def6505038c2cd06697bc668f48021160c48c3` |
| `packaging` | `d8acfc43aa5706baeb2c8b9c8a613b629f3cae14` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [41563731109](https://github.com/Binary-Balance/seshat/actions/runs/41563731109), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,128,624 | `1a4008621f2b543cc6c18b5485e60cc2d859bbe5b11c0a458592248904289e36` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [41563731058](https://github.com/Binary-Balance/seshat/actions/runs/41563731058), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 1,062,399 | `24c36c06178127fa254b343eaf2c07e9fb4164674b9c1dbd01eb734d570fcee8` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [41563730896](https://github.com/Binary-Balance/seshat/actions/runs/41563730896), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 1,065,114 | `f5fd0c0a67b4e1cb3f63e44551f60c2b6c126170231db4ba836ef3b76f0d0a66` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [41563730896](https://github.com/Binary-Balance/seshat/actions/runs/41563730896), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 1,032,321 | `3b237e044ae33b0d33076de4ad3fda2339969ba019ce1bad30b753a1f6d544fa` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [41563730938](https://github.com/Binary-Balance/seshat/actions/runs/41563730938), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,086,618 | `7c8938cc5ea7ba1b4078cd2f438b1ab9ab59c4e7238fc0e2470049a1a2d314ae` |
| `@binary-balance/seshat` | `universal` | [41563731109](https://github.com/Binary-Balance/seshat/actions/runs/41563731109), `linux-x64-package-proof` | `seshat-entry.tgz` | 6,077 | `2baf310a33443e714a7cabda465ad1a34dd688099d14c6c938cccb204b22fe91` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 758 | `2631faf47cacf7b3881a7cfe476a0759b3d350270dc484717be485c2527ecb86` | `0644` |
| `package/README.md` | 7,857 | `2affbcb637e93a915da66535fce33c8f0586f2b957d9bf2c27bf4a83984afab4` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,451,632 bytes, `0ff4d47361336d7dd65a28bdd69bdc367bc9e73db34df3d8d3987ceaba082de7`, `0755` | 9,953 bytes, `ffc1f5011d8cd2c9923d6136de69e6d9eeb3747ed34890894d6938629b9c3725` | 498 bytes, `8c20e832fee0ec2c72dadb64154d4342f256ae66828ccc1ec86a506590e478b8` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 2,175,696 bytes, `926ae9820bf37ade955a1caf26ff72132642af9e22f0c022cd127e97c608f80b`, `0755` | 9,428 bytes, `ef7cc9eaa85f882ab1e59f0015fb8839533a8ce677837f34a3430f40d3c206fe` | 504 bytes, `ae41bdcc9d178ed9f9e6445d657813dfc0d4687bb56645643ce95d99c7b8aec0` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,264,328 bytes, `6feea2b20d6b409ff117b9ae201f8a4794a896f6e126b041195463a90b5f2810`, `0755` | 9,386 bytes, `4a94869ffaa9805b418ef02b23fec248ae3035d2f92d756c65fc6c8152d0b7ce` | 472 bytes, `62f74f21af80e855552a92d1fe886cfa1d03c835e6eb8e64b9b5dd6b1a08f471` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 2,157,472 bytes, `235418b7ab704f92b8df293a9510400eab5a8fab41bb4c6ff7e4ec19879223ab`, `0755` | 9,390 bytes, `c295ce17d762a3b9332acd6368bc3617ebe2a08f063a70a58bf29d9656f6fb02` | 478 bytes, `9431e311f442581203b2585663f0e686edee7cced1436c57a06df1ade0a0cdc2` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,569,216 bytes, `f21672b34abf400a11af3d1e8ab8c4fd5d39444b5e16d1c1afdbc59824801f28`, `0644` | 10,225 bytes, `7c461c2d513cbe220278c1e34a2ad44f6a856c4cfd216703cf0562c608802173` | 473 bytes, `6b92db49499ad5c6f562c2fe5527e77a25a3ec054a86f57f18077daf5449b0e6` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.11.0`.

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

[Run 41563731038](https://github.com/Binary-Balance/seshat/actions/runs/41563731038) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.
