# 0.14.0 release notice audit

Captured 2026-11-06. Native audit complete; local install and publication checks remain.

Build source [96558b09e79268114b94e8f401fd5377584e11b2](https://github.com/Binary-Balance/seshat/commit/96558b09e79268114b94e8f401fd5377584e11b2), ref `refs/pull/276/merge`.

Reviewed head [3e4cb482fb914d36c6b8cee5f39912f679b87eb7](https://github.com/Binary-Balance/seshat/commit/3e4cb482fb914d36c6b8cee5f39912f679b87eb7), [pull request](https://github.com/Binary-Balance/seshat/pull/276).

| source directory | Git tree |
| --- | --- |
| `crates` | `822315f17fdfa4b72b3941ec2924f5f7ae06b6f8` |
| `packages` | `d7d1ae4bd0684eeea7271a96988d2d3ea63256e0` |
| `packaging` | `dcb2b9b3892fe01d448b2ea767dc44df84a9150b` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [42178436462](https://github.com/Binary-Balance/seshat/actions/runs/42178436462), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,140,459 | `e8c2e82523350ddced0d41baf50cc14a17db2d484356fd4d49dd946c11f5ec60` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [42178436471](https://github.com/Binary-Balance/seshat/actions/runs/42178436471), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 1,073,043 | `72472a7a4021d8d3e640f722637d823306059c8b99a0f77e87a497df16ac9ed5` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [42178436414](https://github.com/Binary-Balance/seshat/actions/runs/42178436414), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 1,076,167 | `5f3966d5cf05e72f9e84d49c0eb863dcaac3d92d901d3dd04dd219c923d6a236` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [42178436414](https://github.com/Binary-Balance/seshat/actions/runs/42178436414), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 1,041,791 | `c9bf344a1a1b43a2c47e32af27188f23368ca3dbe3012dd7cf78e74e47548ea2` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [42178436409](https://github.com/Binary-Balance/seshat/actions/runs/42178436409), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,101,676 | `d10236db587526127d2163fc108982f02a712a9dd7e5265c90fed240937f8fca` |
| `@binary-balance/seshat` | `universal` | [42178436462](https://github.com/Binary-Balance/seshat/actions/runs/42178436462), `linux-x64-package-proof` | `seshat-entry.tgz` | 6,088 | `92dd59bec900f7e094bbecc61ee628ab7fc30eded3f9e59a81de12159b7ad020` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 758 | `e5773d409c030311b67dbd20f90e631a65f0a34f3d0cebc7a7bde98cca9c99f0` | `0644` |
| `package/README.md` | 7,972 | `6929c3e124d71a4ab9e49679800b890e223005fdb643cafd367a739632ee667a` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,488,472 bytes, `e02d2c8e31d138e41b757754b2c6adbdcddb885a591057f9f57015d68b2513ab`, `0755` | 9,953 bytes, `4ca5d2334723c2876eeb60042dcfeeccafeedcd564af95e8987dc971fdd63232` | 498 bytes, `8cd60cc41a413563b18e2503879acf9ed8c2765a943f29bff4a1bbf3829bb5de` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 2,208,464 bytes, `dbab47fc2c2fad28b36dacc82d44f1cf905db2257c0a30d0dcee1ea31f99c3bf`, `0755` | 9,428 bytes, `7a1a680bc34f9fb380a3854dd2b8dd3541f9191c0a1ecd7cce067721fa4664af` | 504 bytes, `5e957d7d79f170a2a2893790f7b48c24d38179c39e56dfdcc0b71afcdcfc5d04` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,297,288 bytes, `2dd2f9245cc6cefa1b6b8f742cdcbc5dd4671eef17dbc538dc4534b5d4c61644`, `0755` | 9,386 bytes, `95ac479cfdb275b92033cee117d4cd02d8b73c64f32e4cec6a620539679098b6` | 472 bytes, `a02398a285439480d53afa03a0f9bc6c2dbd2767e684d2041f809d56a44a0ffe` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 2,190,656 bytes, `a00a37774c7f7479a42885acc41100dc97850e2437f61aad07d5d6cf53dc938e`, `0755` | 9,390 bytes, `e4c477c977db2924a29ce4a2b176724a94272b5134f964d27a7ec426760454ff` | 478 bytes, `167fba8f548bb3cb7e11852379377f53e82c29b6ba9ccbb0679338918435d996` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,597,888 bytes, `c23e8df18b0fc84852d48733f71f09f259b42fbf93881ea61cf908d7df014733`, `0644` | 10,225 bytes, `4d3c13f1f049d4984fe8daa4fbbd76ea0dd5c1bc293b15f5057e8473252e587a` | 473 bytes, `63dfe2309cd4fa97a1537ee52db728baa753988212688d1e7330a74f68dc11ab` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.13.0`.

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

[Run 42178436372](https://github.com/Binary-Balance/seshat/actions/runs/42178436372) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.
