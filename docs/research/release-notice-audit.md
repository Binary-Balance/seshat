# 0.16.0 release notice audit

Captured 2026-11-09. Native audit complete; local install and publication checks remain.

Build source [11e3b0673cc4df43d9dd6d888209793607e509bf](https://github.com/Binary-Balance/seshat/commit/11e3b0673cc4df43d9dd6d888209793607e509bf), ref `refs/pull/285/merge`.

Reviewed head [750793d99dce56dd4e51cbfdc2c8cbaa720333dd](https://github.com/Binary-Balance/seshat/commit/750793d99dce56dd4e51cbfdc2c8cbaa720333dd), [pull request](https://github.com/Binary-Balance/seshat/pull/285).

| source directory | Git tree |
| --- | --- |
| `crates` | `1b49ec9297cba7d22fd412a193e6b62d081d23fe` |
| `packages` | `7354e11e17c99cbe6f5df94fe7fec5b1916c3d77` |
| `packaging` | `202b22cc4f43b5413505d815b29b8362f2d28e35` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [42553712895](https://github.com/Binary-Balance/seshat/actions/runs/42553712895), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,172,182 | `e23bf381b0d5c468e7c844ea3101c6feb9ad625473ede656652b9e4dded9a48b` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [42553712832](https://github.com/Binary-Balance/seshat/actions/runs/42553712832), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 1,102,513 | `d024a133caeca720d1de4399b601997c378c5875c32bc826bdab99189d1d1f9a` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [42553712797](https://github.com/Binary-Balance/seshat/actions/runs/42553712797), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 1,108,616 | `b1e4a22d0ed078d0d270306e04e98770a73a879dcf2a33794362b54533278c9f` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [42553712797](https://github.com/Binary-Balance/seshat/actions/runs/42553712797), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 1,073,183 | `5573740b7a5c1d282683f7ec9d7ae74489355ab5f04792fc7b7c61955cefba5d` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [42553712925](https://github.com/Binary-Balance/seshat/actions/runs/42553712925), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,136,505 | `56ce8c5fd316ce3075f0012b4b3626f15c9556deb4c56f9ca80b0c25df0486a9` |
| `@binary-balance/seshat` | `universal` | [42553712895](https://github.com/Binary-Balance/seshat/actions/runs/42553712895), `linux-x64-package-proof` | `seshat-entry.tgz` | 6,364 | `f164d5a7375d3a145dbd08ec2ff17e6e8f7b1b125fc5c9a81737596b30dbd4ba` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 758 | `bd0cdddf44384cac8d35a90fe6ea633fec4be117fa826fd3becb4524f6ca2fda` | `0644` |
| `package/README.md` | 8,593 | `a638418a6073b0b574999753420f20b7fef1967ea53e3343a8d68c1a52bef7bf` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,565,536 bytes, `51501de2c53fe7317f190b65b212a8abb1636719e05c077f132b1462120702b9`, `0755` | 9,953 bytes, `670bdd198a0017577f5955ac56df2aa093c1a6a23019360f0702b65ac59d950c` | 498 bytes, `e72cdd43a697e7e5c05937a88a6b22c3f66b76e44410b9b2a4141aa89e8b0b93` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 2,278,096 bytes, `15a04aa155b7b802733b6dde4f88cba7fe83e3cedd569f31949fbadd7dac64f6`, `0755` | 9,428 bytes, `813e1a588304706c0c643ff935335e8d9b0b366e64a311ed29df443ef6d22b0b` | 504 bytes, `1c030a5468c01a790d8481212980d940c50db4215b28f0cdbbe890295571e5d6` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,371,320 bytes, `679348fdadccfef337933a54fb74f928b05c2d6245769053d0bcec741ecdeff2`, `0755` | 9,386 bytes, `ebd545a5aee87a9e89f897f00835434444a3a9c4930855ffb18df4114dc22718` | 472 bytes, `b25e30bcf01b9a2f1d9ee7fb58c212a3586d3410f2e7218e627b3f36459573b0` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 2,257,040 bytes, `e5a07c63a35083e4491419b431f3f3f86d416b50b42d70a7b21fe57060ffdf94`, `0755` | 9,390 bytes, `6c4cc22da696212e9e8108de6c67b073a211469bd40ba40efd18753d455c331d` | 478 bytes, `e63fdc8f032414e0c3e9b08c3740eb94945234d608ee03b1cfc0693e6d7d521c` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,699,776 bytes, `8b8ecb3f002c7b9a7bbca3e10b135e5dd999dfd0d8d9010f8b4d2ea1af874a6d`, `0644` | 10,225 bytes, `5f992884307fa68f16d5a2d1498c6e51abdd7f8058fdea9fdb742b389ed79eef` | 473 bytes, `558094380049a487bf395f351fe1bec0e6879dc08a252484ea2294e50f1b376e` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

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

[Run 42553712784](https://github.com/Binary-Balance/seshat/actions/runs/42553712784) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.
