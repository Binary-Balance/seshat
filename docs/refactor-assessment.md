# Report and module simplification assessment

Assessment for [issue #86](https://github.com/Binary-Balance/seshat/issues/86).
The one justified change is to build the mutation plan from existing typed
comparison metadata. Keep the other examined code. This assessment changes no
report fields, scoring policy, execution strategy or module ownership.

## Internal JSON coupling

| Producer and consumer | Finding and decision |
| --- | --- |
| [`Analysis::json`](../crates/seshat/src/analysis.rs) to [`CapturedProject::mutate`](../crates/seshat/src/execution/project/collection.rs) | Mutation planning previously serialized all analysis scopes and mutant definitions, then unwrapped `mutants` and each `id` to recover scheduling data. It now iterates the existing `Comparison` values and their replacements. This removes the planner's dependency on the proof report's array and ID field shapes without adding a report type or iterator abstraction. |
| [`coverage::attribute`](../crates/seshat/src/coverage.rs) to collection, [proof `score`](../crates/seshat/src/lib.rs), and [`cli::quality`/`readable`](../crates/seshat/src/cli.rs) | Collection reads the guaranteed `complete` field; the proof command emits the value directly. The CLI uses function status and CRAP fields for thresholds and display. A typed coverage result could replace these string field reads, but would span coverage, collection, proof entry and CLI formatting. No incorrect shape or repeated unchecked extraction was found here. Leave this broader conversion alone. |
| [`CapturedProject::mutate`](../crates/seshat/src/execution/project/collection.rs) to assessment orchestration and diagnostics | The producer always creates `complete`, `jobsAttempted` and `workerBaselineJobs`. `preparedBaselineJobs` exists only for switching and its consumer defaults to zero. The unwraps follow these local construction rules. Typing the whole mutation evidence would touch scheduling, progressive job evidence and diagnostics; the audit supplies no maintenance problem requiring that change. |
| [`CommandEvidence`](../crates/seshat/src/execution.rs) and [`MutationAssessment`](../crates/seshat/src/assessment.rs) to collection | Test states, verdicts and assessment counts are already typed. Runner receipts and Istanbul input are external JSON, validated before use. Preserve those input checks rather than treating external evidence as a guaranteed internal report. |

The planner now computes each source-local ID as
`comparison.first_id + alternative` and each run-wide ID as `plan.len()`.
[`Analysis::inspect`](../crates/seshat/src/analysis.rs) sorts comparisons and
assigns consecutive IDs; the planner preserves that comparison and replacement
order. It emits the same `offset`, `original`, `replacement`, path and initial
setup evidence. Failed source analyses still produce no planned mutants.
`Analysis::json` remains the proof output producer. A compatibility regression
checks its metadata against the planner's rows. The two output paths keep their
metadata serialization; no new report type is needed.

## Examined audit points

- The early `return` in [`Analysis::enter_node`](../crates/seshat/src/analysis.rs)
  handles unsupported binary operators in its final block. All earlier scope,
  statement and decision bookkeeping has already run. Oxc's walker calls
  `enter_node`, then visits both operands, so this callback return does not prune
  child comparisons. The new regression includes `(a < b) + (a === b)` and
  requires all three comparison alternatives. Leave the return alone.
- [`coverage::attribute`](../crates/seshat/src/coverage.rs) changes `complete`
  inside the row mapping closure. `collect` eagerly consumes every row before
  constructing the result. Completeness can only become false when a non-empty
  ordinary function lacks usable statements. Implicit and empty scopes retain
  their distinct statuses. The mutation stays inside this function.
  A separate completeness pass
  would repeat the same conditions; leave it alone.
- Coverage allocates statement lists and counts for implicit scopes too. Their
  coverage and CRAP stay null, but decoded `covered` and `total` counts remain
  report evidence. Implicit scopes also prevent their statements from being
  attributed to an enclosing ordinary function. Skipping that work changes the
  documented [function measurements](report-format.md#source-rows-and-function-measurements).
  No measured allocation problem justifies replacing the current lists.
- [`nearest_json`](../crates/seshat/src/execution/project/collection.rs) has only
  two callers, diagnostics lookups for fixed `package.json` and
  `package-lock.json` names. Configuration validates `cwd` as relative without
  parent components; capture verifies its resolved directory stays inside the
  captured project. Each read goes through `json_file` and `regular_path`, which
  checks containment and rejects linked parents and non-independent files.
  The ancestor walk stops at the captured root. A second containment guard
  duplicates the existing boundary; preserve that boundary and leave the walk
  alone.
- The `wallMs` unwrap in [`cli::readable`](../crates/seshat/src/cli.rs) reads a
  report constructed by `cli::report`. Production callers supply
  `Instant::elapsed().as_secs_f64() * 1000.0`, a finite duration-derived number.
  `Duration`'s maximum range also remains finite after that multiplication.
  The formatter does not accept arbitrary input JSON. The proposed NaN or
  infinity panic is not a demonstrated runtime defect; leave it alone.

## Scope and checks

The production change is confined to mutation plan construction in
[`collection.rs`](../crates/seshat/src/execution/project/collection.rs).
Its `mutation_plan_preserves_analysis_ids_and_report_metadata` regression covers
two valid sources separated by a parse failure, nested comparisons beneath an
unsupported binary operator, differing replacement counts, global and local IDs,
proof metadata, initial setup states and no execution before readiness.

Validation uses the supported compiler and locked dependencies:

```sh
cargo test --locked --offline --manifest-path crates/seshat/Cargo.toml
```

All 75 library tests, three CLI output tests and ten proof input tests pass.
Relevant existing
controls cover incomplete coverage, source attribution, scoring, mutation
readiness and report path rejection. Formatting, local report links and the diff
were also checked. These are native Linux checks, not a claim of a new native
Windows run or a performance measurement.

Keep the current private collection and platform modules and the existing
scheduler. No worker-pool abstraction or file split is justified by this trace.
This follows the [private-module decision](adr/0005-prove-four-private-modules-with-an-execution-session.md)
and [assurance requirement](adr/0001-preserve-assurance-when-optimising.md).
Shared proof execution remains [#56](https://github.com/Binary-Balance/seshat/issues/56);
demonstrated packaging duplication belongs to the packaging issues.
