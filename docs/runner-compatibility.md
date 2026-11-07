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
| Jest | >=24.20.0 <25 | Jest, jest-runner, Jest Circus, babel-jest and jest-environment-node or jest-environment-jsdom 29.7.0; Babel coverage |
| Jest/Expo | >=24.20.0 <25 | Jest 29.7.0, jest-expo 57.0.5 or 57.0.6, Expo 57.0.20, Jest Circus and Babel coverage |
| Vitest | >=24.20.0 <25 | Vitest >=5.0.0 <6 and the matching @vitest/coverage-istanbul |

The Jest and Expo dependencies remain locked to the versions listed above.
This policy does not expand CPU targets or OS support. Node 24.20.0 and
24.21.0 have passed the native compatibility matrix; that tested set is distinct
from the supported Node range.

## Plain Jest

The [plain Jest example](../examples/jest) uses Babel's TypeScript preset and
CommonJS transform, with no Expo dependency. The default node environment and
explicit jsdom environment both pass baseline, source-mapped coverage and
mutation checks under replacement and experimental switching. The
[proof](../benchmarks/proofs/jest-check.mjs) also checks unsupported versions,
custom environments/transforms, V8 coverage, multiple projects, failed baselines
and a docblock that bypasses the evidence wrapper. See the
[recorded evidence](../outputs/plain-jest.md).

Keep `--env={seshatEnvironment}` in each command. Before Jest starts, Seshat
runs the same Jest CLI with `--showConfig`, removing that override, and wraps
the original resolved environment. Config discovery is limited to 15 seconds
and 1 MiB of output. It adds a fresh Jest configuration process per test job;
`configDiscoveryMs` in runner receipts records that cost. Configuration files
must be deterministic and safe to evaluate twice. Other Jest CLI options,
environment options and the project's Babel setup remain in effect.

Only one project, the standard Jest runner and Circus 29.7.0, Babel coverage
and babel-jest 29.7.0 transforms are supported on this route. Custom environments
and per-file `@jest-environment` overrides are unverified. A file that bypasses
Seshat's wrapper cannot provide its event sidecar and leaves the run incomplete.
ts-jest and other Jest versions remain unsupported.

Plain Jest test-file selection is not claimed here. Its receipts omit the
Expo-only selection evidence, so each mutant runs the full configured command
and, with selection enabled, reports `missing-test-files`. This does not weaken
baseline or coverage validation. The Expo selection route remains unchanged.

## Jest/Expo versions

Seshat accepts exactly jest-expo 57.0.5 and 57.0.6 with Jest 29.7.0 and the
Expo dependencies listed above. Other patches, SDK versions and prereleases
remain rejected. Both the executing preset and the working-directory package
must report an accepted version.

The checked-in proof fixture and public example pin 57.0.6. Both accepted
versions passed all 24 cases in
[`jest-expo-check.mjs`](../benchmarks/proofs/jest-expo-check.mjs) on Linux x64
with Node 24.22.0. The [verification report](../outputs/jest-expo-57.0.6.md)
records the commands, receipts and controls. To rerun either version, pass its
installed dependency directory with `--deps`. The driver accepts only these two
jest-expo versions and keeps the other dependencies pinned.

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

The Node adapter's import-failure observer is enabled on stable Node versions
`>=24.20.0 <25`. It depends on experimental module tracing, test-process markers
and stack-formatting behaviour. Each latest-node compatibility pass must prove
an active observer and an attributable application import failure counted as a
kill. Its summary records the actual runtime, observer state and verdict.

If a newer Node 24 breaks that proof, the latest-node job fails. Restore a
deliberate version pin and record the failing runtime here before shipping that
change. Do not accept disabled-observer fallback as a passing compatibility
proof. Unsupported runtime receipts remain errors.

An import crash without evidence that it came from the mutated application is
an execution error, leaving that mutation unresolved and the overall score
incomplete. Setup errors remain errors.

Each `diagnostics.runnerVersions` setup row includes `importFailureObserver`.
For Node, `state` is `active` with `reason: null` in the supported range,
or `inactive` with `reason: "node-version"` on an unsupported or unavailable observed
version. Jest and Vitest report `inactive` with `reason: "runner"`; this Node
observer does not describe those adapters' own failure reporting. The observed
version comes from a validated baseline receipt, or coverage when no baseline
receipt is available. Readable output explains inactive entries.

This state describes the runtime gate. The verified route uses Node's default
process isolation and loader configuration; an active entry does not guarantee
that a crash meets the observer's attribution checks. Missing observation
records and ambiguous failures remain unresolved even when this gate is active.

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
and baseline checks. They then select the latest Node 24 release and run a
package through [`runner-compatibility.mjs`](../benchmarks/proofs/runner-compatibility.mjs)
on Linux x64/ARM64, macOS x64/ARM64 and Windows x64.

On Linux x64/ARM64, macOS x64 and Windows x64, a `latest-node` job runs this
pass beside the package job, so the package job no longer waits for it. It
builds the same commit with the same pinned toolchain. macOS ARM64 runs the pass
at the end of its package job instead, reusing that job's package. It still
finishes before macOS x64, and it saves one of the five concurrent macOS runners
on GitHub's Free plan.

Each pass records the resolved runtime, platform, architecture, native and
archive hashes, per-check success and logs under `node-VERSION`. The
`latest-node` jobs upload them as `*-latest-node` artifacts; macOS ARM64 keeps
them in its package evidence artifact. A `latest-node` job's `summary.json`
`binarySha256` matches `binary` in the package job's `package-result.json` when
both jobs built the same binary. `tarballSha256` can differ on macOS and Windows
even then, because their `BUILD.json` records runner image and toolchain
details. Each pass covers:

- CLI baseline and coverage, assertion kills, survivors, malformed/replayed
  receipts, unsupported versions, timeout, cancellation and source preservation.
- Parallel cancellation and cleanup.
- Active Node import-failure evidence; caught/reused errors, setup failures,
  custom stacks, Unicode/CRLF
  coordinates and mixed application/setup failures.
- Installed Jest/Expo and Vitest coverage, assertion kills, survivors, setup
  hooks, import failures, test timeouts and hook timeouts.
- Jest/Expo automatic Testing Library cleanup counts as a kill when every error
  belongs to a failed test's hook. A mixed hook and file-load failure still
  stops scheduling.

Synthetic version controls exercise the disabled-observer guard. They are guard
regressions, not execution evidence for an unreleased Node version. CLI checks
match the reported observer state to the actual import-crash verdict and verify
that missing observation records stay unresolved. Jest and Vitest checks retain
the `runner` reason.

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
