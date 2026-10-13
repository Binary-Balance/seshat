# 0.4.0 release notice audit

Captured 2026-10-13. Native audit complete; local install and publication checks remain.

Build source [0f30ffbb83b0721a3a75abf36b815510f12f2f58](https://github.com/Binary-Balance/seshat/commit/0f30ffbb83b0721a3a75abf36b815510f12f2f58), ref `refs/pull/154/merge`.

Reviewed head [b3bdd9db79d1d91efc2ed093bb782698717bc721](https://github.com/Binary-Balance/seshat/commit/b3bdd9db79d1d91efc2ed093bb782698717bc721), [pull request](https://github.com/Binary-Balance/seshat/pull/154).

| source directory | Git tree |
| --- | --- |
| `crates` | `d7285b0672970384fd0ee3d58bf5b7855afe1a2d` |
| `packages` | `312fbe2adc669d642b1f6d3eddb1a59b5f07e3ba` |
| `packaging` | `746d7a24f1bccc8e48bf1b55be1307706b23940e` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [38347863188](https://github.com/Binary-Balance/seshat/actions/runs/38347863188), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,034,039 | `08be65edd917ec83b2c23dc8d27184e97690c518dbf3777d96121f7e3522df2c` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [38347863388](https://github.com/Binary-Balance/seshat/actions/runs/38347863388), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 975,506 | `f931d6839a0c159cc7061d04b19ac435a5972eb5e1a877201083f0f160613250` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [38347863187](https://github.com/Binary-Balance/seshat/actions/runs/38347863187), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 975,025 | `7efca06490752d6e1d0ab6a1d4a08ec30b13abda4afa123fae162a5e1adf9ab8` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [38347863187](https://github.com/Binary-Balance/seshat/actions/runs/38347863187), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 946,017 | `136f982c69e9360aa8808b70cc94b30514f13e97f94cd2e3923003f9b881803a` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [38347863205](https://github.com/Binary-Balance/seshat/actions/runs/38347863205), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 993,921 | `776dd2aab6b0e8b5bf11eee26fe5eef15a3a6df7816f529320b0aa96cb5e0628` |
| `@binary-balance/seshat` | `universal` | [38347863188](https://github.com/Binary-Balance/seshat/actions/runs/38347863188), `linux-x64-package-proof` | `seshat-entry.tgz` | 5,586 | `86dd1598b3798d58bbed6a5b555f36a21f736a98f58d754e5b229d801722e806` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 752 | `abf671090419610fd4a42b76b37ad32822353201eba3a3bfafb02ecd39cb8463` | `0644` |
| `package/README.md` | 6,614 | `542b6dc4bda9b31385a79ed17c23d59ebb22b293fda884c7b72c272457efb2a5` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,216,856 bytes, `32dd7f88919034aa8f8a47b6f35f5e8715c008da49c4d7fafc8a6e10c06ac552`, `0755` | 9,952 bytes, `f086bd5d7fb3618e90cf49e3616679ccb8ebc8a837e1267adfdc142aeaec10c5` | 497 bytes, `11f032f12a1d32cbac19869aeceed11172c474ce682bb09aa48e6fe99b294b00` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 1,962,704 bytes, `77933d61cf5a69256076db84b84fca608ea6bf4d3b047b4c4d55ea083d1c1572`, `0755` | 9,427 bytes, `7faab9d4d1e4b288fa628edee11cc63438b8e3a04e80be60416c91a73011ad1d` | 503 bytes, `d8e020fb4e1c8363eff52dc9e642f9cea117f9dcf39153231b07cc14214c38df` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,040,856 bytes, `a1661f96bd6c06946080db85fe27a46cf8da1b79a4f43615bb7b8e581ae70af7`, `0755` | 9,385 bytes, `03f2e842c7bbbafbe439db6df9f1df80b82e4f70048e21d83097fbaf88e31014` | 471 bytes, `a9ad41bae1125e015af6e5e1e5a3b1c0d394ae4a2a162eb899482893cb8f0d2c` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 1,957,024 bytes, `5376e76c49b57d66f048e2befa41ea2b59e6d665327e970c5933e7dc7c265258`, `0755` | 9,389 bytes, `2c14df9e2c790955d6607a9d9111f86a3622a09be03e7445bf2c72d38db6cdfb` | 477 bytes, `7185765c10a6778b54bffd228679ef208df58c4c883466fb8e5fd4d9eba06c2f` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,277,376 bytes, `33f910ae30c3c72491a90eea67078a0b878318dd8c4e4ce6a4a9030c8cfbaad2`, `0644` | 10,224 bytes, `c25805b1e00dcf2d9185f5eb0ad3a585728279400709a3313ee91b5669e09baa` | 472 bytes, `b1576d2edebb1fe0fe1f60d27dd710fca26ae89f00ac31e8f6022ed8adb51ece` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.3.1`.

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

[Run 38347863190](https://github.com/Binary-Balance/seshat/actions/runs/38347863190) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.
