# 0.13.0 release notice audit

Captured 2026-11-05. Native audit complete; local install and publication checks remain.

Build source [a195f7b55fba51df670c0cd0709d15537011014f](https://github.com/Binary-Balance/seshat/commit/a195f7b55fba51df670c0cd0709d15537011014f), ref `refs/pull/268/merge`.

Reviewed head [8b51fd7859e71124edf7a18d218cb302fcafd64f](https://github.com/Binary-Balance/seshat/commit/8b51fd7859e71124edf7a18d218cb302fcafd64f), [pull request](https://github.com/Binary-Balance/seshat/pull/268).

| source directory | Git tree |
| --- | --- |
| `crates` | `0fdbc7c2b9dbd77a6a4a2fde19e0383557c7111c` |
| `packages` | `f0def6505038c2cd06697bc668f48021160c48c3` |
| `packaging` | `7f56239c15679cbec652eeb89b3472e880e7052c` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [41998219578](https://github.com/Binary-Balance/seshat/actions/runs/41998219578), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,131,089 | `74e66fb1ac184b3e1cfa1d466e62dd90a3f9114e532dbfb1d253086a68a970f8` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [41998219546](https://github.com/Binary-Balance/seshat/actions/runs/41998219546), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 1,063,739 | `da7097979ccaadbcf0d53d4274efe336ef493fd9a1f58db667a04e5558bfc8ea` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [41998219666](https://github.com/Binary-Balance/seshat/actions/runs/41998219666), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 1,067,541 | `d5b43bde79f28639c7ca110cd995e70295059b119ee24ff85e7435954e9a7a19` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [41998219666](https://github.com/Binary-Balance/seshat/actions/runs/41998219666), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 1,033,295 | `e4cce8b6c9756938fc0dc41405c12c11fd6d4d5f17aff0e1040af12670f441ee` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [41998219598](https://github.com/Binary-Balance/seshat/actions/runs/41998219598), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,092,051 | `908c3db85bd7c4f2dd65e091256d9ca6499e24b4cde0853e144650386c1b6c39` |
| `@binary-balance/seshat` | `universal` | [41998219578](https://github.com/Binary-Balance/seshat/actions/runs/41998219578), `linux-x64-package-proof` | `seshat-entry.tgz` | 6,077 | `27d35d9866c113ce09234208200a3683513c6a28e3a3186af9d5bf2f0ea05e16` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 758 | `8dacba469ad155c3ac0a257138a9a8982ff8eb25b30919fbc8bcf2540fd207c1` | `0644` |
| `package/README.md` | 7,857 | `2affbcb637e93a915da66535fce33c8f0586f2b957d9bf2c27bf4a83984afab4` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,453,728 bytes, `65c221dfe6498be068270afe8e030bc9c2a2fc8a28aa3236a79de22eb30a7a9d`, `0755` | 9,953 bytes, `97b8cf180742d46389e27c45860e221e619e939ac7ac91ef7603b360adb3c3fc` | 498 bytes, `707cf15a52a07fa089531ae7465c737ae00fdbb0c37e70567466dcb2c081038c` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 2,171,600 bytes, `33c7a5863654b8e8b4f2a691e064370ca5c1f8e591c82ad0d8398f2ab638dd6e`, `0755` | 9,428 bytes, `96cabf2209612ed90c944c9c6fe67cdcb9ce00f2bd29f99f4cdc749484cf9497` | 504 bytes, `7c63a0270f4bb7729aa481b4825de12a2bf1fa5fb6a86ec68fdbe9e393647be7` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,264,376 bytes, `0de0349b0e914aae8026b457c5c181419264ea238d27de5c00ea0e49ca6b16a0`, `0755` | 9,386 bytes, `ac87226c26d1a12985c731945220fb07dcd6f5173061af0ffa6d61d4d9ef04bb` | 472 bytes, `92d3dbdc820747b33364ae6d103ac6b370faf15bc5294f99da6e0b4f20ac02e6` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 2,157,520 bytes, `58607cc6c53d6787da83ba726727d6ec1f43acd528c6ba4d78a97b600b11f2af`, `0755` | 9,390 bytes, `599df199a238a72eb14f280fb89c42b8b12365fdd6af03c9f89331d50ee3fd5f` | 478 bytes, `15d3b5ac90654f8b8bf035e6d84c06a73f6869167f85a4e73e9283a034657d23` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,562,048 bytes, `a4f92f78c4d234823dde440a8c1515cfe04488bc5f0c1930397eaddde1cf6aa8`, `0644` | 10,225 bytes, `7abdf9091266f2539555515762550fc9e987b64c592ada772b1668d74f85db25` | 473 bytes, `d59974cdae833975c0d637d8b48bee6b86fdd04a121bf81b2982f9411c821025` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.12.1`.

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

[Run 41998219594](https://github.com/Binary-Balance/seshat/actions/runs/41998219594) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.
