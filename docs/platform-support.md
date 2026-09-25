# Native platform support

This is the historical platform acceptance matrix for issue 2. All five native
package proofs passed on 2026-09-11 from tested merge source
[`0edd0a3a546d2a94f8ddac59aa52123a22c821c8`](https://github.com/Binary-Balance/seshat/commit/0edd0a3a546d2a94f8ddac59aa52123a22c821c8).
Its complete Git tree matches merged `main`
[`b1a35c594854cbb0f9958be90ec254902b56a9c9`](https://github.com/Binary-Balance/seshat/commit/b1a35c594854cbb0f9958be90ec254902b56a9c9);
the tested merge tree was therefore the implementation merged at that point. The
pull-request head recorded by the workflows was
`97a19aa27ac7c78e95ccf3dcfac68befbabf3460`.

For published 0.1.0 package identities and subsequent unreleased changes, see
the [current project status](../README.md#release-status). The identities below
belong to the earlier issue 2 proof, not the published archives.

Each row links the final GitHub run, job and artifact. GitHub retains these raw
artifacts until 2026-12-10T08:21:24Z. The committed [normalized record](../outputs/platform-support.json)
keeps the source, host, toolchain, hashes, counts and pass gates after those
downloads expire.

| Target | Native host, target and floor | Final evidence | Installed proof |
| --- | --- | --- | --- |
| Linux x64 | Ubuntu 22.04.5/glibc 2.35 host, `x86_64-unknown-linux-gnu`, ELF machine `62`; pinned Debian 11/glibc 2.31 userspace; Linux `6.8.0-1064-azure` (oldest tested series) | [run 34578770930](https://github.com/Binary-Balance/seshat/actions/runs/34578770930), [job 103197240824](https://github.com/Binary-Balance/seshat/actions/runs/34578770930/job/103197240824), [artifact](https://github.com/Binary-Balance/seshat/actions/runs/34578770930/artifacts/10191037534) | npm and standalone, no Cargo/Rustc; CLI 43, parallel 11, Jest/Expo 4/4, Vitest 4/4, lifecycle 11/11 |
| Linux ARM64 | Ubuntu 22.04.5/glibc 2.35, `aarch64-unknown-linux-gnu`, ELF machine `183`; Linux `6.8.0-1064-azure` (oldest tested series) | [run 34578770757](https://github.com/Binary-Balance/seshat/actions/runs/34578770757), [job 103197240097](https://github.com/Binary-Balance/seshat/actions/runs/34578770757/job/103197240097), [artifact](https://github.com/Binary-Balance/seshat/actions/runs/34578770757/artifacts/10190932097) | npm and standalone, no Cargo/Rustc; CLI 43, parallel 11, Jest/Expo 4/4, Vitest 4/4, lifecycle 11/11 |
| macOS x64 | macOS 15.7.9 native x64, `x86_64-apple-darwin`, Mach-O; deployment target `15.0`, SDK `15.5` | [run 34578770831](https://github.com/Binary-Balance/seshat/actions/runs/34578770831), [job 103197240025](https://github.com/Binary-Balance/seshat/actions/runs/34578770831/job/103197240025), [artifact](https://github.com/Binary-Balance/seshat/actions/runs/34578770831/artifacts/10191201858) | npm and standalone, no Cargo/Rustc; CLI 43, parallel 11, Jest/Expo 4/4, Vitest 4/4, lifecycle 11/11 |
| macOS ARM64 | macOS 15.7.9 native ARM64, `aarch64-apple-darwin`, Mach-O; deployment target `15.0`, SDK `15.5` | [run 34578770831](https://github.com/Binary-Balance/seshat/actions/runs/34578770831), [job 103197240243](https://github.com/Binary-Balance/seshat/actions/runs/34578770831/job/103197240243), [artifact](https://github.com/Binary-Balance/seshat/actions/runs/34578770831/artifacts/10191030456) | npm and standalone, no Cargo/Rustc; CLI 43, parallel 11, Jest/Expo 4/4, Vitest 4/4, lifecycle 11/11 |
| Windows x64 | Windows Server 2022 Datacenter build `20348`, `x86_64-pc-windows-msvc`, PE32+, static CRT | [run 34578770812](https://github.com/Binary-Balance/seshat/actions/runs/34578770812), [job 103197240188](https://github.com/Binary-Balance/seshat/actions/runs/34578770812/job/103197240188), [artifact](https://github.com/Binary-Balance/seshat/actions/runs/34578770812/artifacts/10191061364) | npm and standalone, no Cargo/Rustc; CLI 43, parallel 11, Jest/Expo 4/4, Vitest 4/4, Windows lifecycle 6/6 |

The Linux 6.8 entry is the oldest tested hosted kernel series. It does not
claim that kernels below 6.8 are incompatible. The macOS deployment target
15.0 is distinct from the observed 15.7.9 host version, and the Windows row is
native Server evidence; desktop Windows is outside the claim.

The final package identities are:

| Target | npm and standalone archive SHA-256 / bytes | Extracted binary SHA-256 / bytes | `BUILD.json` SHA-256 / bytes |
| --- | --- | --- | --- |
| Linux x64 | `d7119c9ff3d57ab852a0d0e8d6e57849b872f6c6f9a5293283a0395c2aa13f69` / 906,584 | `0a2af3a7f412b7f8ea6e9ef18ae2124a7fc4fbf53105a6c466ae621bd91fba23` / 2,026,496 | `38440c9abb91510696411168d3a0de014b21f0dce270f13ecb8fed0fcdcd991f` / 7,720 |
| Linux ARM64 | `c9fa2f430479d2934738d6bc3df5e486091da3de9d1861f230728659ba0a2b5d` / 862,472 | `1875ee97580d955079313e3ca4181cd96acb8b32db4488b540093adc963e6da0` / 1,815,248 | `e7308a6b07cfb2c8d29cf84676589d202d8e0e10915c033a0c374907e213a6dc` / 7,193 |
| macOS x64 | `a6aa3f8b80ea9c94995ab8fe3191dc5318c0a9d0af3617bcbe51deed5ad0b01f` / 858,410 | `069dcc588b30be6034343599eb830b9005088110efd816ac280e0409bca00883` / 1,867,488 | `b921ae331a4fdb4b1b0cb4f965fc43b9669b3354172e9edf387a8320374d13e5` / 7,152 |
| macOS ARM64 | `4de118e36f9b173c093f508da2437ba05756671e6b47786ce6798ef14e7a8e6d` / 838,416 | `39baf5a607bc210ad340ccfa88267d23918cabac33ecba19c7c86c4d8110b0c7` / 1,823,648 | `554fe3c012e173bc280396d7b4676f6e4b5b30218926ab6942dcbfdb59741f0e` / 7,154 |
| Windows x64 | `5b7651eb45900ab291b2434175a195d77870a06d8fc84523a6306056cdf0e33d` / 880,937 | `ab2e49aacd41c34b0e256eaddbb61a4c728801e141bea3381b9e74ee3408a912` / 2,066,944 | `e807c04e5518b43c1bfc3de831a89ae7df4076dd84eeccedf23c080c22f515f7` / 8,054 |

Every target passed two clean non-LTO pack invocations. Each pair matched the
native binary, `BUILD.json`, npm archive and standalone archive byte-for-byte;
the installed archive and executable matched the same retained identities. The
build profile is the source-controlled `lto = "off"`, `strip = "symbols"` profile.
The normalized record includes the Cargo.lock hash, native library or PE import
audit, exact runner image, and the per-target repeat comparisons.

The shared installed proofs use the same fixtures on every target: 43 CLI
scenarios with JSON output, threshold boundaries, incomplete-run and failure
exit checks; 11 parallel controls; Jest/Expo cases
`normal-1,assertion-kill,survivor,before-all`; and Vitest cases
`stack,assertion,survived,before-all`. The npm route also checks offline install,
package scripts, `npm exec`, workspace installation where supported, source
preservation and archive identity. The standalone route lists and extracts the
same archive, then runs the binary without npm. Both routes remove Cargo and
Rustc from the consuming environment. The native lifecycle proofs retain
deadlines, output overflow handling, descendant cleanup and empty scratch
directories. Unix uses SIGINT/SIGTERM with exits 130/143; Windows uses
`CTRL_BREAK_EVENT` through the native console helper and makes no POSIX signal
claim.

The exact issue 2 acceptance mapping is:

| Criterion | Retained evidence |
| --- | --- |
| Compatibility floor and runtime libraries | Per-target host, target, OS/userspace, kernel or deployment target, glibc symbols, macOS system libraries, and Windows PE imports in the normalized record and `BUILD.json`. |
| Reproducible native builds and both package routes | Two matching clean packs per target, with the installed archive bound to the same npm/standalone, binary and `BUILD.json` hashes. |
| No Rust in consuming projects | Both installed routes pass Cargo/Rustc absence probes; Rust appears only in the native build environment. |
| Capture, workspace links, deadlines and cleanup | Installed CLI and lifecycle reports cover source copies, workspace/link handling, bounded jobs, cancellation, descendants and scratch cleanup. |
| CLI and runner behavior | CLI 43, parallel 11, Jest/Expo 4/4 and Vitest 4/4 pass gates on every target; Windows has no summary gaps. |
| Scope and publication boundaries | Windows ARM64 and Alpine Linux are outside this release. At this checkpoint, signing, notarization and public npm publication were outside the proof. |

The detailed per-target protocols are [Linux x64](linux-x64-package.md),
[Linux ARM64](linux-arm64-package.md), [macOS](macos-package.md) and
[Windows x64](windows-package.md). No public npm package or signed/notarized
release artifact is claimed by this matrix.
