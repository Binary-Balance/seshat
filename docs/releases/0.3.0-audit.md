# Seshat 0.3.0 release audit

Captured 2026-10-05. Version 0.3.0 is published on npm. Native and runtime
proofs, local installs, final main dry run and five-target registry/provenance
verification passed. The GitHub release contains the six exact archives.

Build source [7c74283ea3eeabb7fc6a43bb0fb08a0b91c29042](https://github.com/Binary-Balance/seshat/commit/7c74283ea3eeabb7fc6a43bb0fb08a0b91c29042), ref `refs/pull/139/merge`.

Reviewed head [718168b0848c434973fbef9990e82c22bd44ae98](https://github.com/Binary-Balance/seshat/commit/718168b0848c434973fbef9990e82c22bd44ae98), [pull request](https://github.com/Binary-Balance/seshat/pull/139).

| source directory | Git tree |
| --- | --- |
| `crates` | `13626f9648bdd1ee723c92e7a7182f0c01d9361e` |
| `packages` | `f9fa15bf236b9ff520a00d1fe79ce72ebfbb75f1` |
| `packaging` | `fe98e9989f217523284ef9980ebe45b8ced9f06a` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [37181509180](https://github.com/Binary-Balance/seshat/actions/runs/37181509180), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 971,855 | `9fa5484581431ab4228e89320b2a6f03dfa83c49e0dd36f27900479d9c97f489` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [37181509177](https://github.com/Binary-Balance/seshat/actions/runs/37181509177), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 920,518 | `762c8ff693a7c0bd0e37a31e53344dbc0c12469247db970ab06c7c40e2397932` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [37181509135](https://github.com/Binary-Balance/seshat/actions/runs/37181509135), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 915,081 | `1c1491d012539de0d7b765043afb55188374426e229d63183dac0ffa4b51fabe` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [37181509135](https://github.com/Binary-Balance/seshat/actions/runs/37181509135), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 891,425 | `f01859968a3027a24dc572b71f1f51088c28cfe5f44de606a0efd9d4e4ae55a4` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [37181509157](https://github.com/Binary-Balance/seshat/actions/runs/37181509157), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 931,344 | `5402e094b15fc87e53e53fdacb44e2bae42f5229949a58408c8b20e9a2a35749` |
| `@binary-balance/seshat` | `universal` | [37181509180](https://github.com/Binary-Balance/seshat/actions/runs/37181509180), `linux-x64-package-proof` | `seshat-entry.tgz` | 5,387 | `fcc43298f39c9a4c5028495ab25ca36332e1d0b4f50cea3b317d782ada9742ef` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 752 | `57bf872df4dd4afe3e353d593a16396f29bcc853905bc4e94ddf51e087803232` | `0644` |
| `package/README.md` | 6,135 | `88a6c56fdbf3f5fdc116eee934e8d210c44e7683c09ee7d060670e778191e687` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,050,464 bytes, `cbdcca92cceb964cfc047192d3db743937969047259484125092d7ea8638e6c6`, `0755` | 9,952 bytes, `cebc66a751d61e6597784843e9fdc2547813b221c285aa3defc96b124f270e3f` | 497 bytes, `82313e70fee8219986539158f56c8b482a7a3c6083b621f3d1322bec70db63c2` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 1,843,920 bytes, `202221a1d40cc17dd8fb81252286aa8c80ce6cc844303dd46d40ca9cd8e0688a`, `0755` | 9,427 bytes, `a251e18ab54d628964803ae9f329edef97209a64fa2c1f1fcce01e1149364160` | 503 bytes, `18f9c736063cdd3bb260b9d97afc38260100aec7cdc861ab4b2090f77ce45582` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 1,887,280 bytes, `d47a8eb4f555f70bdf98b1a4a9cc1c6c2abd0a879babb1c8f3c4755c6dd52562`, `0755` | 9,385 bytes, `f190aedc107a3650f983eb9dd0281228999fd9beb37ae4d18e59184a115fc785` | 471 bytes, `dc6b2614ebd178f924667997f44838a60e3b98ff7a666c2755da92b5a33b08fb` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 1,839,472 bytes, `8a2ac6dc211c251629b633fd13925f5265b8f4cf59eb2468b245274bc077fbfb`, `0755` | 9,389 bytes, `434ba2cd6817214b98300c8258d1fe3088dc5c6211bcb592962f9830b1db86ab` | 477 bytes, `b049a4e7e613ce1bbef3f8f5b1447092027fb41903a69d3fac3d8c78096de1a7` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,073,600 bytes, `5e9eaeecc2c77e70f9241b863473e7a5ad158957e01e81f60af432749afa6f18`, `0644` | 10,224 bytes, `d9c2f0bae939557bfd41c7f813a1e806f7e8e3fc2ade126bdf018738fe0c783d` | 472 bytes, `134f9fccab1279ced5916aa64fa7fd8b39dde6adeba42498d1a2104aa0f2dfe3` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.2.0`.

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

[Run 37181509119](https://github.com/Binary-Balance/seshat/actions/runs/37181509119) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Local release validation

The [five-target local install matrix](https://github.com/Binary-Balance/seshat/actions/runs/37183899755)
passed at `ae97c2805f963ba8cd23acd0d27e39874b9a532d` using Node `24.20.0`
and npm `11.19.0`. Each host installed the six audited archives, selected its
expected native payload and verified that binary's bytes and SHA-256 against
the audit. The Node, Vitest, Jest/Expo and workspace examples passed with
`toolVersion` `0.3.0`. The checkout's three source trees matched the build.

The local publisher dry run passed at the same revision. It verified all six
exact archives and planned the five native packages followed by the entry
package, all at `0.3.0`, using `https://registry.npmjs.org/`, public access and
the `latest` tag. Every planned command included `--dry-run`.

## Publication

The [final main dry run](https://github.com/Binary-Balance/seshat/actions/runs/37185092711)
and [publication](https://github.com/Binary-Balance/seshat/actions/runs/37266357652)
passed at `db2b506b7c64e303c87452d4660dd233a56142d7`. The maintainer approved
that prepared release before publication. All six packages were published at
`0.3.0` with public access, registry `https://registry.npmjs.org/` and tag
`latest`. Registry downloads match every audited archive's bytes and SHA-256;
all six `latest` tags point to `0.3.0`.

## Registry installation and provenance

The [five-target registry install matrix](https://github.com/Binary-Balance/seshat/actions/runs/37266947763)
passed using Node `24.20.0` and npm `11.19.0`. Each host installed the exact
entry version, selected the expected native payload and matched its binary to
the audit. The installed CLI reported `0.3.0` before and after `npm ci`, and
the Node fixture completed with three of four mutants killed.

npm verified registry signatures and SLSA provenance for the exact entry and
selected native versions on every host. The proof validates the full npm JSON
before writing success; retained stdout is clipped when it exceeds the log
limit. See the [matrix evidence review](https://github.com/Binary-Balance/seshat/pull/143#issuecomment-5988604396).

Verification used `44493fc7355392942b82db21c84f7953708d3761`, which fixes the
registry proof's old version constant. Its `crates`, `packages` and `packaging`
trees match the publication revision and the audited build.

## GitHub release

[Seshat v0.3.0](https://github.com/Binary-Balance/seshat/releases/tag/v0.3.0)
targets `db2b506b7c64e303c87452d4660dd233a56142d7`. All six downloaded release
archives match the audited sizes and SHA-256 values.
