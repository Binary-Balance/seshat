# 0.17.0 release notice audit

Captured 2026-11-10. Native audit complete; local install and publication checks remain.

Build source [72c5c087b8a7debe32378156929ff72fdd1161ba](https://github.com/Binary-Balance/seshat/commit/72c5c087b8a7debe32378156929ff72fdd1161ba), ref `refs/pull/290/merge`.

Reviewed head [217a29315bf2b3460bbcb940ca707394387ca58a](https://github.com/Binary-Balance/seshat/commit/217a29315bf2b3460bbcb940ca707394387ca58a), [pull request](https://github.com/Binary-Balance/seshat/pull/290).

| source directory | Git tree |
| --- | --- |
| `crates` | `3bbe803eb6f918d3944ebff012204c608c72811e` |
| `packages` | `08505951dbc64b93d768fac6af6e874dbd650b97` |
| `packaging` | `e7c15a93b2377a5af09943ed84fd1d858dc6df2a` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [42753276996](https://github.com/Binary-Balance/seshat/actions/runs/42753276996), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,177,301 | `257e89dd807dd0ffe680a16ea0b4cfa74a06ecdfa9e93f95a7c4dc3821902bef` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [42753277012](https://github.com/Binary-Balance/seshat/actions/runs/42753277012), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 1,106,505 | `2c2476ac99354c21b987d56b7dd5c5fd8cead6ded239d8e6271cb45328d69000` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [42753277002](https://github.com/Binary-Balance/seshat/actions/runs/42753277002), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 1,114,280 | `527b1a8e6e3093065b3c10a6081af8fffdcfe1b99fcac06a6b8ba708be4625c8` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [42753277002](https://github.com/Binary-Balance/seshat/actions/runs/42753277002), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 1,077,507 | `2510136b16042aba46b1fb5220046b6e58d155068558d0681cd09dd98a0698ae` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [42753277310](https://github.com/Binary-Balance/seshat/actions/runs/42753277310), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,142,416 | `f67a28915f267138e94f9368066875513318820338b4f3ae4daecbb1d91abe47` |
| `@binary-balance/seshat` | `universal` | [42753276996](https://github.com/Binary-Balance/seshat/actions/runs/42753276996), `linux-x64-package-proof` | `seshat-entry.tgz` | 6,465 | `e6ac6dfe9b0e45e755a2b9488d43f8cde0f90764b609a2586889c1008f403462` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 758 | `63b500b866d4004423dd44575562771f362a6eae428af24ceabafb9496b6f2c6` | `0644` |
| `package/README.md` | 8,953 | `412542f3875a5266c404417f572ae7a8a43c97d70a10c47e23ecfa2c826e7a80` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,577,744 bytes, `d1da9cbd27438f5daf11a7fb1f626d6ee93bd3c7d62e8fd307c0b5a4ae919cfe`, `0755` | 9,953 bytes, `3efd870ff5d77b05230ac695eda755ba71f755cb19cefa68d155ec775d27fb92` | 498 bytes, `91b62977a554510f67a9da91465cbfc56e12a529b6d7ed9aa34839d76e968652` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 2,286,288 bytes, `640795e32a32e3d5982f57a69024409c022c27a970b663671d2a4c3bb7304bfa`, `0755` | 9,428 bytes, `22a60b07c98fa90df5174685007a1c13c07fe10f01f792165471a95b4d0fcc69` | 504 bytes, `551b4d74a73cb83842d2e31bd650c10fe51153b6c23a435429afe71ffc693449` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,383,608 bytes, `1e871e5f7889420ce385eb4f6ea101958397a9048620980f2fd40b070fefc4fa`, `0755` | 9,386 bytes, `f37614d8a103279a2a2b106d1417228a2c27c4dc3e01fb384c8d6582bb68e30b` | 472 bytes, `2ffe6d380c4876afe889c2886f82eef8c04c9bede3b7bffe3f18b38fe18897cc` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 2,273,536 bytes, `9b20573d638013b7bb99264c49251d6310d6d5b7b76bad40a4a8f495d52d690b`, `0755` | 9,390 bytes, `0a9cfd651d94ff9ee8de78c1a442510ef3d92b803962fafda5c41cb015a97256` | 478 bytes, `0d467210793ba016b0f78b6f17a7aef6e28cba84aef727476d8969ac1cc94457` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,718,720 bytes, `deeb4353d26320976ddca633d3bc8fe6487f9e623688858a1f983d0d3660f5c8`, `0644` | 10,225 bytes, `6208494552246261785f9eb65cca210af49ea325d7951fd31765303441208171` | 473 bytes, `0eb3e277b530fcfe0bd9d6384e5342a0caa79a315377695b81fb4e2672e52e23` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.16.0`.

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

[Run 42753277247](https://github.com/Binary-Balance/seshat/actions/runs/42753277247) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.
