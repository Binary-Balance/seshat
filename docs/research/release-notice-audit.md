# 0.5.1 release notice audit

Captured 2026-10-15. Native archive audit complete. Later preparation results
and publication approval are tracked in
[#161](https://github.com/Binary-Balance/seshat/issues/161).

Build source [c7eb19c700b73324369cc9ddc857d21500b11d19](https://github.com/Binary-Balance/seshat/commit/c7eb19c700b73324369cc9ddc857d21500b11d19), ref `refs/pull/162/merge`.

Reviewed head [cf90ec8e36927868318dbf3ce0ccd7ef6972bb38](https://github.com/Binary-Balance/seshat/commit/cf90ec8e36927868318dbf3ce0ccd7ef6972bb38), [pull request](https://github.com/Binary-Balance/seshat/pull/162).

| source directory | Git tree |
| --- | --- |
| `crates` | `86e52505ec0b35f71e442c2b60f40a9b60f2a17e` |
| `packages` | `213a47224d3f29b7da04a90c8a9d38498bc37e96` |
| `packaging` | `380a87a10b6756a3a3558df6209903fdf9df0795` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [38694848198](https://github.com/Binary-Balance/seshat/actions/runs/38694848198), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,044,814 | `c80d8888304d53a50fa8125227eae004174753ee452724b0ff5f3deb7a7e74b8` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [38694848328](https://github.com/Binary-Balance/seshat/actions/runs/38694848328), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 981,275 | `e7abd468c29a1a3204fe16a8b8180cf249b3cee72c7c816a710f1513e69b9c3a` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [38694848259](https://github.com/Binary-Balance/seshat/actions/runs/38694848259), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 985,090 | `240fc4d107183763d0ccfd3b87d077fa16e917727272bb59e3f6f66eaa42ec9c` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [38694848259](https://github.com/Binary-Balance/seshat/actions/runs/38694848259), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 952,171 | `8c596918459ca74106f27008fca285232b3dbb12d8b0730dccbf247fe671f9ea` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [38694848338](https://github.com/Binary-Balance/seshat/actions/runs/38694848338), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,003,091 | `59939346e96f4e93fbee730c977138c4fb9d1c388b82f4a35e67241e911a01d5` |
| `@binary-balance/seshat` | `universal` | [38694848198](https://github.com/Binary-Balance/seshat/actions/runs/38694848198), `linux-x64-package-proof` | `seshat-entry.tgz` | 5,700 | `ceddef9054b3293ef419fe6ae870c9b244d2eb7c42d2bc31a052c94532006745` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 752 | `b08619b0edc5f7b413b38e3d2d0652ad0f2676dd3c50017d432bda4a9bb8720e` | `0644` |
| `package/README.md` | 6,862 | `fac0df51100fb1d08db1ee1101aa8f62faeeb7432a0e90aa738b3c4153a49541` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,239,240 bytes, `3cba1c2b2042fa395da800d0b122d88c4c3a121a0dc7940b9e4c0ad4dcf23ae2`, `0755` | 9,952 bytes, `7e6a746cb0a2b8d8d4859f4a3cc7fff9cdc7de307af9a9dd3e3c1d13cf91d8a6` | 497 bytes, `fc041da2b4ac44f2d3d7c39e905b572f6f80108e901b14f73055e3b1a992f28e` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 1,991,376 bytes, `788cef882a26a4299ea3aee76ec3558544a675615171e412c547e49ccbf20cd7`, `0755` | 9,427 bytes, `2f3601e248918c94ef02c358f4a86c8ecd371b2eec4fe7f3b4f8471e8180bdb3` | 503 bytes, `368c51cb12263c7ce9caac77ce561445a9926cea3dea2292c8baa47a900ce993` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,061,688 bytes, `5576eb957fd51a7fe471ed360de0a29b9bc0706e023d4ad6e67aaf64e06b2968`, `0755` | 9,385 bytes, `9286425f0b35667482f024a8fae7a452d01722ddbd1e915f9c3e87ffc7436468` | 471 bytes, `cd50a456621b419c41106f64683d1531215dacb339b8cee36d313ecfdf8a6289` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 1,973,888 bytes, `dfbf0f695ed7de6c8c7673cbaed90e47b1e74257f4679f9451a0cba7907537fa`, `0755` | 9,389 bytes, `92f48835df91d808f73982e9b6e5ae526b4bfc85d0d6208b0c77a3cd97ed69ad` | 477 bytes, `a5ab4a55d62f251ca8e5f9d684ee39b1a6e11ebe39a7b13743caa584b8b14906` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,309,632 bytes, `1279a414a410ad35004095813597f5e65c03f90953321076ff8980f7592c6940`, `0644` | 10,224 bytes, `9821de47344100ecb7d69ebcbbb86284fb11930ccf673973123647843ce8425c` | 472 bytes, `c4edbae9b9bca80de1359e7147b3236dde4675c74129c88ee47a3c117f0c8246` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.5.0`.

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

[Run 38694848239](https://github.com/Binary-Balance/seshat/actions/runs/38694848239) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Checks pending at capture

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.

Publication requires approval of the prepared revision and six packages under
the [npm publication checkpoint](../agents/delivery.md#npm-publication-checkpoint).
