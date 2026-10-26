# 0.9.0 release notice audit

Captured 2026-10-23. Native audit complete; local install and publication checks remain.

Build source [574b0ec6414c3b5481b1075b4803257aaf497b32](https://github.com/Binary-Balance/seshat/commit/574b0ec6414c3b5481b1075b4803257aaf497b32), ref `refs/pull/209/merge`.

Reviewed head [4317b6e6391b8d85a706beeec44f8976d5131e62](https://github.com/Binary-Balance/seshat/commit/4317b6e6391b8d85a706beeec44f8976d5131e62), [pull request](https://github.com/Binary-Balance/seshat/pull/209).

| source directory | Git tree |
| --- | --- |
| `crates` | `e6e070d5c8fe6f36d0d4e3b3827eb69759de3711` |
| `packages` | `f0def6505038c2cd06697bc668f48021160c48c3` |
| `packaging` | `6ec17710e3d98a097ae6390005a69bb94ebeed31` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [39887755053](https://github.com/Binary-Balance/seshat/actions/runs/39887755053), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,100,757 | `3152f81844e918e7ec32700cb73dea62cf1d5e6b03f07524f590f35e6d9f5fc4` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [39887755059](https://github.com/Binary-Balance/seshat/actions/runs/39887755059), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 1,037,933 | `c1b9cddbc1173e8f3798481143bc0c9ef6edec774dd2c7154b19ed156d6ad582` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [39887754991](https://github.com/Binary-Balance/seshat/actions/runs/39887754991), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 1,039,481 | `cb63957ddc3581b46335adb313f30dcfb0e5189d7ec65f6faa8a2247132f40f0` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [39887754991](https://github.com/Binary-Balance/seshat/actions/runs/39887754991), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 1,007,313 | `8a335a2f9d9c9918fcd2b496d9affddfeb4cf74c3e261b06a4df450bada5534f` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [39887755070](https://github.com/Binary-Balance/seshat/actions/runs/39887755070), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,060,596 | `9cfdf8052896c7935c59b17a52ccb1cc0eaa97063e9ef8688521cd8de061dea4` |
| `@binary-balance/seshat` | `universal` | [39887755053](https://github.com/Binary-Balance/seshat/actions/runs/39887755053), `linux-x64-package-proof` | `seshat-entry.tgz` | 6,075 | `e21c634d36937678a6a2f7dea178c0da75de0f3d8e86ccfa5abd744d43e00d5e` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 752 | `9c103a4e40b8002d002250f2bb034b3d8767b5a5865c02fd52970d40272ce171` | `0644` |
| `package/README.md` | 7,857 | `2affbcb637e93a915da66535fce33c8f0586f2b957d9bf2c27bf4a83984afab4` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,384,632 bytes, `627bae1761d9c5a399d844645757c63a057f5c6815b9ef8307f0e2cd68a5613d`, `0755` | 9,952 bytes, `b1d1932007436aa9e0fa8eb25811b7692df4273496d6e4b774a4b4b4330c90b0` | 497 bytes, `8fc0545985794dfd1c83f7b7497155a81c21f707497b6007dffe1537b4f101bc` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 2,126,544 bytes, `a4918669c76185dacfe010df621f1b390ba022296f1f43a859baddad9eb34bcb`, `0755` | 9,427 bytes, `2a484767dea5f6239d24cace66bced600c6037f1164a5a2adc2aa686a847936b` | 503 bytes, `806aac553c92f969762b83fc358c3f3fe7cd5ecdbecde50493322ffae09633c8` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,202,576 bytes, `8b89de8100a5f64bbc466694b9cd5367aa390c0445aa029d099df00af86f0af7`, `0755` | 9,385 bytes, `389f613ed953325509b69475ed451a64fdefa67cbcba63300259459c33ac4864` | 471 bytes, `dfdeb921d795ecdbf567f564e0e97fcf450bd68a577b4aafa6778888e05f65ed` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 2,107,680 bytes, `05ff91b8bdcd7bb2e0eb7089d2389e81a661eb9146469a32e07bf1d87b93da69`, `0755` | 9,389 bytes, `5c527a13d3073b448d5754c800bf288150b21fac4a56098dba59c68de0a5a317` | 477 bytes, `f9f5375c41c9bc60a68da97257595a4513a034dc67fd7c502d0dcd98435df710` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,483,712 bytes, `cc74f4e3ce01e9619b722bfae1a8459f667f26d4b5fb0a38befbdc551a50bbc1`, `0644` | 10,224 bytes, `d88558d7d3fd00af1f01f0e6f11680ffcdd6c831db18e550b02e57aad085737d` | 472 bytes, `c93ce7573e5d0792664b0c5c21fe87c19a894bec3fece50b0cd688449b683f55` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.8.1`.

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

[Run 39887754953](https://github.com/Binary-Balance/seshat/actions/runs/39887754953) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.
