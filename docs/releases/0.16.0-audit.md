# 0.16.0 release notice audit

Captured 2026-11-09. Native audit complete; local install and publication checks remain.

Build source [f04d3095a8133ac9866539cd142855b41a5efbda](https://github.com/Binary-Balance/seshat/commit/f04d3095a8133ac9866539cd142855b41a5efbda), ref `refs/pull/285/merge`.

Reviewed head [8c4c97c424872264ed0cbe4d6f5531096a31da1a](https://github.com/Binary-Balance/seshat/commit/8c4c97c424872264ed0cbe4d6f5531096a31da1a), [pull request](https://github.com/Binary-Balance/seshat/pull/285).

| source directory | Git tree |
| --- | --- |
| `crates` | `1b49ec9297cba7d22fd412a193e6b62d081d23fe` |
| `packages` | `cb0ae5a3dbac7d8346d939b5b1c1b889fa07be49` |
| `packaging` | `202b22cc4f43b5413505d815b29b8362f2d28e35` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [42564078966](https://github.com/Binary-Balance/seshat/actions/runs/42564078966), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,172,182 | `8300cc0f1afd7f906a4c9f9a65b96497b3f92ec90c3eca680e81107c15a2ec8f` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [42564079183](https://github.com/Binary-Balance/seshat/actions/runs/42564079183), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 1,102,513 | `18d164cff1bfcf11c3802edda5721583a843c36d669d3f8a1c7849f0f109a182` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [42564079021](https://github.com/Binary-Balance/seshat/actions/runs/42564079021), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 1,108,617 | `feaeb5d5a605d2f213585ec530de34d5cec31f279ccc0bb8f9aa6c5dfcd9339d` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [42564079021](https://github.com/Binary-Balance/seshat/actions/runs/42564079021), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 1,073,184 | `15581254374451db71bd46850fc5b14edd36dbbe1e3f39e26337a70b95c096d4` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [42564078994](https://github.com/Binary-Balance/seshat/actions/runs/42564078994), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,136,505 | `46500b0bf9223483012dbf68745599ae6c22d1cebfee27fbf7842b05966c850b` |
| `@binary-balance/seshat` | `universal` | [42564078966](https://github.com/Binary-Balance/seshat/actions/runs/42564078966), `linux-x64-package-proof` | `seshat-entry.tgz` | 6,362 | `66111970ce10b1a90c7777d3bc4807279e0a2a02a6dddf8585e9ed2515f2414a` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 758 | `bd0cdddf44384cac8d35a90fe6ea633fec4be117fa826fd3becb4524f6ca2fda` | `0644` |
| `package/README.md` | 8,592 | `9f6fb9e17411ab33320b568669e222fc94044063b790176321af9fe522222134` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,565,536 bytes, `51501de2c53fe7317f190b65b212a8abb1636719e05c077f132b1462120702b9`, `0755` | 9,953 bytes, `dae1cac869a24125737834e2d1ecc9644b1ead9f0d6e99c12852bc4201b80e88` | 498 bytes, `e72cdd43a697e7e5c05937a88a6b22c3f66b76e44410b9b2a4141aa89e8b0b93` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 2,278,096 bytes, `15a04aa155b7b802733b6dde4f88cba7fe83e3cedd569f31949fbadd7dac64f6`, `0755` | 9,428 bytes, `4f2bd7be369b4e85d87e4f02bd9956ec307e714c641868115b462ca96470720a` | 504 bytes, `1c030a5468c01a790d8481212980d940c50db4215b28f0cdbbe890295571e5d6` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,371,320 bytes, `679348fdadccfef337933a54fb74f928b05c2d6245769053d0bcec741ecdeff2`, `0755` | 9,386 bytes, `035d36ac40d5733d51badda7931e129d70d4e50c39fd591d0076b069cbaa3bc6` | 472 bytes, `b25e30bcf01b9a2f1d9ee7fb58c212a3586d3410f2e7218e627b3f36459573b0` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 2,257,040 bytes, `e5a07c63a35083e4491419b431f3f3f86d416b50b42d70a7b21fe57060ffdf94`, `0755` | 9,390 bytes, `9e5ce977df74ebab9dd7eda0eeb352082e6b1f88281f2583976a5bb161cc107f` | 478 bytes, `e63fdc8f032414e0c3e9b08c3740eb94945234d608ee03b1cfc0693e6d7d521c` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,699,776 bytes, `8b8ecb3f002c7b9a7bbca3e10b135e5dd999dfd0d8d9010f8b4d2ea1af874a6d`, `0644` | 10,225 bytes, `72fa1972f02828c36c4dc30422ef48cf473c0c84d732e0be547a69bdb474314d` | 473 bytes, `558094380049a487bf395f351fe1bec0e6879dc08a252484ea2294e50f1b376e` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.15.0`.

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

[Run 42564078960](https://github.com/Binary-Balance/seshat/actions/runs/42564078960) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.
