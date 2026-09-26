# JSON report format

`seshat <check|crap|mutate> --json` writes one JSON object followed by a
newline to stdout. Progress stays on stderr. This document defines the public
wire contract for `schemaVersion: 1`.

`schemaVersion` identifies this document. `toolVersion` identifies the
executable, such as `0.1.0`. They are separate values. Valid standalone
help and version commands print text. They do not produce this JSON report.

## Top-level report

Every JSON report has these fields. A valid run can still have `complete: false`.

| Field | Type and presence | Meaning |
| --- | --- | --- |
| `schemaVersion` | integer, required | Always `1` for this contract. |
| `toolVersion` | string, required | Seshat executable version. |
| `command` | `"check"`, `"crap"`, `"mutate"`, or `null` | The requested command. It is `null` when argument parsing fails before a command is accepted. |
| `complete` | boolean, required | Whether all required assessment work and cleanup completed. It is independent of threshold quality. |
| `cancelled` | boolean, required | Whether Seshat handled cancellation during this run. |
| `signal` | integer or `null`, required | The handled cancellation marker, or `null`. Unix uses the signal number. Windows uses `2` for either `CTRL_C_EVENT` or `CTRL_BREAK_EVENT`; this is not a POSIX signal claim. |
| `scope` | object or `null`, required | Captured source and setup scope. It is `null` until capture succeeds. |
| `timings` | object, required | Wall, capture and assessment durations in milliseconds. |
| `quality` | object or `null`, required | Threshold results, or `null` when configuration or capture did not succeed. |
| `result` | object, required | Assessment evidence. A failure before the structured assessment starts can contain only `complete: false` and `error`. |

`null` means that a field belongs to the applicable shape but its value is
unavailable or not applicable. A numeric zero is a measured count or value of
zero. An omitted section means that the command did not request it, or that
execution stopped before the producer created it. Consumers must handle all
three cases.

## Scope and paths

After capture, `scope` has this shape:

| Field | Meaning |
| --- | --- |
| `include` | Source include patterns from configuration. |
| `exclude` | Source exclude patterns from configuration, usually an empty array. |
| `files` | Resolved source files, in project-relative form. |
| `setups` | Configured setup entries, in configuration order. Each has `name`, `runner` and `cwd`. |

The `runner` value is `node`, `jest` or `vitest`. Paths in report fields are
relative to the captured project and use `/` separators, including on Windows.
Function `start` and mutation `offset` values are zero-based UTF-8 byte offsets
into the captured source. Function rows do not contain line or end coordinates.

If a valid command starts capture and capture fails, `scope` remains `null` but
`timings.captureMs` is still recorded. Argument errors happen before capture,
so they have `scope: null` and `captureMs: null`. Do not add a phase name to a
`result` that contains only `complete: false` and `error`.

## Timings

All timing values are JSON numbers in milliseconds unless they are `null`.

| Field | Meaning |
| --- | --- |
| `timings.wallMs` | Seshat process time from CLI entry through capture, assessment and cleanup. It excludes process launch, Node wrapper startup, final threshold evaluation, final formatting and stdout output. |
| `timings.captureMs` | Configuration validation and the initial captured-project copy. It is `null` when capture was not attempted. |
| `timings.executionMs` | Assessment time from source analysis through the requested runner and mutation work. It excludes final primary-copy and evidence cleanup. It is `null` when structured assessment did not start. |

`result.phaseTimings` contains `analysisMs`, `preparationMs`,
`typecheckMs`, `baselineMs`, `coverageMs`, `attributionMs` and `cleanupMs`.
Each is a number when that phase was attempted and `null` when it was not.
Failed or cancelled attempted phases keep their elapsed time. The per-setup
`timings` object has `typecheckMs`, `baselineMs` and `coverageMs` with the same
rule. The aggregate original-check values sum the measured setup phases.

`mutation.executionMs` includes mutation preparation, scheduling and cleanup of
additional worker copies. `mutation.mutationWallMs` covers the scheduler and
worker join interval. `workerPreparationMs`, `workerCleanupMs` and per-job
durations are nested or parallel intervals. They are measurements, not parts
that can be blindly summed into wall time.

## Assessment result

Once the structured assessment starts, `result` contains:

