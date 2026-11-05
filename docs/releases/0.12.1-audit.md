# 0.12.1 release notice audit

Captured 2026-11-03. Native audit complete; local install and publication checks remain.

Build source [a106c83e94a4b956f75338d9da17abc6ff7fa1f4](https://github.com/Binary-Balance/seshat/commit/a106c83e94a4b956f75338d9da17abc6ff7fa1f4), ref `refs/pull/262/merge`.

Reviewed head [d64aa48f243f6e4647b23cdf93ccc557877a1f42](https://github.com/Binary-Balance/seshat/commit/d64aa48f243f6e4647b23cdf93ccc557877a1f42), [pull request](https://github.com/Binary-Balance/seshat/pull/262).

| source directory | Git tree |
| --- | --- |
| `crates` | `6dcb598b08e978cd7d09b34672dae24f042d3dde` |
| `packages` | `f0def6505038c2cd06697bc668f48021160c48c3` |
| `packaging` | `1496f41b82bc51b0fd0134ccac064c41e73b675f` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [41618407576](https://github.com/Binary-Balance/seshat/actions/runs/41618407576), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,129,015 | `b113e5b8ca4febe5cca8edfba5d40e7bec08f7b8b29ea9747dd4e4c1daeaa0ee` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [41618407524](https://github.com/Binary-Balance/seshat/actions/runs/41618407524), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 1,062,100 | `f0b55d20faf17c35b25abb646efdcdd31c3b68f0118c282495584303745ae019` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [41618407710](https://github.com/Binary-Balance/seshat/actions/runs/41618407710), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 1,066,116 | `507edcb1368196dcfbbfe49041995ef0f9586d1303d851775d6458b3aed2804e` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [41618407710](https://github.com/Binary-Balance/seshat/actions/runs/41618407710), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 1,032,065 | `720f6a5d720c9413b4b4742c3abc113c037b37235a61c8215f0d8bb014c38af9` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [41618407605](https://github.com/Binary-Balance/seshat/actions/runs/41618407605), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,086,764 | `753873ca6767a5758eead521c42a56efe1ed5a10b3b89dcfd7523ca600b89591` |
| `@binary-balance/seshat` | `universal` | [41618407576](https://github.com/Binary-Balance/seshat/actions/runs/41618407576), `linux-x64-package-proof` | `seshat-entry.tgz` | 6,077 | `ce7c79afb82bff3b7814b479d95a0258722baab0ab3a8df388df0fba4aa12f09` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 758 | `e874c9bbd82160566114c3f9f7cdb0ef761ddd1ae9ca39800e4d96c333579822` | `0644` |
| `package/README.md` | 7,857 | `2affbcb637e93a915da66535fce33c8f0586f2b957d9bf2c27bf4a83984afab4` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,450,168 bytes, `32c1431914e0db7f66b593104ed9bdac16fbc84785af70c31e90bc04efef6414`, `0755` | 9,953 bytes, `d1e5136ccbfc3ebebe53b74208fa13fbd75b4d6562623f143b4e4b324002a1cc` | 498 bytes, `2e76ecfa9a169227a9263830eb9af75ed56c2374e8721a5a249573604d203db9` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 2,171,600 bytes, `99981b45b439089f5728fc87da78be647ac4f54b1b69e9e9a1029f8b2215eeeb`, `0755` | 9,428 bytes, `7a33d56884eb62caaa7264f35240d2d80a951665ad519244c13f2543d7681aa0` | 504 bytes, `10804a206e56e6d5c54ed5d4b8d67ca0374da59524ddf9b10579cb0887506df8` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,264,328 bytes, `2727a63d63923e277843bfd4c211b08ea91b26795f41a017fdf7213cbfa32674`, `0755` | 9,386 bytes, `eb65e5a33b1409b975fa9fcf1b7486f27eee633224505ae8fb650169a60df7dd` | 472 bytes, `f7b8a7e2c282453282b506121d0d6406d7aba9cfdfe72682580507c753ffc8f1` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 2,157,456 bytes, `49b8dd014e969776ecb567c54215671a80d502d9a426c352efc8f1908c93b017`, `0755` | 9,390 bytes, `dde0d535d9584a792e11031e3116172d7543d5a6d305638ce35f5ea7205ef2b0` | 478 bytes, `578c75f8d2f5253cbf582ddbb3b8b34148d8684728020913debab939959a462c` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,569,216 bytes, `da3fe71988f04cad12e844aed2a22fa73b46836081ce52ddc8fe2a0b9a523a43`, `0644` | 10,225 bytes, `ce53079246df131e3d0b555be77fa40af715280be527fb6c2d3d07c2fc120b33` | 473 bytes, `d4621a2a8e7c4b4590f5bfe9b644b297d49331ec9ca84deae228ddca2cdfd570` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.12.0`.

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

[Run 41618407578](https://github.com/Binary-Balance/seshat/actions/runs/41618407578) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.
