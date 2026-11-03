# Assessment-scope verdict evidence

The 0.12.0 candidate preserves all 3,038 retained 0.11.0 mutant and pseudo-test
outcomes. No shared identity, ID, verdict or pseudo-test result changes. The
expanded statement proof adds 300 outcomes: 250 killed and 50 surviving mutants.
Its scores change with that scope. Completeness, retained quality states and
worker baseline counts match throughout.

This is the release comparison for
[#255](https://github.com/Binary-Balance/seshat/issues/255), required by
[#136](https://github.com/Binary-Balance/seshat/issues/136). The
[JSON record](assessment-scope-verdicts.json) retains exact counters and timings,
source JSON hashes, artifact coordinates, shared outcome identities and scope
additions. It contains 765 report projections per build: 350 full assessment
results and 415 partial phase results. Empty results count as reports, not
outcomes. No unexplained difference was found in the compared assessment fields.

## Builds and coordinates

The baseline is released 0.11.0, direct head
`394afba477bb974f0fb74103186a22d0644f0eef`, built from merge commit
`3ef595e55507104fb53ad5913800dd504429d120` in PR #250. The candidate is exactly
PR [#256](https://github.com/Binary-Balance/seshat/pull/256) head
`a311b2fdac98c844e9af9b4b9889ccb3ff1955d6`, built from merge commit
`5c493ef546ad9845ba3a1670be9f2b87f6ca7bc9`. These are the coordinates in the
[preserved baseline audit](../releases/0.11.0-audit.json) and the supplied
candidate audit. Every artifact's GitHub run head matches its direct head;
package artifact IDs and digests match the audits.

| Workflow | 0.11.0 run | 0.12.0 run |
| --- | --- | --- |
| Linux x64 | [41187182223](https://github.com/Binary-Balance/seshat/actions/runs/41187182223) | [41563731109](https://github.com/Binary-Balance/seshat/actions/runs/41563731109) |
| Linux ARM64 | [41187182290](https://github.com/Binary-Balance/seshat/actions/runs/41187182290) | [41563731058](https://github.com/Binary-Balance/seshat/actions/runs/41563731058) |
| macOS, both architectures | [41187182250](https://github.com/Binary-Balance/seshat/actions/runs/41187182250) | [41563730896](https://github.com/Binary-Balance/seshat/actions/runs/41563730896) |
| Windows x64 | [41187182235](https://github.com/Binary-Balance/seshat/actions/runs/41187182235) | [41563730938](https://github.com/Binary-Balance/seshat/actions/runs/41563730938) |
| Windows runtime | [41187182262](https://github.com/Binary-Balance/seshat/actions/runs/41187182262) | [41563731038](https://github.com/Binary-Balance/seshat/actions/runs/41563731038) |

Package examples use Node 24.20.0. All five latest-Node suites use 24.22.2 in
both builds; the macOS ARM64 suite is inside its package artifact. This comparison
does not activate or claim support for the import-failure observer on that Node
version. The baseline artifacts expire on 29 January 2027 and the candidate
artifacts on 1 February 2027; their retained report data remains in the JSON.

## Deterministic comparison

1. Pair artifact names, artifact-relative JSON paths and JSON pointers. Recursively
   read assessment result objects and partial objects with `outcomes` arrays;
   do not parse JSON embedded in command-output strings.
2. When a proof stores both `result` and `report.result`, require exact equality
   and retain the latter once. This removes 67 duplicate results per build,
   including Vitest and crash/timeout proofs. Require the example fields in
   `public-consumer-examples.json` to equal `summary.json.publicExamples`, then
   omit the duplicate file. Keep separately executed repetitions and hosts.
3. Match outcomes within each report and phase by kind, path, offset, original
   text and replacement. Require unique keys. Then compare all retained outcome
   fields, including global/local IDs, verdict, `countedAsKilled`, coverage and
   `pseudoTested` where present. No IDs were renumbered. The 130 Node load-failure
   rows supply only ID and verdict, so their 210 outcomes have that narrower check.
4. Compare completeness, quality when present, scores, phase counters, worker
   baselines, setup job states and source results. Treat the new site-count
   fields and zero-valued suppression fields as format additions, retaining their
   exact values. Compare all other source fields without normalisation. Exclude
   timings from equality checks and retain their original numbers separately.
5. For all 350 full reports in each build, assert that setup jobs, mutant jobs,
   worker baselines and prepared baselines sum to `jobsAttempted`. A setup's
   baseline, coverage or direct typecheck counts once when its evidence has `ms`;
   a compiler helper counts once when `compilerStrictness.job` exists. A reused
   typecheck adds no job. The JSON retains this derivation as setup `attemptedJobs`
   and report `jobArithmetic` fields.

Each compared source file has a raw-byte SHA-256 and artifact ID, digest, run URL
and head. Source-array hashes use UTF-8 JSON with sorted keys, compact separators
and literal Unicode. Repeated outcome lists are stored once in `outcomeSets`;
each report references its shared, added and removed lists. References preserve
report multiplicity. Baseline outcomes are shared plus removed; candidate
outcomes are shared plus added. The method and field exclusions are also in the
JSON, so counts and comparisons can be reproduced without the one-off helper.

## Outcomes

| Artifact | Reports | Shared outcomes | Added outcomes | Changed shared verdicts |
| --- | ---: | ---: | ---: | ---: |
| `linux-x64-package-proof` | 108 | 545 | 60 | 0 |
| `linux-arm64-package-proof` | 80 | 423 | 60 | 0 |
| `macos-x64-package-proof` | 80 | 423 | 60 | 0 |
| `macos-arm64-package-proof` | 139 | 562 | 60 | 0 |
| `windows-x64-package-proof` | 89 | 429 | 60 | 0 |
| `linux-x64-latest-node` | 59 | 139 | 0 | 0 |
| `linux-arm64-latest-node` | 59 | 139 | 0 | 0 |
| `macos-x64-latest-node` | 59 | 139 | 0 | 0 |
| `windows-x64-latest-node` | 59 | 139 | 0 | 0 |
| `windows-shared-fixture-evidence` | 27 | 97 | 0 | 0 |
| `windows-runtime-cli-evidence` | 6 | 3 | 0 | 0 |
| `windows-runtime-preflight` | 0 | 0 | 0 | 0 |
| **Total** | **765** | **3,038** | **300** | **0** |

The five package artifacts contain 2,382 shared outcomes and 300 additions;
the remaining artifacts contain 656 unchanged outcomes. The included files
cover the public examples, Vitest and Jest/Expo checks, standalone/operator
proofs, Debian execution, cancellation, parallel fault injection, crash
continuation, latest Node and Windows runtime scenarios. The JSON lists every
compared file and report pointer. Packaging, notices and stage validation are
outside this assessment comparison.

On every host, the existing examples and ordinary Vitest/Jest checks keep all
51 outcomes: 28 example, 13 Vitest and 10 Jest/Expo outcomes. All 20 example
worker 1/2 parity checks pass in each build. Their scores and jobs below match;
all have zero worker baseline jobs in both phases.

| Report | Mutation score | jobsAttempted | Mutation jobs | Pseudo-test jobs |
| --- | ---: | ---: | ---: | ---: |
| Example Node | 75 | 9 | 4 | 2 |
| Example Jest/Expo; Jest/Expo normal-1 | 75 | 10 | 4 | 3 |
| Example Vitest; Vitest stack | 83.33333333333334 | 13 | 6 | 4 |
| Example workspaces | 100 | 8 | 2 | 3 |
| Vitest assertion; Jest/Expo assertion-kill | 100 | 4 | 1 | 0 |
| Vitest survived; Jest/Expo survivor | 0 | 4 | 1 | 0 |
| Vitest/Jest before-all | withheld | 4 | 1 | 0 |

Both `before-all` reports remain intentionally incomplete. Across all compared
outcomes, `countedAsKilled` stays false and `countedTimeouts` stays zero. Expected
execution errors, cancellations and timeouts keep their unresolved verdicts.

## Intended statement scope changes

[#218](https://github.com/Binary-Balance/seshat/issues/218), implemented in
[#254](https://github.com/Binary-Balance/seshat/pull/254), permits statement
removal inside async functions, generators and async generators. The
[statement proof](../../benchmarks/proofs/statement-operators.mjs) also appends
such functions to its fixture. Its existing comparison and synchronous statement
mutants preserve their complete identities and verdicts.

Each of ten statement-enabled scenarios per host gains these six mutants in
`statements.ts`; all five hosts report the same new verdicts:

| Offset | Function | Removed statement | Verdict |
| ---: | --- | --- | --- |
| 293 | `asyncAdd` | `log.push(1);` | killed |
| 306 | `asyncAdd` | `await Promise.resolve(log.push(2));` | killed |
| 391 | `values` | `yield 3;` | killed |
| 400 | `values` | `yield* [4];` | killed |
| 412 | `values` | `return;` | survived |
| 461 | `asyncValues` | `yield await Promise.resolve(5);` | killed |

The new surviving bare return is deliberately equivalent for this closed
fixture. Statement-only results change from 3 killed / 2 survived to 8 / 3;
combined comparison-and-statement results change from 5 / 2 to 10 / 3. The
`job-timeout` scenario retains its existing timeout and withheld score.

| Scenario, on each host | Total jobs, before → after | Operator jobs, before → after | Score, before → after |
| --- | --- | --- | --- |
| default-replacement | 15 → 22 | 7 → 13 | 71.42857142857143 → 76.92307692307693 |
| default-switching | 16 → 23 | 7 → 13 | same change |
| statement-only | 13 → 20 | 5 → 11 | 60 → 72.72727272727273 |
| statement-only-parallel | 14 → 21 | 5 → 11 | same change |
| statement-switching-parallel | 16 → 23 | 5 → 11 | same change |
| no-operators | 8 → 9 | 0 → 0 | not applicable |
| warmup-false | 15 → 22 | 7 → 13 | 71.42857142857143 → 76.92307692307693 |
| warmup-true | 16 → 23 | 7 → 13 | same change |
| cost-off-replace-0 | 10 → 11 | 2 → 2 | 100 → 100 |
| cost-on-replace-0 | 15 → 22 | 7 → 13 | 71.42857142857143 → 76.92307692307693 |
| cost-off-switch-0 | 11 → 12 | 2 → 2 | 100 → 100 |
| cost-on-switch-0 | 16 → 23 | 7 → 13 | 71.42857142857143 → 76.92307692307693 |
| job-timeout | 13 → 20 | 5 → 11 | withheld → withheld |

These rows retain the operator phase and `totalJobsAttempted`, but omit the
extreme phase. Six added operator jobs explain six of each seven-job increase.
The remaining job is inferred from the totals and the exact proof source's
assertion that `pseudoTesting.planned` rises from 5 to 6. The three rows with
statement operators disabled also gain that one job. Its extreme-mutant identity
and verdict are unavailable in these retained rows. Operator `workerBaselineJobs`
stays 1 for statement-only-parallel, 2 for statement-switching-parallel and 0
for the others.

Per-operator `eligibleSites` and `excludedSites` are newly retained. For the
expanded statement fixture, expression statements have 8 eligible / 2 excluded
sites and bare returns have 3 eligible / 1 excluded. Its replacement/switching
semantic proof grows from 34 cases and 36 active mutant pairs to 50 cases and
66 pairs. The JSON preserves both case lists, site counts and source hashes;
these semantic pairs are separate from the 300 assessment outcomes above.

## Suppression format and evidence boundary

[#215](https://github.com/Binary-Balance/seshat/issues/215), implemented for
whole functions/files in
[#253](https://github.com/Binary-Balance/seshat/pull/253), adds
`coverageSuppressions` to source and function results. The 350 retained full
reports gain 724 such fields, all zero. Removing only those empty additions
leaves every source result identical, including function coverage, CRAP and
pseudo-test status.

No retained full source report contains a coverage hint or a `suppressed`
function. This comparison therefore establishes the format addition and
unchanged existing assessments, without establishing the new suppression
behavior from these artifacts. The dedicated
[coverage proof](../../benchmarks/proofs/coverage-branches.mjs) has separate
fixtures; its assessment JSON is not among the supplied retained reports.
Partial statement/branch hints remain outside this release's completed scope.

## Scheduling variation and timings

Four full `source-error` reports vary by one attempted job, with identical
mutant verdicts, completeness and withheld scores:

| Artifact / report | jobsAttempted | Mutation jobs |
| --- | --- | --- |
| Linux x64 package, Debian parallel | 14 → 13 | 4 → 3 |
| Linux x64 package, standalone parallel | 14 → 13 | 4 → 3 |
| macOS ARM64 package, standalone parallel | 13 → 14 | 3 → 4 |
| macOS x64 latest Node, parallel | 13 → 14 | 3 → 4 |

In each, one mutant's second setup changes between an attempted execution error
and `not-run`; the JSON retains those setup rows. The cause is inferred from
[`run_mutant`](../../crates/seshat/src/execution/project/collection.rs), which
checks the shared stop flag before each setup. This is the same scheduling
variation recorded in the [previous comparison](fewer-jobs-verdicts.md#job-counts).
All other full-report job counts match. No worker baseline count changes.

The JSON retains all available `phaseTimings`: 400 baseline and 465 candidate
objects. The 65 additional objects are newly retained timings in the statement
proof rows. All 350 full reports have them in both builds. Mutation/pseudo-test
wall times and per-operator times are retained separately where supplied;
`phaseTimings` itself does not contain those wall times. Nulls remain null.

For orientation, these are sums across each host's 12 existing example and
Vitest/Jest reports, rounded to milliseconds. Exact report-level numbers remain
in the JSON. They are single samples on shared hosts and support no performance
claim.

| Host | Execution ms, before → after | Mutation wall ms | Pseudo-test wall ms |
| --- | --- | --- | --- |
| Linux x64 | 96,940 → 61,866 | 27,296 → 17,068 | 14,896 → 9,279 |
| Linux ARM64 | 85,586 → 85,121 | 24,471 → 24,539 | 13,330 → 13,285 |
| macOS x64 | 121,495 → 147,472 | 33,218 → 38,076 | 18,356 → 21,812 |
| macOS ARM64 | 116,639 → 117,945 | 30,729 → 33,787 | 17,152 → 17,957 |
| Windows x64 | 137,785 → 134,226 | 40,786 → 39,811 | 22,538 → 22,127 |

## Verification and limits

The one-off comparison and retained-data round trip passed assert-based checks
for duplicate handling, identity matching, all 700 full-report job sums,
per-operator count sums, new fixture offsets/hashes, shared outcome equality,
source equality after the stated additions, and reconstruction of both verdict
totals. All 11 small downloaded artifact ZIPs matched their GitHub digests
(1,033,335 bytes combined). Existing extracted package/runtime files were hashed
and matched to the supplied audit coordinates; their ZIPs were not downloaded
again. The public files use portable paths.

No builds, dependency installation or new assessments were run. Individual runner
receipts, diagnostic text, execution IDs and temporary paths are excluded from
outcome equality. Partial reports cannot supply missing full-report metrics;
reports without a CLI envelope cannot supply quality states. The suppression and
extreme-phase evidence gaps above remain explicit. These results do not establish
that the process-handling or CI reliability issues in #247 or #248 are fixed.
They do not audit notices, validate stages or authorise publication.