| Field | Meaning |
| --- | --- |
| `phase` | `check`, `crap` or `mutate`. Absent on a pre-assessment error. |
| `complete` | Structured assessment completeness. It becomes false for missing or unreliable required evidence, unresolved mutation work, cancellation or cleanup failure. |
| `jobsAttempted` | Original setup jobs, mutant jobs and worker or prepared-baseline jobs returned by the executor. |
| `sources` | Source rows described below. |
| `setups` | Setup rows and job evidence described below. |
| `phaseTimings` | Phase durations described above. |
| `diagnostics` | Runtime and worker diagnostics described below. |
| `executionMs` | The assessment duration also exposed as top-level `timings.executionMs`. |
| `mutation` | Present for `check` and `mutate`; omitted for `crap`. |
| `error` | A string for an error that prevents the structured result from being built. The exact text is diagnostic. |
| `cleanupError` | An optional string when closing captured or evidence directories fails. Its presence makes the result incomplete. |

`check` runs source coverage and CRAP plus mutation testing. `crap` runs
coverage and CRAP and has no `result.mutation`. `mutate` requires the original
typecheck and test baselines, skips coverage execution, sets each setup's
coverage state to `not-requested`, and omits each source's measurement result.
Thus `mutate` has mutation evidence without source CRAP rows. A missing
typecheck in a `check` or `mutate` setup is rejected before this structured
result exists. In `crap`, the typecheck command is optional; when it is omitted,
the setup keeps `typecheck.state: "not-run"` and `timings.typecheckMs: null`.

### Source rows and function measurements

Each `result.sources` row has a project-relative `path`. When analysis and
coverage attribution ran, it also has `result`:

| Field | Meaning |
| --- | --- |
| `complete` | Whether this source's coverage mapping was usable for all normal function scopes. |
| `functions` | Function and implicit-scope measurements. |
| `problems` | Coverage mapping problems. The list is diagnostic evidence; its exact wording is not stable. |

A source row can instead have an `error` string when source analysis failed.
The string is diagnostic evidence. A source `result.complete: false` does not
make a partial score complete, and report `complete` remains false when an
in-scope source cannot be measured.

Each `functions` row has these fields:

| Field | Meaning |
| --- | --- |
| `name` | Function identity. Named declarations use their name. Anonymous functions and implicit scopes use generated names such as `function@<start>`, `arrow@<start>`, `field@<start>` and `static@<start>`. Use `path` and `start` when a name is not unique. |
| `start` | Zero-based source byte offset of the analyzed scope. |
| `complexity` | Integer cyclomatic complexity used by the CRAP calculation. |
| `covered` | Number of mapped statements with at least one hit. |
| `total` | Number of mapped statements. |
| `coverage` | `covered / total` as a fraction from `0` to `1`, only for `measured` rows. It is not a percentage. |
| `crap` | `complexity² × (1 − coverage)³ + complexity`, only for `measured` rows. |
| `status` | `measured`, `unknown`, `not-applicable` or `complexity-only`. |

`measured` means valid coverage mapped to a non-empty ordinary function.
`unknown` means coverage is missing or unreliable. It can retain decoded
`covered` and `total` counts, but `coverage` and `crap` remain `null`.
`not-applicable` identifies an empty function. `complexity-only` identifies an
implicit scope such as a class field initializer or static block. Those rows
retain complexity but have `null` coverage and CRAP, regardless of any counters
retained from decoded evidence. A `null` measurement is therefore different
from a measured zero.

### Setup jobs and evidence

Each `result.setups` row has `name`, `typecheck`, `baseline`, `coverage` and
`timings`. Setup order follows configuration order. Job `state` values are:

| State | Meaning |
| --- | --- |
| `passed` | The command produced valid passing evidence. |
| `failed` | The test runner produced a test failure. A test failure can kill a mutant only when every required setup resolves without infrastructure errors. |
| `timed-out` | The configured deadline stopped the command. |
| `execution-error` | The command, receipt, coverage file, output pipe or other execution evidence was invalid or failed. |
| `cancelled` | Cancellation stopped the command. |
| `not-run` | The requested job was not reached. `crap` also uses this state for an intentionally omitted optional typecheck; a complete run keeps `typecheck.state: "not-run"` and `timings.typecheckMs: null` in that setup. |
| `not-requested` | The command does not run this job. In the public commands this is the coverage job under `mutate`. |

An attempted job can include `exit`, `ms`, `timedOut`, `cancelled`,
`overflow`, `pipeError` and a runner `report`. Jobs stopped before they start
can contain only their state. `ms` is the child-process duration in
milliseconds. Runner receipts, command diagnostics and stack traces are
evidence with runner-specific shape and text. Do not parse them as a stable
protocol. The job state, setup name and timing fields above are the contract.

### Runtime diagnostics

