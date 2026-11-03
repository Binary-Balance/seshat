# 0.11.0 release notice audit

Captured 2026-10-31. Native audit complete; local install and publication checks remain.

Build source [3ef595e55507104fb53ad5913800dd504429d120](https://github.com/Binary-Balance/seshat/commit/3ef595e55507104fb53ad5913800dd504429d120), ref `refs/pull/250/merge`.

Reviewed head [394afba477bb974f0fb74103186a22d0644f0eef](https://github.com/Binary-Balance/seshat/commit/394afba477bb974f0fb74103186a22d0644f0eef), [pull request](https://github.com/Binary-Balance/seshat/pull/250).

| source directory | Git tree |
| --- | --- |
| `crates` | `5f485b1a7a19bc1a00afaa8720b1c079b6a4a3d9` |
| `packages` | `f0def6505038c2cd06697bc668f48021160c48c3` |
| `packaging` | `b9903cc550b2c8d394d705f43d3bddb05277483b` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [41187182223](https://github.com/Binary-Balance/seshat/actions/runs/41187182223), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,110,084 | `38063415d787bec1bdad82f96219f2ae7f2a08b2e69dbf9f1c93770c2da646aa` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [41187182290](https://github.com/Binary-Balance/seshat/actions/runs/41187182290), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 1,045,571 | `7981253dc696ba209a1ff0d7fba10a583aa1410035bb70adc9213ad97bb112f7` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [41187182250](https://github.com/Binary-Balance/seshat/actions/runs/41187182250), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 1,049,394 | `e3c315280eff601acc45fe721782f79988d5bbe5c57af65758b5694c444e365f` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [41187182250](https://github.com/Binary-Balance/seshat/actions/runs/41187182250), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 1,015,935 | `503de54c645a453c85c2be6079424e78ea5959b5dfd1f47a0dde986f12f7361b` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [41187182235](https://github.com/Binary-Balance/seshat/actions/runs/41187182235), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,074,016 | `a1aca9f91e92a427a579bc58510762428434a8253bf44252f2c7b06d3f039d48` |
| `@binary-balance/seshat` | `universal` | [41187182223](https://github.com/Binary-Balance/seshat/actions/runs/41187182223), `linux-x64-package-proof` | `seshat-entry.tgz` | 6,077 | `fba52ddf06bfcb56ea2c45a3d507c3a130d786bbbdaab2dbe6fe216bc54ef7df` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 758 | `fc4387a2fa83a16f2bad6008304e433c15660bdb46083f6ad2985d6deb4b3433` | `0644` |
| `package/README.md` | 7,857 | `2affbcb637e93a915da66535fce33c8f0586f2b957d9bf2c27bf4a83984afab4` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,409,992 bytes, `1ddd3ef8fc98c19e8dc0be03e1f81d2b16c0bbc9b0776f36365dceeb2149d42d`, `0755` | 9,953 bytes, `91cbb3d1dfe0d445572abe294fc7c7eefaeea84f30838f68e82baaa7642ab6c4` | 498 bytes, `3aace2fa1b49c303d9c8ea05887115ce3335efeb9eb4a1ffa0a6ed635cd93b50` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 2,142,928 bytes, `4bebaf525fb2b8b722abdc728f9d78a55cadc8cfd82fa8e1971735a2a4473235`, `0755` | 9,428 bytes, `4bfbcd0ca0c8d8979e912fe644cc46a3e63999f729c0a5bbede9e849bd8b0151` | 504 bytes, `9c1165fac95031b0f01d33197914986255b4e986dd7019df5931405430e2254f` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,227,240 bytes, `a0df1c791ef5f4bc53d02384a69098d1180c4b8e0ea261638feeec5cd74be7c0`, `0755` | 9,386 bytes, `2cb55ecfbf836806cc829cda3cfe4ce161a25daacd5a4468b980034f533fef63` | 472 bytes, `860521230f250686cb0ce128fc1969ee39b3201c4dd35a9d406f7de18765a031` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 2,124,208 bytes, `73e33430fa60eccfedca5f80a245fbdbb81d91d1a37c26a92a86858e9ee7dce6`, `0755` | 9,390 bytes, `674b6c17343cb7d7311450c8e6b72a7d134f1d7f82502f97dda737e10905ef41` | 478 bytes, `f9a50a2582c9f41403946b98ae04805fd2a049c611b05839e7c16279a67f1dbd` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,527,232 bytes, `ab5b0bd4f49318656ef69dddea6777f88d546518219a238588b23c79aa8cc9bc`, `0644` | 10,225 bytes, `94e93a3e28dd4786165e5869e5b98c8c3cf24677edab811e72af1c05cb6c8095` | 473 bytes, `9c0166ba5678bf0911dd1d7706a8c45a22e0fc0df79fa90fa327b6df6d498a87` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.10.0`.

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

[Run 41187182262](https://github.com/Binary-Balance/seshat/actions/runs/41187182262) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.
