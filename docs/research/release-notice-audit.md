# 0.15.0 release notice audit

Captured 2026-11-08. Native audit complete; local install and publication checks remain.

Build source [8f8f2e80eed241d6276d66605a98f22bcda4de9b](https://github.com/Binary-Balance/seshat/commit/8f8f2e80eed241d6276d66605a98f22bcda4de9b), ref `refs/pull/280/merge`.

Reviewed head [e82e0b2ad8a680373598a87600494833604ae91f](https://github.com/Binary-Balance/seshat/commit/e82e0b2ad8a680373598a87600494833604ae91f), [pull request](https://github.com/Binary-Balance/seshat/pull/280).

| source directory | Git tree |
| --- | --- |
| `crates` | `c3a66182364b56c3056aa19db84eec31e2bdfa0e` |
| `packages` | `a106acbb6be5c3223d87e45f03b29972da69e010` |
| `packaging` | `61a92de19238637955e473b8e5aae374a56fb333` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [42446561222](https://github.com/Binary-Balance/seshat/actions/runs/42446561222), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,143,615 | `ce2993f7a7a34880175d369ac7bee3b51399c5b4852c73e6203284b5161252d5` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [42446561219](https://github.com/Binary-Balance/seshat/actions/runs/42446561219), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 1,076,939 | `ee72c52c58499d94af8e2778ceb687d35964a48a350cdd591dc2c3506bf34f0a` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [42446561253](https://github.com/Binary-Balance/seshat/actions/runs/42446561253), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 1,080,708 | `9d621190a0215b06a14487b1fefd41a894d7aff1f0bfb548475b869bcf1c6dc5` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [42446561253](https://github.com/Binary-Balance/seshat/actions/runs/42446561253), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 1,045,416 | `e8498c16fa48884d5c67091c32735030c86e25ed00eb88bf15d670d6753c4b8c` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [42446561182](https://github.com/Binary-Balance/seshat/actions/runs/42446561182), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,103,585 | `6ada77ac2303cb5102396c040edce2feaef37c1d06082380a53c934934fc0b38` |
| `@binary-balance/seshat` | `universal` | [42446561222](https://github.com/Binary-Balance/seshat/actions/runs/42446561222), `linux-x64-package-proof` | `seshat-entry.tgz` | 6,110 | `d4ac807355ebf05150170e095bb21fcf3d87cbf4cdf1accb8e3fd6c40eebf32b` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 758 | `9943fb5176549fd4ebf66a8295e78bd2bdb51921db8c5560405d1972fd95fd32` | `0644` |
| `package/README.md` | 7,947 | `82bd95cc42c1aec945164b6b8492e7122e009e407b7005df970c15c8935de758` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,495,928 bytes, `e60a38f34378e46f17167162e1e2da1de8d16b991022116df0960a4b0c34c2cd`, `0755` | 9,953 bytes, `2651b9cc072effcc16155080647ba83dc27096614f86b4a0711f90e519d88b0a` | 498 bytes, `fe072db8e386d10a0b02f9bcbe1202db0c9f23c968f5f2ff9d622a0b1afcd256` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 2,220,752 bytes, `57dc1d059372438fa612925ef2aae0be18ed976bd1221bc9ccb4a93d0f7fb770`, `0755` | 9,428 bytes, `70c4599b169426bde1de57ca6cc6c45cb9dec148f40149e13e54cb31b88bbafc` | 504 bytes, `f2dca37a004c2baa70fd5fc273d38c6121f7d3e0e60374d484e21afc4c0b6d1d` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,305,480 bytes, `23e540fc05779a2f7667da3aaf4db82e0c7ef76308d5b7c2d55afd825d44d088`, `0755` | 9,386 bytes, `39bc65f126358bee1ff01b7318b069edb605430c341f9a5931aca7133b8fd535` | 472 bytes, `42d9ea0378e7c9d6e06d441598eba76b31ce15a79215ce057c378be132345cad` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 2,190,688 bytes, `7fcfdff70ae00ae56f4250afe8f8aea31b3bacdc9865290d95de18b6656eff47`, `0755` | 9,390 bytes, `39982187aa652bdd2bbb69c427ef152599483e21c8d4bedc4f0c6ccd44ea879b` | 478 bytes, `24146b2e7eb10a19c4fb634792911585b4e48ffe51a83633a8f6ed65e898695a` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,603,008 bytes, `3aa18c28d12de15029df5118b345562ca82be7a8363e9788b576119637249331`, `0644` | 10,225 bytes, `b8278f9c215cd22f426d76dc80a1b738a7f6932390e9f930edaec0ac9af92910` | 473 bytes, `dbaace4b240209fe719d091f60fe53fa0685f9febcc3d1f9e71ac745ab199774` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.14.0`.

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

[Run 42446561144](https://github.com/Binary-Balance/seshat/actions/runs/42446561144) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.
