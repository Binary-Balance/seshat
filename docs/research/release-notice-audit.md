# 0.3.1 release notice audit

Captured 2026-10-06. Native audit complete; local install and publication checks remain.

Build source [28e19252659aaf9ea96cb3da98445256967a420c](https://github.com/Binary-Balance/seshat/commit/28e19252659aaf9ea96cb3da98445256967a420c), ref `refs/pull/146/merge`.

Reviewed head [0a469f0eaad8f20b0a2f9dee048014e6e5422586](https://github.com/Binary-Balance/seshat/commit/0a469f0eaad8f20b0a2f9dee048014e6e5422586), [pull request](https://github.com/Binary-Balance/seshat/pull/146).

| source directory | Git tree |
| --- | --- |
| `crates` | `64b6de7b910ee2a98bff9c040bc66d6339a69a8b` |
| `packages` | `f9fa15bf236b9ff520a00d1fe79ce72ebfbb75f1` |
| `packaging` | `54a14eed8407160a4c6a079aa91bba104a0bbd85` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [37416592609](https://github.com/Binary-Balance/seshat/actions/runs/37416592609), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 975,426 | `c2d5db2739468139298792d6bf95a353c8ba36c292f8049290541b4c26810999` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [37416592608](https://github.com/Binary-Balance/seshat/actions/runs/37416592608), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 923,165 | `093b871b9c4a6ff88d1a43ae8a6c2a7f37dc7f16cf58cf62c0f470eec8781e48` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [37416592607](https://github.com/Binary-Balance/seshat/actions/runs/37416592607), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 918,920 | `b13b96a8a044c2506e54cb2a534c837606a90185e4e798ed4a22254e1959e291` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [37416592607](https://github.com/Binary-Balance/seshat/actions/runs/37416592607), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 894,852 | `50168dd3f8d5fe5101e4f635bc8910effe419d189784236d2f9de650a2950c4e` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [37416592590](https://github.com/Binary-Balance/seshat/actions/runs/37416592590), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 935,462 | `e2c2443f86619dedb2fcd94df36c0361dfe1c0e49610149e8d8bbacdc4a53fd4` |
| `@binary-balance/seshat` | `universal` | [37416592609](https://github.com/Binary-Balance/seshat/actions/runs/37416592609), `linux-x64-package-proof` | `seshat-entry.tgz` | 5,387 | `f7eda108f6aa1098702a4a58be6f7f40a550dfbeaedd47c5a01091cda27edec7` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 752 | `9f4b7a250b0130c0f1997ba38e092d73ad21b5d3a1e41ee46a887da61fb5fcf8` | `0644` |
| `package/README.md` | 6,135 | `88a6c56fdbf3f5fdc116eee934e8d210c44e7683c09ee7d060670e778191e687` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,060,496 bytes, `c9e5cf66045018cf620eccf710d0b09087be8281530937ec287d0d5b955b5031`, `0755` | 9,952 bytes, `1fbcf53e3798f6a26cdfd6e8eaeb3e7f0f6920e249526b8ef36ee4d1a288fefe` | 497 bytes, `42c4a3deeb3d30b952814ab39ee49e822e4bd5129f42e9dc8a2a0908673be714` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 1,843,920 bytes, `5308f8699d7c59cff84dc9c2ba9f92a5927227b70cc6ce18798ecfb7296020f9`, `0755` | 9,427 bytes, `a08bda2d9a968b4d12b5eab7a7916f82dbfef3c428338efd346dbed2fe7b559e` | 503 bytes, `319c2a59fd6cd20eb78511ad36813274957cc8123d1c4214ee0d875570cc1782` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 1,899,632 bytes, `1706f78cda053be30c8dc9568ef5b39488ed973cf766310dfab2500e0428852f`, `0755` | 9,385 bytes, `e0d8edf370d7449d957b1446efaaac2a1a8d9bb259ecb734e69cc4898eab508f` | 471 bytes, `286f0031700d8f7d722f3d39c90d49170a423682ca4da65af1e493d26841d98d` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 1,839,520 bytes, `6d632fb24d7262f46b74559050bcfe42e05b72fd4cafa6a55484042dfa0533d9`, `0755` | 9,389 bytes, `c520736c4c0e609b6340bd6052e878f7c51942bae5fbca8cd51aede8fa1f0435` | 477 bytes, `3b21b8795abef56e0ac8253bc2b2416a98eedacc2d5cc0bb99bc8a8ce1db3cc0` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,083,840 bytes, `cfcd367cd2aa28abcdafb54ec460458e9c1c3105be1010c3484b5109ee42a6cd`, `0644` | 10,224 bytes, `8d4059b9548197eb06f9ef3f8bca45f8323080a4b0d0fce6920db70b39257032` | 472 bytes, `3ec557173f740de8ed6dcd5b5324165dc2ac6cc007518120bba26464f6cab1f1` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.3.0`.

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

[Run 37416592743](https://github.com/Binary-Balance/seshat/actions/runs/37416592743) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.
