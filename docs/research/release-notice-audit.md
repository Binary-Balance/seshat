# 0.19.0 release notice audit

Captured 2026-11-25. Native audit complete; local install and publication checks remain.

Build source [6c2e27796c094e2ac50fe5e2665cd39c55cb7bc1](https://github.com/Binary-Balance/seshat/commit/6c2e27796c094e2ac50fe5e2665cd39c55cb7bc1), ref `refs/pull/313/merge`.

Reviewed head [0996b5401b7ae9cbdb73f8062a317692e8a65711](https://github.com/Binary-Balance/seshat/commit/0996b5401b7ae9cbdb73f8062a317692e8a65711), [pull request](https://github.com/Binary-Balance/seshat/pull/313).

| source directory | Git tree |
| --- | --- |
| `crates` | `e7800135bfa0346b72af26b70f2881508b7f242e` |
| `packages` | `5ad3915e1bd1fa2d5d903328fcad342451c166a3` |
| `packaging` | `b724133f47e2fd21282d833b295aeb6ddb1e53d0` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [45596782624](https://github.com/Binary-Balance/seshat/actions/runs/45596782624), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,186,211 | `2deac018bd19e458d02201dae2e2ec6a52166073b120151410d82d404faf66c3` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [45596783421](https://github.com/Binary-Balance/seshat/actions/runs/45596783421), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 1,118,134 | `f7d4a40a21f385f589e5e38c8f612dd858f8fc50d1212b33a295897f3df035db` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [45596782855](https://github.com/Binary-Balance/seshat/actions/runs/45596782855), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 1,123,524 | `8443c47fa0a233829d9d1751b5e71278438344c68c3b4bf96fda34d9947a0695` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [45596782855](https://github.com/Binary-Balance/seshat/actions/runs/45596782855), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 1,086,622 | `61e0a6bef9e977e4dfff84783db15596a261b19a4ba20dd4dc1a62c7ceadb94a` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [45596782625](https://github.com/Binary-Balance/seshat/actions/runs/45596782625), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,148,568 | `4ee90caba853300be464a8a0107e3b3e941bc55a27a84866a0ebf941b952cbc6` |
| `@binary-balance/seshat-linux-x64-musl` | `linux-x64-musl` | [45596783522](https://github.com/Binary-Balance/seshat/actions/runs/45596783522), `alpine-prerequisites-x64` | `seshat-linux-x64-musl-release.tgz` | 1,240,665 | `0ee5c17f486d7f2a4053f91d73a37e8243b3411794833decf5e2cc8a070493c6` |
| `@binary-balance/seshat-linux-arm64-musl` | `linux-arm64-musl` | [45596783522](https://github.com/Binary-Balance/seshat/actions/runs/45596783522), `alpine-prerequisites-arm64` | `seshat-linux-arm64-musl-release.tgz` | 1,167,916 | `5c8e30505a1aa60f68e4f19e099691c77731992cd83e831567a1ee27929975e7` |
| `@binary-balance/seshat` | `universal` | [45596782624](https://github.com/Binary-Balance/seshat/actions/runs/45596782624), `linux-x64-package-proof` | `seshat-entry.tgz` | 6,840 | `9435de0f6970ea2d87fa61df59e67d0923a127630fa897bbb95c597da4441161` |

## Canonical entry members

| member | bytes | SHA-256 | mode |
| --- | ---: | --- | --- |
| `package/bin/seshat.mjs` | 5,741 | `d2a75ed6cd7055125f153a8c3eab769ff2f220c171e6d7105fe226e58530f84e` | `0755` |
| `package/LICENSE` | 1,074 | `d2895ef18f0ba19d7c3e0b8c08a087554bddfb2f3cacb22343b412f3b32cbd91` | `0644` |
| `package/package.json` | 870 | `3f522940f6705b59a47bc6cd44d3930b09edfaa50564dc40697e64f6fdc0a323` | `0644` |
| `package/README.md` | 9,423 | `f515a0a5c59da18984fd2799651692788007bdc82a08da8324df02add25bcbfd` | `0644` |

## Native members

| target | binary | `BUILD.json` | `package.json` | notices |
| --- | --- | --- | --- | --- |
| `linux-x64` | `package/bin/seshat`, 2,604,128 bytes, `f8f5a713d89aa1783598a571c31297094d689904ea488754821f014e1c891535`, `0755` | 9,953 bytes, `41cb2bd6244f8cd1b5eb18d5c6b308272fb7b40967cb8931e5e670c1ebdc1a52` | 498 bytes, `c856e3dcefc93d5e3547954b1d49582eb5f3559fc61e0f1fe81d74f02fa480a4` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 2,310,864 bytes, `7e7edc1aaccd88416bba69b7de26519c4322e45ba6382d020b8273a173b34874`, `0755` | 9,428 bytes, `80e611f2dd7725263d7493967818e5797095407819714198302191ae02bd687a` | 504 bytes, `240164bfd46eaff1f44c134c503347f7ced78ddf3619b5007aac15fe5fc3cfab` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,408,536 bytes, `faae6841b8a4fe15d8052fa0074fae1f0f6e9c25b99ed43011ff39c2472b24ae`, `0755` | 9,386 bytes, `f6ebfaad45d997ce568438b9cd438d54c5a6bd03ca09a12e29360c8b6a805d7d` | 472 bytes, `8d3f008833376f8fdfb8f73f39e2480281c4d4a2f550e1f32d8e14bcc5d982c0` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 2,306,976 bytes, `e73c6157f85c3c3b6417c627f88ba0c85caa623bb2ca101ecf9314965e51b3cd`, `0755` | 9,390 bytes, `c41a53c26efdbb97ee9454669fbb1aee34b82359ec117f7f121cc23c74d953e6` | 478 bytes, `4623629c4816d35e0160cc6f6f4b0cbe9162e8300b90858041c2995bf2178947` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,738,688 bytes, `15669793a0abc68c568701c340c7b16e77588cb763622bb65643bf810c82d88d`, `0644` | 10,225 bytes, `8c8a77cf5103e5bf0d3f783ef1492369a40a16d44f3d89a5ad74ba08c1afa30a` | 473 bytes, `58a81030888383bc2f8e19030051654d9adf0aa088389ed8353fd0f56d638b3f` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-x64-musl` | `package/bin/seshat`, 2,675,352 bytes, `f07b6351d0bc1de5af3fca604f03268641a26049508e8add72f3f1543c952b4f`, `0755` | 14,517 bytes, `881d3553ba9b9b49181f23d72c7a09e59f87acdf871d22f194395ce2d1ea3be4` | 507 bytes, `46e175a1d3a8242b50c6dd5f94347d4a6ab5cd5045c7178757918755afdc1fac` | 2,103,056 bytes, `d8b1e857007b65345ac5690310188b6112bde332b81b1faf11c204d645aef927` |
| `linux-arm64-musl` | `package/bin/seshat`, 2,363,528 bytes, `2ef2decdef4476ec23a0e3e368a601bf7158cecd9bf37f4a8416ef19f84add30`, `0755` | 14,519 bytes, `63cc86e75881856a59b54e4c4ef39af9b4a914f5db9d835099fafc285a4c8afb` | 513 bytes, `fb2ed98f33195a5b000d84d512b0c4af6fce66e798616f13bcd6e4c7b72f4bea` | 2,103,056 bytes, `d8b1e857007b65345ac5690310188b6112bde332b81b1faf11c204d645aef927` |

## Previous release comparison

Previous version `0.18.0`.

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

[Run 45596782671](https://github.com/Binary-Balance/seshat/actions/runs/45596782671) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all 7 targets.
- Run the read-only publisher dry run against the 8 staged archives and the reviewed revision.
- After publication, verify the 8 registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the 8 audited archives.
