# Runner compatibility

Current source accepts the following explicit combinations. The Node 24.21.0
expansion is unreleased; the published 0.1.0 archives still accept only 24.20.0.
No other Node or runner version is implicitly supported.

| Runner | Node versions | Runner and coverage dependencies |
| --- | --- | --- |
| Node test runner | 24.20.0, 24.21.0 | Checked-in TypeScript/Istanbul collector |
| Jest/Expo | 24.20.0, 24.21.0 | Jest 29.7.0, jest-expo 57.0.5, Expo 57.0.20, Jest Circus and Babel coverage |
| Vitest | 24.20.0, 24.21.0 | Vitest 5.0.0 and @vitest/coverage-istanbul 5.0.0 |

The exact fixture dependencies remain locked. This change adds one Node minor
version and does not expand Jest, Expo or Vitest versions, CPU targets or OS
support.

## Version checks

The native CLI validates the receipt format, execution identity and runner
identity before accepting version evidence. An unsupported version names the
component, actual version and supported versions. Missing or invalid version
fields produce a separate receipt error. Jest and Vitest checks include the
executing versions, so a matching package in the working directory cannot hide
an unsupported runner launched elsewhere. Invalid receipts never provide a kill
or a complete score.

JSON retains each job mismatch; human output also shows baseline and coverage
mismatches. The Node load-failure observer
uses the same explicit Node set; unsupported runtimes cannot supply observer
evidence. Format, execution and runner identity failures take precedence over
version mismatches.

Package `engines.node` and the checked-in example manifests use
`24.20.0 || 24.21.0`. The npm launcher can start a native binary, but it cannot
establish which runtime a configured shell wrapper or test command will use.
Runtime validation therefore uses the first actual runner receipt. It does not
infer support from the launcher's Node version or a dependency range in a
manifest. A baseline mismatch stops mutation from beginning; coverage and
mutant jobs also validate their own receipts.

## Retained checks

The native package workflows build and exercise the existing 24.20.0 baseline.
They then select Node 24.21.0 and run the same package through
[`runner-compatibility.mjs`](../benchmarks/proofs/runner-compatibility.mjs) on
Linux x64/ARM64, macOS x64/ARM64 and Windows x64. The second pass reuses the
package bytes rather than repeating the native build.

Each pass records runtime/platform/architecture, native and archive hashes,
per-check success and logs under `node-24.21.0` in the package evidence artifact.
It covers:

- CLI baseline and coverage, assertion kills, survivors, malformed/replayed
  receipts, unsupported versions, timeout, cancellation and source preservation.
- Parallel cancellation and cleanup.
- Node import-failure evidence, caught/reused errors, setup failures, custom
  stacks, Unicode/CRLF coordinates and mixed application/setup failures.
- Installed Jest/Expo and Vitest coverage, assertion kills, survivors, setup
  hooks, import failures, test timeouts and hook timeouts.

Run a pass from the repository root after the normal package build and fixture
installation, selecting the Node executable and its directory on `PATH`:

```sh
node benchmarks/proofs/runner-compatibility.mjs \
  work/x64/package-result.json benchmarks/proofs/fixtures/jest-expo
```

The first argument is the JSON produced by `packaging/pack.mjs`; the optional
second argument reuses installed Jest/Expo fixture dependencies. Run the command
under both supported Node versions to compare the same package locally. The
existing `npm-package.mjs` proof separately exercises the entry launcher and
public examples. Packaging preflights and historical release reports keep their
original Node 24.20.0 build environment.
