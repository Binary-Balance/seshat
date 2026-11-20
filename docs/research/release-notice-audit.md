# 0.18.0 release notice audit

Captured 2026-11-20. Native audit complete; local install and publication checks remain.

Build source [aa8fb22b8031254aecf144ba6222c7ede8a440bf](https://github.com/Binary-Balance/seshat/commit/aa8fb22b8031254aecf144ba6222c7ede8a440bf), ref `refs/pull/305/merge`.

Reviewed head [609cf0e4f3545865afa8c858f09a8cd0f7a7d238](https://github.com/Binary-Balance/seshat/commit/609cf0e4f3545865afa8c858f09a8cd0f7a7d238), [pull request](https://github.com/Binary-Balance/seshat/pull/305).

| source directory | Git tree |
| --- | --- |
| `crates` | `28aa3511444357e8a014f7ee5f50f7426f60a9e0` |
| `packages` | `09472d16d9e36b65a5905f4e943c945ae1e50185` |
| `packaging` | `5045b087c68961bc9699f9751851b4dfd8128373` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [44669995223](https://github.com/Binary-Balance/seshat/actions/runs/44669995223), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,186,207 | `3ac25be8262ef19b8f184a011182fc7fb3d37d687881e85955ea14f1007b29c0` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [44669995262](https://github.com/Binary-Balance/seshat/actions/runs/44669995262), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 1,118,082 | `128cfaae817c0e6def6a08a4565440983c6659959b51cc3b7a89dfcdb0e08ee1` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [44669995303](https://github.com/Binary-Balance/seshat/actions/runs/44669995303), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 1,123,522 | `266eeb57787a5e9f69378c56a98aa79be95290f120a994e2a089fb2490b4d001` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [44669995303](https://github.com/Binary-Balance/seshat/actions/runs/44669995303), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 1,086,616 | `2267bcfee4d4bb056641d1ead5d4ec900cf9448f740b9e8919710170b671b081` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [44669995209](https://github.com/Binary-Balance/seshat/actions/runs/44669995209), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,148,556 | `6532beac6797560c0f15e043a525d4c1f058b38f2f9d284836b0fb9237aeac09` |
| `@binary-balance/seshat` | `universal` | [44669995223](https://github.com/Binary-Balance/seshat/actions/runs/44669995223), `linux-x64-package-proof` | `seshat-entry.tgz` | 6,539 | `c7208cc601617ff405e4cb190c2a40745f1fbda92ea488c27d29504807c3c95f` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 758 | `7af92c4466c562f7e17c6aeafafa53cb1dfa5cb70ddaf8d92cd9a24d08260ca9` | `0644` |
| `package/README.md` | 9,174 | `ea84906ca23bb7e5571d94f2baaf73a9c73a805c1eee95df9e0e721a0196edd1` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,604,128 bytes, `48acfa63df731803cb58b045eb530a3dc8216caf52e01b40fe8e38983c427be8`, `0755` | 9,953 bytes, `658925311ef225d7ef3b829365677b22131a332e8ecac3ae1a015416ed2b6592` | 498 bytes, `c69cf393f9588cf39dac88983c6eda4c16a707984a886bbf69979058ac05748f` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 2,310,864 bytes, `6a87d313a94fffafa445ab4e6c79eab585934c0b0d9fe594784d4cd4d21fc66f`, `0755` | 9,428 bytes, `5787d2f7f482ffa96b34c7633a0208a5b8457b23406936b57c651f54d77181d2` | 504 bytes, `d5f56110a8d5e25ed3736ed8624919cd37fa1f371ca000a8a9819726be832367` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,408,536 bytes, `efa700f80a816ffeb73f202861dfac2c72f31da699ead429ba96920812df2569`, `0755` | 9,386 bytes, `acbac049b98d7e97e50d81a5eed0e66b1c3b3bf693436e15a2d8c998a4e2a79c` | 472 bytes, `d8177699dcee9c4a538f790e177b54cfc3ade3a57d0788da274fe83446cf28e4` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 2,306,976 bytes, `f49c6cfc9d728ee4aee2c1135bbf501ba1736a68167ac64de3ba35bf319957a0`, `0755` | 9,390 bytes, `dce7766c97abe0ec83ad65805102567d6f54b1d8e14e9b7b41de31c490d55f73` | 478 bytes, `0257c14e00e4d835e61b5303acdc3cb38ff13185789878d2d2ffa1ab16e73b13` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,738,688 bytes, `1916ab90823670ce90c072913d92564115056e4c37cbf57ceaa290fa938c916b`, `0644` | 10,225 bytes, `7de13bc7acb270d9edc19f8e61149c7896540e2b998feb9ab6740d91a2d42f51` | 473 bytes, `5042a48fa6ed592ca2158688142c48591efb52b44ab24df5650c52c9b9134b2e` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.17.0`.

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

[Run 44669995191](https://github.com/Binary-Balance/seshat/actions/runs/44669995191) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.