Structured assessment results include `diagnostics` with runtime identity and
concurrency sections. Unavailable values use `null` or the states below:

* `runnerVersions` contains one entry per setup with `setup`, `runner`, a
  `runtime` object and a `packages` array. `runtime` always has `node`,
  `declared` and `declaredComparison`; the first two are strings or `null` and
  the comparison is `match`, `mismatch`, `not-comparable` or `unavailable`.
  Each `packages` row always has `name`, `actual`, `declared`, `locked`,
  `declaredComparison` and `lockedComparison`; the three version values are
  strings or `null`, and each comparison uses the same four states. A version
  range is `not-comparable`, not a mismatch. Node setups have an empty
  `packages` array.
* `concurrency.seshat` always has numeric `configuredWorkers`,
  `effectiveWorkers` as a number or `null`, and `state` as `known` or
  `not-requested`. For mutation, `effectiveWorkers` reports the same scheduler
  capacity as `mutation.workersUsed`. `concurrency.runners` contains `test` and
  `coverage` entries per setup. Each entry always has `setup`, `runner`,
  `command`, `effectiveWorkers` as a number or `null`, `state` as `known` or
  `unavailable`, and `source` as a string or `null`.

These numeric and identity measurements are useful diagnostics. Any receipt,
command text or free-form diagnostic nested under them remains evidence.

## Mutation assessment

`result.mutation` appears for `check` and `mutate` and has these core fields:

| Field | Meaning |
| --- | --- |
| `strategy` | `replace` by default, or `switch` when the experimental switching option was used. |
| `complete` | Whether every planned mutant received a resolved verdict and mutation preparation, execution and cleanup succeeded. |
| `planned` | Number of generated comparison replacements. |
| `killed`, `survived` | Counts of outcomes with those resolved verdicts. |
| `score` | `killed / (killed + survived) × 100` for a complete non-empty plan; otherwise `null`. The value is a percentage from `0` to `100`. |
| `outcomes` | One row per planned mutant, in source and operator order. |
| `completed` | Planned mutants with a returned attempt, including failed, timed-out or cancelled attempts. It does not mean successfully assessed. |
| `notRun` | Planned mutants with no returned attempt. It is not the count of `not-run` verdicts. |
| `unresolved` | `planned - killed - survived`, including incomplete attempts and unstarted work. |
| `jobsAttempted` | Mutant test jobs only. Top-level `result.jobsAttempted` also includes original and worker baseline jobs. |
| `workersRequested`, `workersUsed` | `workersRequested` is the configured Seshat worker limit. `workersUsed` is `min(workersRequested, planned)` when preparation succeeds and no cancellation was observed before scheduling, otherwise `0`. It is scheduler capacity, not observed worker activity, and is not reduced after scheduling starts for worker-start failure, cancellation or early stopping. |
| `workerBaselineJobs`, `workerBaselines` | Additional worker baseline jobs and their evidence. |
| `workerPreparationMs`, `mutationWallMs`, `workerCleanupMs` | Mutation preparation, scheduling and additional-worker cleanup timings. |
| `diagnostics` | Unresolved counts, throughput, cumulative worker time and up to five slow executions. |
| `error`, `restorationError` | Nullable diagnostic strings for mutation or source-restoration failures. Either failure makes mutation incomplete and withholds its score. |

Every outcome has `id` (run-wide), `localId` (within its source), `path`,
`offset`, `original`, `replacement`, `setups` and `verdict`. IDs and ordering
follow resolved source order and comparison-operator order. Each outcome setup
retains its job state and evidence. An unstarted setup remains `not-run`.

Original baselines must all be `passed` before any mutant can be assessed. If
they are missing or fail, every mutant is `unassessed`. With passing baselines,
the verdict rules are applied in this order:

| Verdict | Meaning |
| --- | --- |
| `execution-error` | A setup has an execution error, or the returned setup vector is longer than the baseline vector. |
| `cancelled` | No higher-priority execution error exists and a setup was cancelled. |
| `timed-out` | No higher-priority error exists and a setup timed out. |
| `not-run` | A setup result is missing or explicitly not run. |
| `killed` | All configured setups returned only passed or failed states, and at least one returned failed. |
| `survived` | Every configured setup returned passed. |

The precedence means an infrastructure error, cancellation, timeout or missing
setup never becomes a kill merely because another setup failed its test. A
complete mutation result contains only `killed` and `survived` outcomes. A
zero-mutant complete result has `score: null`, meaning not applicable, not
`100`.

