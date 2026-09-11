# Linux ARM64 preflight protocol

This protocol covers the first bounded slice of issue 2. It checks the native
host that will later carry the Linux ARM64 build and installation proof. It does
not build Seshat, install an npm package, or claim support for the current
x64-only package.

## Candidate host

GitHub's public-runner table lists `ubuntu-22.04-arm` and `ubuntu-24.04-arm` as
standard four-CPU, 16 GB ARM64 runners. Standard runners are free for public
repositories. The repository is public. At selection time, the GitHub REST API
reported Actions enabled for all actions, zero self-hosted runners and zero
workflows. The last value describes the repository before this workflow was
added.

`ubuntu-22.04-arm` is the candidate because it is the oldest available,
maintained standard hosted ARM64 runner. Ubuntu 22.04 has standard security
maintenance through May 2027, and Jammy's `libc6` package provides glibc 2.35.
The preflight checks those exact values at runtime.

Node 24.20.0 lists GNU/Linux ARM64 as Tier 1 with upstream requirements of
kernel 4.18 or newer and glibc 2.28 or newer. Those are Node's upstream
requirements. This protocol records the runner's actual kernel and does not
turn them into a Seshat minimum. It also does not claim that Seshat is installed
or supported on this host.

Sources: [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[Ubuntu release cycle](https://ubuntu.com/about/release-cycle),
[Ubuntu Jammy libc6](https://packages.ubuntu.com/jammy/libc6), and
[Node 24.20.0 build requirements](https://github.com/nodejs/node/blob/v24.20.0/BUILDING.md).

## Workflow and report

The workflow uses read-only `contents` permission and no secrets. It runs on
pull requests that touch this workflow, the preflight script or this protocol,
and on matching pushes to `main`. Manual dispatch is available for later
reruns. The only actions are pinned to these GitHub API-verified commits:

| Action | Commit |
| --- | --- |
| `actions/checkout` | `11d5960a326750d5838078e36cf38b85af677262` |
| `actions/setup-node` | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| `actions/upload-artifact` | `ea165f8d65b6e75b540449e92b4886f43607fa02` |

After Node 24.20.0 is selected, the workflow runs the small dependency-free
script at
[`benchmarks/proofs/linux-arm64-preflight.mjs`](../benchmarks/proofs/linux-arm64-preflight.mjs).
The script records exact OS release data, `process.arch`, independent `uname`
architecture, kernel release, glibc, Node, npm, available compiler and
toolchain versions, Rust host when `rustc` exists, POSIX `kill` availability,
the runner image variables, and GitHub workflow, run and source provenance.
It writes a portable JSON report and uploads it even when validation fails.

The script fails explicitly for a non-Linux host, a non-ARM64 process or
`uname`, a non-Ubuntu 22.04 userspace, glibc other than 2.35, Node other than
24.20.0, unavailable `kill`, or a Rust host other than
`aarch64-unknown-linux-gnu`. Missing Rust is recorded as unavailable and is not
installed by this check.

Run the validation branches locally without a framework or dependency install:

```sh
node benchmarks/proofs/linux-arm64-preflight.mjs --self-check
```

## Remaining issue 2 acceptance

This preflight does not satisfy the rest of issue 2. The later platform proof
still needs a native build, npm and standalone installed checks without a
consuming Rust toolchain, source capture and workspace-link checks, runner
deadlines, cancellation and process cleanup, CLI JSON, thresholds and failure
exit checks, and retained evidence with hashes. Those results belong in a
separate evidence milestone after the host has passed this preflight.
