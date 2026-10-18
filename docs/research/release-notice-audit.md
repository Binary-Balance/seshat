# 0.7.0 release notice audit

Captured 2026-10-18. Native audit complete; local install and publication checks remain.

Build source [7de0bc5628d9bd38376e6c8e049f27c941af7381](https://github.com/Binary-Balance/seshat/commit/7de0bc5628d9bd38376e6c8e049f27c941af7381), ref `refs/pull/178/merge`.

Reviewed head [83977986eff72fa5612b1515dfdec5e87dc76838](https://github.com/Binary-Balance/seshat/commit/83977986eff72fa5612b1515dfdec5e87dc76838), [pull request](https://github.com/Binary-Balance/seshat/pull/178).

| source directory | Git tree |
| --- | --- |
| `crates` | `be6aa63e1e4547c89d5232bd6dfc764f5bb8975d` |
| `packages` | `ba87549a8034e68a94e1b72639df9aa82132ff7c` |
| `packaging` | `0b587dab6c2b8e75131afa97b402819e4e091dfb` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [39036633350](https://github.com/Binary-Balance/seshat/actions/runs/39036633350), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,054,399 | `0cea0bf0941cb34d8a7452738768bc92fe1c9c28062f6b2b15c16afa13f7183c` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [39036633365](https://github.com/Binary-Balance/seshat/actions/runs/39036633365), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 993,746 | `038e447bd3e0549b2f31abeeb54f6c3dd16197d83e60bd9906c3edf136bae7a5` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [39036633373](https://github.com/Binary-Balance/seshat/actions/runs/39036633373), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 994,359 | `a6fcbb8cb621db2216f2d4a40a0fddba8c6788509ab421ad794a96b9d78f8099` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [39036633373](https://github.com/Binary-Balance/seshat/actions/runs/39036633373), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 966,080 | `760f26bef3babb65bd52f8484a0d12308e0dc13b65c62b92e4aae7d989fd1fb3` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [39036633404](https://github.com/Binary-Balance/seshat/actions/runs/39036633404), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,013,640 | `2668afbfd0c2c8cd89eed17497d7c3e0aa822bb93addbcc0d96c1ef1eb21cff9` |
| `@binary-balance/seshat` | `universal` | [39036633350](https://github.com/Binary-Balance/seshat/actions/runs/39036633350), `linux-x64-package-proof` | `seshat-entry.tgz` | 5,899 | `3644a2c37e2027403c13f48377c039f07a0f02063c2b4c70f71b87fad2c7290c` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 752 | `c914bae5124b1c2cbe0af96cba1a28f6bb0b6ca0c8cb1015738a1c26c3c5a6d2` | `0644` |
| `package/README.md` | 7,365 | `4911a2aa0fd6ce4e3e3b73a4bf90f92f4f88c9c2c7001b15eb33c8fba7c8f81e` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,261,680 bytes, `264b990b5bc5552d37452a4e4a2cc7ab240983130b5ad559018ff99e2f201e80`, `0755` | 9,952 bytes, `9e73b3427ce1b33de4c303efe7acee4f6f8b3e20900d39e6cd93480591bb7d0c` | 497 bytes, `d5d34b20241ad87935af259616a3de69640c033a996fae989c4205f7512a0b4b` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 2,015,952 bytes, `1048274bcbedf855302729778e08b7bae5070cb8f7b7d8f5b404902e4224abe2`, `0755` | 9,427 bytes, `dad830214651549e7d3a5f860282df619d752af5cca6fa29c9d69bc75db908dd` | 503 bytes, `9f2ffbd25c22cf9f50291f1e6e5e25323f84a42735287d6c740fd1f32a5f2f4c` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,082,256 bytes, `1ab46d34b1ecb3b1a4062a29333bc369db167efaf2c3cb464d10a5e5e4864bd4`, `0755` | 9,385 bytes, `2af61794013b70969908b0f5dab7679e1ebc58b54ea53368c76a5967e5fd3317` | 471 bytes, `d8a2cfc27d29951ea4d78a4f6ad1e0e0d44cfe9145f0d5f10420f425b8523df4` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 2,007,008 bytes, `a5274fedc4f5f13dc6a4daf1b3879e4f91541f809c2499a5fde1278ff75abb09`, `0755` | 9,389 bytes, `8c25d2beda2529bb00958b1d14802b522c311bee10222e3362053531c2caadbf` | 477 bytes, `8f64745a71f891e01e5bb1d1fa6914067567872417ba7cfa23b1308177914665` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,344,448 bytes, `e2cd7ed29ed207719404b035c92a6e42b2241f6e2c458bb6e74d92e0341b60c2`, `0644` | 10,224 bytes, `144ff644fb0089dcc5ffa34b572f98d212bb48b3b91baff4d9d75d98104198e2` | 472 bytes, `46d387d16431bfd19618454dcbb24f3a1cffe835f7576f7078502929808ce98f` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.6.0`.

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

[Run 39036633328](https://github.com/Binary-Balance/seshat/actions/runs/39036633328) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.
