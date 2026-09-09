# Matched Stryker Node workspace comparison protocol

This proof compares the installed Seshat `mutate` route with StrykerJS
10.0.0 on the same small Node workspace. It is a mutation execution
comparison for this fixture only. It is not a full `check` comparison, a CRAP
comparison, a coverage comparison or a production performance claim.

## Fixture

Both tools use the exact workspace emitted by the shared fixture writer. The
workspace contains these two source files:

```text
src/compare.ts:
export const adult = (age: number) => age >= 18;

packages/rules/index.ts:
export const answer = () => 42;
```

The existing `tests/check.mjs`, `tsconfig.json`, package metadata and
`node_modules/@seshat/rules -> ../../packages/rules` symlink are unchanged.
The TypeScript project remains `noEmit: true`; Node runs the `.ts` imports with
its native type stripping. Neither side builds JavaScript output.

Stryker mutates exactly `src/compare.ts` and `packages/rules/index.ts`, with
only `EqualityOperator` active. The other built-in mutators are explicitly
excluded. Stryker keeps excluded placements in its JSON report as `Ignored`;
those records are outside the active comparison and must use the configured
exclusion list. The expected active set is:

| Path | Byte offset | Original | Replacement | Verdict |
| --- | ---: | --- | --- | --- |
| `src/compare.ts` | 42 | `>=` | `>` | killed |
| `src/compare.ts` | 42 | `>=` | `<` | killed |

The package rule source is included in Stryker's source selection to keep the
source workload matched, but it must produce no additional active mutants. Any
additional active file, mutator, operator, verdict or unresolved result fails
the proof.

## Workload and timing

Original TypeScript checking is mandatory and timed on both sides. Seshat's
`mutate` command runs its configured `tsc --project tsconfig.json` internally.
The Stryker invocation is preceded by the same pinned compiler command and the
compiler and Stryker process are measured as one tool invocation. Both sides
use the exact shared test process. Seshat uses the installed command's normal
`{seshatReporter}` route; no comparison-specific reporter or verdict adapter is
substituted.

Run every preflight and matrix invocation with host permissions. The sandbox's
process and local network restrictions can make a mutation child fail with
`EPERM` after the original check and baseline pass. Preserve that command
output as an environment failure; it is not a mutation verdict and must not be
reported as `Killed`.

Coverage, CRAP, fresh Istanbul collection, test selection and per-mutant
TypeScript checking are excluded. Stryker uses the command runner with
`coverageAnalysis: "off"` and Node's test concurrency fixed at one. Stryker's
initial baseline, mutant runs, instrumentation, report serialization and
cleanup remain inside its timed command boundary. Seshat's capture,
instrumentation and mutation work remain inside its `mutate` command boundary.
Report parsing and semantic validation happen after the wall-clock boundary.

Run one warmup and five measured invocations for each tool at workers 1 and 2,
for 24 top-level invocations total. Rotate tool and worker order between
measured pairs. Keep top-level invocations, builds, installs and downloads
serial; mutation workers within a workers-2 invocation may run concurrently.
Recreate the disposable fixture and clear prior reports before each invocation
while retaining the shared source bytes.

## Stryker configuration

The benchmark-only dependency is isolated under `benchmarks/stryker/` with a
committed `package.json` and lockfile. Stryker is installed with
`npm --ignore-scripts --no-audit --no-fund`. No runtime package depends on it.

The config uses the exact Node command below and local JSON reporting only:

```json
{
  "mutate": ["src/compare.ts", "packages/rules/index.ts"],
  "testRunner": "command",
  "commandRunner": {
    "command": "node --test --test-concurrency=1 tests/check.mjs"
  },
  "coverageAnalysis": "off",
  "concurrency": 1,
  "reporters": ["json"],
  "jsonReporter": {"fileName": "reports/stryker.json"},
  "disableTypeChecks": true,
  "cleanTempDir": "always",
  "timeoutMS": 60000
}
```

The workers-2 condition changes only `concurrency` to 2. No `buildCommand`,
dashboard reporter, test-runner plugin or checker is configured.

## Semantic validation

Before running either tool, record hashes for source, tests, package metadata,
tsconfig, the workspace symlink and the generated tool config. After a
successful run, require all input hashes to match, the Seshat scratch directory
to be empty and the Stryker temporary directory to be removed. Retain portable
raw reports, child output on failure, failed fixture copies, wall timings, tool
versions, package-lock hash, fixture hash, binary hash, generated configs,
driver/helper/protocol hashes, installed Seshat package bytes, Stryker
dependency count and host CPU/memory details.

Stryker locations can cover the whole expression (`age >= 18`) rather than the
operator itself, and its replacement can likewise be the whole expression
(`age > 18`). Normalize each active report mutant by converting its one-based
line/column span to a source span, locating the unique `>=` within that span,
and then calculating the byte offset from the original source. Derive the
replacement operator by proving that replacing that exact `>=` with `>` or
`<` produces the reported replacement text. Require exactly one operator
occurrence and fail on an empty, ambiguous or otherwise unsupported span;
never assume the reported start column points directly at the operator. Require
the normalized offset to be 42 and compare the tuple
`{path, offset, original, replacement}` with the Seshat result. Map Stryker
`Killed` to Seshat `killed`; active statuses other than `Killed` fail, while
excluded mutators must remain `Ignored`. Each active mutant must also report
`testsCompleted: 1` and retain assertion-failure evidence in `statusReason`,
including `ERR_ASSERTION` from `tests/check.mjs`; a generic `Killed` status is
insufficient.

The preflight must prove that the original compiler check and both tools'
original baselines pass. A runner startup failure or malformed report is a
failed preflight, not a generic killed result. The self-check must reject wrong
mutator names, operator replacements, verdicts, source locations, extra
mutants and changed fixture hashes.

## Interpretation

Report medians and raw ranges only, with the exact timing boundary and tool
versions. Explain that Seshat uses source replacement while Stryker uses its
own mutation switching and command-runner process model. Do not present the
ratio as a language-only or end-to-end product speed claim, and do not infer
coverage, CRAP or full-check equivalence from this slice.

Reference documentation: [Stryker configuration](https://stryker-mutator.io/docs/stryker-js/configuration/),
[Node.js guide](https://stryker-mutator.io/docs/stryker-js/guides/nodejs/),
[supported mutators](https://stryker-mutator.io/docs/mutation-testing-elements/supported-mutators/)
and the [mutation report schema](https://github.com/stryker-mutator/mutation-testing-elements/blob/master/packages/report-schema/src/mutation-testing-report-schema.json).
