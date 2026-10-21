# 0.8.0 release notice audit

Captured 2026-10-20. Native audit complete; local install and publication checks remain.

Build source [2881ca7f8d510a9e9d80721ea884b0edee54f051](https://github.com/Binary-Balance/seshat/commit/2881ca7f8d510a9e9d80721ea884b0edee54f051), ref `refs/pull/189/merge`.

Reviewed head [acbcb8bfdbdd2854ad92d7d5842364cb7fa1369d](https://github.com/Binary-Balance/seshat/commit/acbcb8bfdbdd2854ad92d7d5842364cb7fa1369d), [pull request](https://github.com/Binary-Balance/seshat/pull/189).

| source directory | Git tree |
| --- | --- |
| `crates` | `18a76b2832d2bc3104f2acbbe7b4ead88d0d9332` |
| `packages` | `0a87d73cfda810ee3a51bc7e17ba4e4df88d6a03` |
| `packaging` | `8ed01dede64ac467d45cf1241b6f903e0df73f26` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [39375098631](https://github.com/Binary-Balance/seshat/actions/runs/39375098631), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,092,296 | `d5b374a126755dcc9a57e7e70f08e0970d1d1e3c38a414810247f5db6ce652d5` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [39375098519](https://github.com/Binary-Balance/seshat/actions/runs/39375098519), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 1,028,976 | `1322e2bd1a82da4488dd6ff257ff69a5e68f500993c4c34dfe09ac46a1279c5f` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [39375098515](https://github.com/Binary-Balance/seshat/actions/runs/39375098515), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 1,032,555 | `97d0ae8031c7254584ca2c357ce39a00d475870980b38d64a4dec4062d94b117` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [39375098515](https://github.com/Binary-Balance/seshat/actions/runs/39375098515), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 997,638 | `a5410979d9e40ff39d927e31e9a7ca71e30f51ad37d756e032fc5eaba6c37d0a` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [39375098542](https://github.com/Binary-Balance/seshat/actions/runs/39375098542), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,054,892 | `4271b444b2889f29a55827738626e52fa3a630b769d6cb40f6091a1338878702` |
| `@binary-balance/seshat` | `universal` | [39375098631](https://github.com/Binary-Balance/seshat/actions/runs/39375098631), `linux-x64-package-proof` | `seshat-entry.tgz` | 5,970 | `b9273e94111b8fab547b0be609f8d520c1fdc7ba05b2e99a0c335de33c63f467` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,036 | `a8042d06d93200c3c98cc1c22da7e8bb100c5f5a5cf03075c820209a801a6426` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 752 | `03953e05d844c5cb3935d898fa3454b23f988914afd583499466e5333b780d7e` | `0644` |
| `package/README.md` | 7,543 | `ab9ee26a2cd9d0fd1d7a828122425c57893fc01227269c4772be974f863283d6` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,365,552 bytes, `4fee7e17e91c7eb111fd285b303aa72d433b84fe4cc8a15bfbc083620e27d224`, `0755` | 9,952 bytes, `f94977360efd99e5291383adc17341a4b31b5d89da3cdfce8c6a56bcf101235a` | 497 bytes, `9dcfeae392b0f65cab1ced0c7f08015f10f4874bae0e88e527c21e4a73d31cd3` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 2,097,872 bytes, `4ecc618185f5707e43946e520d643da8dcf874e0cd0b5fa9d8b66ef2e7ad5335`, `0755` | 9,427 bytes, `870f026ee16d81fd2440b62ea6e26beeb56e2309ce4fcadd15debfdbe0cd4986` | 503 bytes, `ded9705b6a473a33d91bdd79166f18a5b7472169737446a0c15ecf2a4ee00b68` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,186,040 bytes, `cc7b8a465ccb936e1fdf4fefe603cc5165ce57c0da0ef04767ffbef2e078611c`, `0755` | 9,385 bytes, `ba7e72ada551576fc0a217cc744d0f301e4a9862c203189382356abb56a272fb` | 471 bytes, `7a05838338ef79bd1182a2cb771b435a545c4ab605502f6f541d2827d36b88af` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 2,074,416 bytes, `9a7c5f0ff90ae09148b9a25107fce4f89b2e35f66068e5ddd26eafd3ee806eaf`, `0755` | 9,389 bytes, `a713f5a526fa9cab655a21f438659e733b56b2b65851e2484357d732594ea852` | 477 bytes, `014a58ebb237c5ab1060fe225bea52899307eb75af10a1d081de8aeac034ecfc` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,469,376 bytes, `4a3093d0675d733bd12a377ece36f8dffb7fe67d5e925637614e6ee8d49b6ba8`, `0644` | 10,224 bytes, `5e87731a657f27710d6e9c6ea76ac989dbd0d4f9a5d786dece40b9e4ba2fd4f7` | 472 bytes, `a76fa7e0ad5a88723270e86b4ecc8edc0647f39917706accbafea43be902934f` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |

## Previous release comparison

Previous version `0.7.0`.

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

[Run 39375098711](https://github.com/Binary-Balance/seshat/actions/runs/39375098711) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all five targets.
- Run the read-only publisher dry run against the six staged archives and the reviewed revision.
- After publication, verify the six registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the six audited archives.
