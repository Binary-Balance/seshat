# Linux x64 package protocol

This is the remaining native Linux x64 slice of issue 2. It reruns the x64
package after shared runtime changes settle, while preserving the existing
Debian 11/glibc 2.31 build route.

The candidate is deliberately bounded:

- GitHub `ubuntu-22.04`, native `x86_64`, Ubuntu 22.04/Jammy and host glibc
  2.35.
- Rust 1.98.1, Node 24.20.0 and npm 11.19.0.
- The package is linked against the pinned Debian 11 libraries and keeps the
  glibc 2.31 ceiling and x64 ELF machine `62` assertion.
- The workflow records the actual host kernel and fails below the candidate
  Linux 6.8 kernel family. It records the exact patch; it does not boot an
  older kernel or claim that every 6.8 patch is identical.

The native Ubuntu host is useful for the build and installed checks. The
minimum-userspace check is separate: `linux-debian.mjs` extracts the pinned
Debian 11 rootfs and Node 24.20.0 archive, then runs both installed routes in a
Bubblewrap network namespace with no host libraries, Cargo or Rustc mounted.
Debian 11 LTS ended on 2026-08-31, so this is a pinned compatibility snapshot,
not a claim that Debian 11 remains a maintained distribution.

## Workflow proof

The workflow records `preflight.json`, package metadata, both archive hashes,
native npm and standalone reports, the Debian11 report, raw logs, Rust tests and
`summary.json`. It never uploads Cargo's target directory. The summary is
fail-closed: missing or invalid reports, a missing archive, a changed hash, a
kernel below 6.8, or an incomplete proof leaves `validation.passed` false and
the workflow failed.

The native checks are:

- Rust tests from the locked Cargo graph on the x64 host.
- The x64 package built with `pack.mjs` and the three existing pinned Debian
  build archives. The packer continues to verify their SHA-256 values.
- The npm route's 16 package checks and 43 installed CLI scenarios.
- A standalone archive made from the exact six-file package payload, with the
  same 43 CLI scenarios and 11 parallel process controls. Both consumers run
  with a disposable `PATH` where Cargo and Rustc are absent.

The Debian11 proof repeats the npm route and the generated standalone route in
the isolated userspace. It records the same CLI/process controls, glibc 2.31,
the actual shared host kernel and archive hashes. Ubuntu-only installation
success is therefore not used as the minimum-userspace result.

## Local checks

These checks do not require a package build:

```sh
node benchmarks/proofs/linux-x64-preflight.mjs --self-check
node benchmarks/proofs/linux-x64-summary.mjs --self-check
node --check benchmarks/proofs/linux-debian.mjs
```

The hosted workflow is the evidence milestone for the native Ubuntu 22.04
environment. No x64 hosted result or hash is recorded here until that workflow
has completed successfully; the retained artifact's summary is the source of
the actual runner, kernel, userspace, package and proof values.

This protocol does not establish support for glibc below 2.31, musl, another
Linux userspace, macOS or Windows. It also does not publish the private npm
candidate or close issue 2.
