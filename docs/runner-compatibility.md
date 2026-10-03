# Runner compatibility

Seshat supports stable Node versions `>=24.20.0 <25`. Later Node 24
patch and minor releases are accepted without a Seshat update. Node 25 and
prereleases are outside this range. Version 0.1.0 accepts only Node
24.20.0.

24.20.0 is the verified minimum, not a claim that every integration needs an API
introduced in that release. Earlier Node 24 versions require additional testing;
some locked runner dependencies require at least 24.11.0.

| Runner | Supported Node range | Runner and coverage dependencies |
| --- | --- | --- |
| Node test runner | >=24.20.0 <25 | Checked-in TypeScript/Istanbul collector |
| Jest/Expo | >=24.20.0 <25 | Jest 29.7.0, jest-expo 57.0.5, Expo 57.0.20, Jest Circus and Babel coverage |
| Vitest | >=24.20.0 <25 | Vitest >=5.0.0 <6 and the matching @vitest/coverage-istanbul |

The Jest and Expo dependencies remain locked. This policy does not expand Jest
or Expo versions, CPU targets or OS support. Node 24.20.0 and 24.21.0 have passed
the native compatibility matrix; that tested set is distinct from the supported
Node range.

## Vitest range

Seshat accepts stable Vitest versions `>=5.0.0 <6`. Later Vitest 5 releases are
accepted without a Seshat update. Other major versions and prereleases are
rejected, because the adapter extends Vitest's own test runner and matches its
timeout messages, which a new major version can change. Version 0.1.0 accepts
only Vitest 5.0.0.

Vitest 5.0.0 and 5.0.3 have passed the 23 checks in
[`vitest-check.mjs`](../benchmarks/proofs/vitest-check.mjs), each with the
matching `@vitest/coverage-istanbul`, with the same verdicts on both. That
tested set is distinct from the supported range. The 5.0.3 run was on Linux x64
with Node 24.21.0; the package workflows keep the fixtures locked to 5.0.0 on
every platform.

To check another Vitest 5 release, install the proof dependencies with that
version into a separate directory and pass it with `--deps`:

```sh
node benchmarks/proofs/vitest-check.mjs \
  --cli /absolute/path/to/seshat --deps /absolute/path/to/dependencies
```

## Import-failure observer

The Node adapter's import-failure observer remains enabled only on Node 24.20.0
and 24.21.0. It depends on experimental module tracing, test-process markers and
stack-formatting behaviour. A passing general compatibility run does not
implicitly expand this observer's verified versions.

On another supported Node version, normal tests and coverage still run. An
assertion failure can still kill a mutation. An import crash that would need the
observer to prove it came from the mutated application is reported as an
execution error, leaving that mutation unresolved and the overall score
incomplete. It is never silently counted as a kill. Setup errors remain errors.

## Version checks

The native CLI validates the receipt format, execution identity and runner
identity before accepting version evidence. An unsupported Node version names
the actual version and supported range. Missing or malformed version fields
produce a separate receipt error. Jest and Vitest checks include the executing
versions, so a matching package in the working directory cannot hide an
unsupported runner launched elsewhere. Invalid receipts never provide a kill
or a complete score.

JSON retains each job mismatch; human output also shows baseline and coverage
mismatches. Format, execution and runner identity failures take precedence over
version mismatches.

Package `engines.node` and the checked-in example manifests use
`>=24.20.0 <25`. The npm launcher can start a native binary, but it cannot
establish which runtime a configured shell wrapper or test command will use.
Runtime validation therefore uses the first actual runner receipt. It does not
infer support from the launcher's Node version or a dependency range in a
manifest. A baseline mismatch stops mutation from beginning; coverage and
mutant jobs also validate their own receipts.

## Retained checks

The native package workflows keep Node 24.20.0 pinned for reproducible builds
and baseline checks. They then select the latest Node 24 release and run the same
package through [`runner-compatibility.mjs`](../benchmarks/proofs/runner-compatibility.mjs)
on Linux x64/ARM64, macOS x64/ARM64 and Windows x64. The second pass reuses the
package bytes rather than repeating the native build.

Each pass records the resolved runtime, platform, architecture, native and
archive hashes, per-check success and logs under `node-VERSION` in the package
evidence artifact. It covers:

- CLI baseline and coverage, assertion kills, survivors, malformed/replayed
  receipts, unsupported versions, timeout, cancellation and source preservation.
- Parallel cancellation and cleanup.
- Node import-failure evidence where verified, and conservative fallback
  elsewhere; caught/reused errors, setup failures, custom stacks, Unicode/CRLF
  coordinates and mixed application/setup failures.
- Installed Jest/Expo and Vitest coverage, assertion kills, survivors, setup
  hooks, import failures, test timeouts and hook timeouts.

Synthetic version controls exercise the disabled-observer fallback on every run.
They are guard regressions, not execution evidence for an unreleased Node version.

Run a pass from the repository root after the normal package build and fixture
installation, selecting the Node executable and its directory on `PATH`:

```sh
node benchmarks/proofs/runner-compatibility.mjs \
  work/x64/package-result.json benchmarks/proofs/fixtures/jest-expo
```

The first argument is the JSON produced by `packaging/pack.mjs`; the optional
second argument reuses installed Jest/Expo fixture dependencies. The existing
`npm-package.mjs` proof separately exercises the entry launcher and public
examples. Packaging preflights and historical release reports keep their
original Node 24.20.0 build environment.
