# 0.5.0 release notice audit

Captured 2026-10-15. Native archive audit complete. Later preparation results
and publication approval are tracked in
[#157](https://github.com/Binary-Balance/seshat/issues/157).

Build source [64b8457f7cea49359e3b41298aa8d03d51c5824a](https://github.com/Binary-Balance/seshat/commit/64b8457f7cea49359e3b41298aa8d03d51c5824a), ref `refs/pull/158/merge`.

Reviewed head [60fb88391c31f007467a089286ef88fe156c806b](https://github.com/Binary-Balance/seshat/commit/60fb88391c31f007467a089286ef88fe156c806b), [pull request](https://github.com/Binary-Balance/seshat/pull/158).

| source directory | Git tree |
| --- | --- |
| `crates` | `ace1f906d4b277361e048b73196d8555ca4a3e45` |
| `packages` | `213a47224d3f29b7da04a90c8a9d38498bc37e96` |
| `packaging` | `92dfdc3ae757fe52ecb59074929b141d8c2ca5a7` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [38546121677](https://github.com/Binary-Balance/seshat/actions/runs/38546121677), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,042,281 | `b58075fe9989657ba11b683890f51e655abcdd14e22e95bfb3dc3d1f032fc191` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [38546121665](https://github.com/Binary-Balance/seshat/actions/runs/38546121665), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 981,009 | `fd1e2ab667e050edb06123328bef50357a82ebc8041268c044bf80f65b1577bf` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [38546121774](https://github.com/Binary-Balance/seshat/actions/runs/38546121774), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 982,198 | `d2d38d5645739aae4afe0497522b86831a3f7ab781dfcd6431d9046c79c0b477` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [38546121774](https://github.com/Binary-Balance/seshat/actions/runs/38546121774), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 950,571 | `14a8bca5ba10ad8597ab6a23e68c6992dea74cac8505c38b2ba384b2dbf295ab` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [38546121709](https://github.com/Binary-Balance/seshat/actions/runs/38546121709), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,001,851 | `6c174546c359f564b47bc7c6692dac3794f850989fa4f845de6c63a1dd4e2bf7` |
| `@binary-balance/seshat` | `universal` | [38546121677](https://github.com/Binary-Balance/seshat/actions/runs/38546121677), `linux-x64-package-proof` | `seshat-entry.tgz` | 5,700 | `b531ee5356f728fdbcd15f96b6aa0dc29ccf91c73ab61110afcc513536330c8d` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 752 | `78fdb29c41e2361cfd6c4861312918c0d49ca3723b4d7cd92fe88ddfe02d177b` | `0644` |
| `package/README.md` | 6,862 | `fac0df51100fb1d08db1ee1101aa8f62faeeb7432a0e90aa738b3c4153a49541` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,230,416 bytes, `312029a4a25bf5b33c06bd22244becd1210f7c0cb435100dbbde8dfa3bf2e658`, `0755` | 9,952 bytes, `46681ccaf887d726ea12769ad9c97af329412654a8b2678052858987c68089d3` | 497 bytes, `91f58002daba20c62700b0713e3b24dbe822cb88cd2a3edb63ad28c7ba1459c8` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 1,983,184 bytes, `cebc440c2863867bd078f9f3709bb18a8be91d8181e05f45f32d5782c731d8d0`, `0755` | 9,427 bytes, `4836c1e94c53b0c142f89da05fa17ad96e7c0e699d10304bd2da1b9266ceca6d` | 503 bytes, `4aa91a6f4817e38f97f79db9e8f21a3cbafdee7e277c03b697090c6c247518c9` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,053,472 bytes, `7823fd8b81157fc703395697d2dcd583664e63a1ecc879b19e82585d92d3f5cb`, `0755` | 9,385 bytes, `9409a2c034a1e188fd9a9eb67ea2e30e4a0936cdb834e52665b1f23f133b9649` | 471 bytes, `76ce2c3b06c5611320b5c159898f1d7dd82a35a5f277231d72308cf66151dd26` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 1,973,856 bytes, `10969f98de453be312ecad31e9aeed5ddceabd69006d1fccb1ad377d4bd48282`, `0755` | 9,389 bytes, `899fbe088151f4813e6e71e14d04c56548b3fef4578644f554db2a7aa974fff1` | 477 bytes, `d5e6f4e061354f1557307e3a94cd87f0fbaa3d4da57ef97c8628256abaa6c073` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,305,024 bytes, `c914ca1895efddc5583d37ac4c1a0060fc305a61417309f399fc0e7e0d8d3a24`, `0644` | 10,224 bytes, `6ae0a92aba19e72b5fd7c016f486439efbe8480f4595832527877d05444c60c8` | 472 bytes, `8b0b37edc6a3d6d26791e9346c800d010a3988440f0ac0db390ae00d96c14373` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.4.0`.

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

[Run 38546121712](https://github.com/Binary-Balance/seshat/actions/runs/38546121712) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Checks pending at capture

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.

Publication requires approval of the prepared revision and six packages under
the [npm publication checkpoint](../agents/delivery.md#npm-publication-checkpoint).
