# 0.19.0 release notice audit

Captured 2026-11-25. Native audit complete; local install and publication checks remain.

Build source [b78997a06f40e74ad2fa58e3a163d0efeac98dae](https://github.com/Binary-Balance/seshat/commit/b78997a06f40e74ad2fa58e3a163d0efeac98dae), ref `refs/pull/313/merge`.

Reviewed head [b59950c9c2239b3c901e72b0b6992f96a401ee97](https://github.com/Binary-Balance/seshat/commit/b59950c9c2239b3c901e72b0b6992f96a401ee97), [pull request](https://github.com/Binary-Balance/seshat/pull/313).

| source directory | Git tree |
| --- | --- |
| `crates` | `e7800135bfa0346b72af26b70f2881508b7f242e` |
| `packages` | `5ad3915e1bd1fa2d5d903328fcad342451c166a3` |
| `packaging` | `8540235376e9d6252dc902f526f2b716a75422c3` |

| package | target | run and artifact | archive | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `@binary-balance/seshat-linux-x64` | `linux-x64` | [45577881967](https://github.com/Binary-Balance/seshat/actions/runs/45577881967), `linux-x64-package-proof` | `seshat-linux-x64-release.tgz` | 1,186,211 | `8865c348f3edd30d743dbae638937a4b18b7a4cfe1efb1860a764b152fc2c76b` |
| `@binary-balance/seshat-linux-arm64` | `linux-arm64` | [45577882131](https://github.com/Binary-Balance/seshat/actions/runs/45577882131), `linux-arm64-package-proof` | `seshat-linux-arm64-release.tgz` | 1,118,134 | `d7e582515aea814927cd9d15e5579a98ccb543e8e76af0e3b39ac7c8525ade0b` |
| `@binary-balance/seshat-darwin-x64` | `darwin-x64` | [45577881792](https://github.com/Binary-Balance/seshat/actions/runs/45577881792), `macos-x64-package-proof` | `seshat-darwin-x64-release.tgz` | 1,123,524 | `56d7bedf987d0a277e4f7644fb1df54801e3cda3a432bcebdfc8c98f440d03f3` |
| `@binary-balance/seshat-darwin-arm64` | `darwin-arm64` | [45577881792](https://github.com/Binary-Balance/seshat/actions/runs/45577881792), `macos-arm64-package-proof` | `seshat-darwin-arm64-release.tgz` | 1,086,622 | `f52b4539947ea904e01a4e0eab19306695dbae7623f46b139173a6e0a4c8175b` |
| `@binary-balance/seshat-win32-x64` | `win32-x64` | [45577882160](https://github.com/Binary-Balance/seshat/actions/runs/45577882160), `windows-x64-package-proof` | `seshat-win32-x64-release.tgz` | 1,148,569 | `165cdf9dc4ecdb1466d729559e1e6ec709f292a8560b58a7115adc8fd1adb362` |
| `@binary-balance/seshat-linux-x64-musl` | `linux-x64-musl` | [45577881743](https://github.com/Binary-Balance/seshat/actions/runs/45577881743), `alpine-prerequisites-x64` | `seshat-linux-x64-musl-release.tgz` | 1,240,664 | `566b724eefbea4f83975489d50f88cc7b919f3afe85d8e2294017a327aaeef35` |
| `@binary-balance/seshat-linux-arm64-musl` | `linux-arm64-musl` | [45577881743](https://github.com/Binary-Balance/seshat/actions/runs/45577881743), `alpine-prerequisites-arm64` | `seshat-linux-arm64-musl-release.tgz` | 1,167,912 | `76a2f246a5ff1cdb8a6e28cb100e557ad36616f9343fed9cc00607ca86d9a0d8` |
| `@binary-balance/seshat` | `universal` | [45577881967](https://github.com/Binary-Balance/seshat/actions/runs/45577881967), `linux-x64-package-proof` | `seshat-entry.tgz` | 6,840 | `9435de0f6970ea2d87fa61df59e67d0923a127630fa897bbb95c597da4441161` |

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
| `linux-x64` | `package/bin/seshat`, 2,604,128 bytes, `f8f5a713d89aa1783598a571c31297094d689904ea488754821f014e1c891535`, `0755` | 9,953 bytes, `3894b865cc8cb187f923112b3bd4162cba7a0722e7ec670686956dd08efbfefe` | 498 bytes, `c856e3dcefc93d5e3547954b1d49582eb5f3559fc61e0f1fe81d74f02fa480a4` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-arm64` | `package/bin/seshat`, 2,310,864 bytes, `7e7edc1aaccd88416bba69b7de26519c4322e45ba6382d020b8273a173b34874`, `0755` | 9,428 bytes, `bfacab53aa21917a9a2229fc5bd21ae88e7f842125a1f0602da6084ec1f34702` | 504 bytes, `240164bfd46eaff1f44c134c503347f7ced78ddf3619b5007aac15fe5fc3cfab` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-x64` | `package/bin/seshat`, 2,408,536 bytes, `faae6841b8a4fe15d8052fa0074fae1f0f6e9c25b99ed43011ff39c2472b24ae`, `0755` | 9,386 bytes, `cbadd6918aa7d68cbf024269f3386c49aca793cd2c36cdb1944613e6686f9c77` | 472 bytes, `8d3f008833376f8fdfb8f73f39e2480281c4d4a2f550e1f32d8e14bcc5d982c0` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `darwin-arm64` | `package/bin/seshat`, 2,306,976 bytes, `e73c6157f85c3c3b6417c627f88ba0c85caa623bb2ca101ecf9314965e51b3cd`, `0755` | 9,390 bytes, `fcd605ccf2b21df49bbe886ab1b5e37e06efcb4149a399d4aee3b068a3af0b9e` | 478 bytes, `4623629c4816d35e0160cc6f6f4b0cbe9162e8300b90858041c2995bf2178947` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `win32-x64` | `package/bin/seshat.exe`, 2,738,688 bytes, `15669793a0abc68c568701c340c7b16e77588cb763622bb65643bf810c82d88d`, `0644` | 10,225 bytes, `647afb9709af4493261cb50f9e65eecbe03fd47e262104b65b574c39c2ec46ac` | 473 bytes, `58a81030888383bc2f8e19030051654d9adf0aa088389ed8353fd0f56d638b3f` | 2,057,917 bytes, `890de6ea484f036b81a26b4b9bc42e926c2efc32a35344ec156a20f9bba1f3f8` |
| `linux-x64-musl` | `package/bin/seshat`, 2,675,352 bytes, `f07b6351d0bc1de5af3fca604f03268641a26049508e8add72f3f1543c952b4f`, `0755` | 14,517 bytes, `a550dda7c688889b1e6c039c35b2a8c7ec9bf5f2e6c4f4b9b2a436a0ad1d2034` | 507 bytes, `46e175a1d3a8242b50c6dd5f94347d4a6ab5cd5045c7178757918755afdc1fac` | 2,103,056 bytes, `d8b1e857007b65345ac5690310188b6112bde332b81b1faf11c204d645aef927` |
| `linux-arm64-musl` | `package/bin/seshat`, 2,363,528 bytes, `2ef2decdef4476ec23a0e3e368a601bf7158cecd9bf37f4a8416ef19f84add30`, `0755` | 14,519 bytes, `6a1037200efef3ec1e1d6403230802d14a1a15a939fb5b60b588034e64548011` | 513 bytes, `fb2ed98f33195a5b000d84d512b0c4af6fce66e798616f13bcd6e4c7b72f4bea` | 2,103,056 bytes, `d8b1e857007b65345ac5690310188b6112bde332b81b1faf11c204d645aef927` |

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

[Run 45577881681](https://github.com/Binary-Balance/seshat/actions/runs/45577881681) passed the runtime proof.

Scenarios: `baseline`, `timeout`, `overflow`, `leaderExit`, `leaderExitRepeat`, `consoleCancellation`.

## Remaining checks

- Run the release local install workflow on all 7 targets.
- Run the read-only publisher dry run against the 8 staged archives and the reviewed revision.
- After publication, verify the 8 registry versions, tarball bytes and provenance against this audit.
- Create the GitHub release with the 8 audited archives.