`mutation.diagnostics.unresolvedBreakdown` counts `timedOut`, `executionError`,
`cancelled`, `notRun` and `unassessed` verdicts. Its `throughput` values are
computed against `mutationWallMs`; `workerTimeMs` sums returned mutant attempt
durations; `slowestExecutions` contains at most five `{id,path,executionMs,verdict}`
rows. These measurements can overlap under parallel workers.

## Quality thresholds

When capture succeeds, `quality` is an object even when no thresholds are
configured. Its `checks` array contains one entry for each configured
`thresholds.maxCrap` or `thresholds.minMutationScore`, in that order.

Each check has `metric`, `limit`, `actual` and `state`:

| Metric | Requested by | Actual and pass rule |
| --- | --- | --- |
| `maxCrap` | `check` and `crap` | The maximum CRAP among measured functions. It passes when the unrounded value is less than or equal to `limit`. |
| `minMutationScore` | `check` and `mutate` | The complete mutation percentage. It passes when the unrounded value is greater than or equal to `limit`. |

Per-check states are `not-requested`, `incomplete`, `failed`, `passed` and
`not-applicable`. `actual` is non-null only for `passed` and `failed`; it is
`null` for every other state, even when partial assessment evidence contains a
number. If a requested metric has no applicable score, it is
`not-applicable`, not an invented pass. A requested `maxCrap` check with a
measured function whose CRAP value is missing or non-numeric makes the report
incomplete, preserves the source rows and returns exit status `2`.

The aggregate `quality.state` is one of:

* `incomplete` when the report is incomplete;
* `not-configured` when no checks were configured on a complete run;
* `failed` when any check failed;
* `passed` when at least one check passed and none failed; or
* `not-evaluated` when all configured checks are not requested or not applicable.

`complete: true` can therefore appear with `quality.state: "failed"`. A
quality failure changes the exit status but does not rewrite the assessment
evidence or the completeness flag.

## Completion, cancellation and exit status

The effective exit status has this precedence:

1. A stdout write failure returns `2`. No report can be relied on because the
   output may be incomplete.
2. A handled Unix `SIGINT` returns `130`; a handled Unix `SIGTERM` returns
   `143`. The report has `complete: false`, `cancelled: true`, the signal
   number, retained earlier evidence and no complete mutation score.
3. On Windows, a handled `CTRL_C_EVENT` or `CTRL_BREAK_EVENT` records
   `signal: 2` and returns `2`. The field is a Windows cancellation marker, not
   the original control-event number.
4. Otherwise an incomplete result returns `2`.
5. A complete result with a failed applicable threshold returns `1`.
6. A complete result with no failed applicable threshold returns `0`.

Cleanup failures set `complete: false`; mutation cleanup or restoration also
sets its score to `null`. A failed baseline, missing coverage, unresolved
timeout, execution error or cancelled phase likewise prevents a complete
assurance result, while retaining evidence that was already collected.

Seshat cannot promise a JSON report when the operating system forcibly kills
the process, the executable or its interpreter cannot start, or stdout cannot
be written. A valid `--json` command can still report a child-command start
failure when Seshat itself remains alive.

`seshat --help`, `seshat -h`, `seshat --version`, `seshat -V` and
`seshat <command> --help` are text commands. Adding flags to those forms is
parsed according to the ordinary argument rules. An invalid combination that
includes `--json` emits the argument-error JSON envelope with `command: null`.

## Compatibility and evidence

Within schema version 1, Seshat preserves the documented field names, JSON
types, nullability, score units, comparison rules and verdict meanings.
Consumers must ignore unknown optional fields. Removing a stable field or
changing its meaning requires a new `schemaVersion`.

The `error`, `cleanupError`, `restorationError`, `problems`, `diagnostic`,
`pipeError` and runner `report` values carry evidence. Their presence and
role are useful for diagnosis, but their free-form text and runner-specific
receipt shape are not a stable text protocol. The stable contract is the core
envelope, source rows, setup states, mutation counters and verdicts described
above.

The `switch` mutation strategy and its additional fields are experimental.
When present, `preparedBaselines`, `preparedBaselineJobs`,
`switchPreparationMs` and `preparedBaselineMs` describe the extra prepared
source work. The transformed helpers are not typechecked and can affect
TypeScript narrowing or runtime reflection. Replacement remains the default;
consumers should accept strategy-specific fields without treating them as
required.

For configuration and command setup, see the [configuration guide](configuration.md).
The release boundaries and assessment limits are in the [release scope](release-scope.md).
