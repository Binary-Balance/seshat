# 0.8.1 release notice audit

Captured 2026-10-21. Native audit complete; local install and publication checks remain.

Build source [fa2e82311851d12809c70bed030c82c487ad4097](https://github.com/Binary-Balance/seshat/commit/fa2e82311851d12809c70bed030c82c487ad4097), ref `refs/pull/196/merge`.

Reviewed head [135aa4290baafaeead8484f647e184e8992fd098](https://github.com/Binary-Balance/seshat/commit/135aa4290baafaeead8484f647e184e8992fd098), [pull request](https://github.com/Binary-Balance/seshat/pull/196).

| source directory | Git tree |
| --- | --- |
| `crates` | `b5e171433c6f3a65dbf281f5d0880b13be1f62a3` |
| `packages` | `52897e21532c92b815fded05c70f9cc2bdb75d94` |
| `packaging` | `8a291033606f372f62127e08ec5201208f3649b1` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [39580310887](https://github.com/Binary-Balance/seshat/actions/runs/39580310887), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,092,270 | `7e7c9c3133db39596edfd489512a79d46a78367e67c6b27d79bac2060df7e4d5` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [39580311088](https://github.com/Binary-Balance/seshat/actions/runs/39580311088), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 1,029,723 | `6e266490a193a19e7cce3cbc12cf3e0f4bf6848fbb72ced3dc5e1a7da13bc9f9` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [39580310925](https://github.com/Binary-Balance/seshat/actions/runs/39580310925), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 1,031,491 | `42011548e62e1c299dbf986fad641d6e8bb37672885065af4fcdd22ded9b6d7d` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [39580310925](https://github.com/Binary-Balance/seshat/actions/runs/39580310925), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 998,388 | `947bce2bd37a580d579cf48302b258c8a8931b0b532369ead455a154d1699ed3` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [39580311067](https://github.com/Binary-Balance/seshat/actions/runs/39580311067), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,054,672 | `a073dab53328b3c6e531acabe5b49c5a9143d2e1a857eff94df01ddb3885932b` |
| `@binary-balance/seshat` | `universal` | [39580310887](https://github.com/Binary-Balance/seshat/actions/runs/39580310887), `linux-x64-package-proof` | `seshat-entry.tgz` | 5,973 | `6f254506a3f8e64cc1a3b63f573b21a8c3c3b097e41cc390794f70698d99f4b9` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 752 | `14839e28ef8f081ec99b28d464afab4cbbaa9ac74a80237c615b83d267eb8450` | `0644` |
| `package/README.md` | 7,555 | `3cf983982862af6d46f0161f28825fa3f97f632ab79ff6580e4e2e8e7474f960` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,363,464 bytes, `1d5678596747cef6a276dad8d009ae62757136ec7bf1ad451e804435e75750a8`, `0755` | 9,952 bytes, `861b15af6e746e78c746490fe2aa139896b159666e3c511fdd9c3ea1c8b05208` | 497 bytes, `4aa7bd2c1af741736de21dfe641777c03b8cf1654b15cd8e7ca423688457a618` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 2,097,872 bytes, `34a914680b4f5140af990d64edb3a9196611f4b40c89e55bc50a6d28dfb0004c`, `0755` | 9,427 bytes, `969a492964907928550e093b3f34c97ce77a5ffdc032951041095a1db91f46dc` | 503 bytes, `899379168cd88f4038242df0f8903c7b090ce07c04bfd6d5cbdd17428cf19fdd` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,186,056 bytes, `2c9d6d5e55ee115102fc4257a21c113c459b4c4ddb82ad71019741b35515b9ea`, `0755` | 9,385 bytes, `83f3dbb5eca292cc41d55359dff14acad0be5cb293c2ca6eb46f34a0e0a9ef42` | 471 bytes, `aae2ef02688e7624026ade801b7ee0de339ba5f88b2b95acc471865fbd4368e0` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 2,090,976 bytes, `681dcc76c4283d24d81edf960eeebf2967d8c1b48217fd6ff7a39592b2796d9c`, `0755` | 9,389 bytes, `9058c1c574c6a404b038514a126f38f307b0b9c827c0f2432f89f992061e532e` | 477 bytes, `74bfd4742c4480be557ced57902d4d2bc64cc96a3ffd669d401a2d310e8d73dc` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,470,400 bytes, `154c07d41ca8050b29fd11975ed7927cbf18d70c6f536f215093c7ab067ff033`, `0644` | 10,224 bytes, `9e35fdd8986e1a084e1ee30132e4e3927177f7ba0a58aeba48a9ac686bae8eba` | 472 bytes, `25493f6db9433332033d275818982921819dfafc454f749c75a68302f1f70c7c` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.8.0`.

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

[Run 39580310963](https://github.com/Binary-Balance/seshat/actions/runs/39580310963) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.
