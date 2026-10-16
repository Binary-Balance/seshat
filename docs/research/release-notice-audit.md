# 0.6.0 release notice audit

Captured 2026-10-16. Native audit complete; local install and publication checks remain.

Preparation and publication are tracked in
[#172](https://github.com/Binary-Balance/seshat/issues/172).
Publication requires approval of the prepared release.

Build source [115342c15890937434df8bf67cee8e7707e48d28](https://github.com/Binary-Balance/seshat/commit/115342c15890937434df8bf67cee8e7707e48d28), ref `refs/pull/173/merge`.

Reviewed head [55904ecd58dc85a3cc7a7a60fefbf127e39cea20](https://github.com/Binary-Balance/seshat/commit/55904ecd58dc85a3cc7a7a60fefbf127e39cea20), [pull request](https://github.com/Binary-Balance/seshat/pull/173).

| source directory | Git tree |
| --- | --- |
| `crates` | `96814cc06f7bd6c6743e0860c12290685d6fb680` |
| `packages` | `213a47224d3f29b7da04a90c8a9d38498bc37e96` |
| `packaging` | `218ab24e5b958226cba51879717c253f2b96c757` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [38869209751](https://github.com/Binary-Balance/seshat/actions/runs/38869209751), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,052,469 | `7405fb85ec1318a6ede800ca70eb04e1a89f2314111fffd0280035ace834a754` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [38869209736](https://github.com/Binary-Balance/seshat/actions/runs/38869209736), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 987,868 | `2ea616d402c1587006ea016ad5939ab21d82efb20f43932621cd1874c1c679c2` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [38869209756](https://github.com/Binary-Balance/seshat/actions/runs/38869209756), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 992,521 | `02598ebb309bfb2c8d8da6d406ba13aa65950bb0dc5e1e903ffd95df1ab3baa4` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [38869209756](https://github.com/Binary-Balance/seshat/actions/runs/38869209756), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 959,751 | `06e134c11de04870569354c74a9cec558a0fb3943e5d48de754e469907aa10e0` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [38869209738](https://github.com/Binary-Balance/seshat/actions/runs/38869209738), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,012,213 | `b0dff2061539bcb36ba9bea85e5b167cc739efa17f77f495996f1f59b485bc21` |
| `@binary-balance/seshat` | `universal` | [38869209751](https://github.com/Binary-Balance/seshat/actions/runs/38869209751), `linux-x64-package-proof` | `seshat-entry.tgz` | 5,700 | `b7b4ff9b58eb90dbf5a6d883b4597faa507551a78915a32333a04054ab1eed84` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 752 | `4a1378d44fca2b0fb6dd5721ccd1f86f8e78440bba812139c524f41e7963b6d9` | `0644` |
| `package/README.md` | 6,862 | `fac0df51100fb1d08db1ee1101aa8f62faeeb7432a0e90aa738b3c4153a49541` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,255,768 bytes, `29689fad7d7b9274cf71dcc26275e80c209b9370c37f202709f7b85e9e1202cf`, `0755` | 9,952 bytes, `77f62d76a459824625a37ee28f4c4b2aa1483be10eee9afdc8c61c6592704c5a` | 497 bytes, `79a634659cce3c38394ab8a2190fd59e3f17ba9e776098cdec773950cfd188ac` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 2,007,760 bytes, `1e3c3c04f885e5e71cfcb108f2438ac39d810941eead69e2fbf104b13833dbf7`, `0755` | 9,427 bytes, `c9598d9a826c7844de49971201d9c902de3b8a3c8580ff25774c89597d79f389` | 503 bytes, `94a4f950e8ee60014d9bff091c084909e8a31567b7af096255ad07fde07cf69c` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,078,080 bytes, `3dda08a6297eeb2bf4c6f86e3b6f45e08542620cf718cf6ef734611a139b0511`, `0755` | 9,385 bytes, `3afffee2cc05d7c47f835500fe2faed63acaeb9f1e36f11e9f7a45639c3e53a8` | 471 bytes, `4149b93cbbc0ee7ef0dc8a74afa01951dfe087f5b78149735061ff55e134aa65` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 1,990,416 bytes, `705474b03253c99ffec157fa90d0321ccdf8e4b7131a5a64f6b7147fe445ab5c`, `0755` | 9,389 bytes, `2b2eb4c40d35980333767f5538945a5b9b880bfb17df047db87c013b53eb92cd` | 477 bytes, `ee3373d09d92a70458d9977db4b0a7aca801a3256fb1fb5f7dd6c687c2fb5e16` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,338,816 bytes, `832f6e6f9394c644ff42b9af0ff6d748958d69ff319e49d088d3821d4d963b1c`, `0644` | 10,224 bytes, `d4f4b05730123eeba1232b916b7fecd6014a78471fdd3b4d169d8e7a983daae0` | 472 bytes, `41cf7e821f15727389c74f78195587a483441e22181bbb7434267465120fd26c` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.5.1`.

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

[Run 38869209813](https://github.com/Binary-Balance/seshat/actions/runs/38869209813) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.
