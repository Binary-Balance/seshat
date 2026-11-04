# Execution reliability verdict evidence

The 0.12.1 candidate preserves all 3,338 retained 0.12.0 mutant and pseudo-test
outcomes. No identity, ID, verdict or pseudo-test result changes, none is added
or removed, and every source assessment array is identical. Completeness,
cancellation, scores, retained quality states, mutant counts and worker
baseline counts match throughout. Unresolved verdicts are preserved in full:
1,968 killed, 639 survived, 391 execution-error, 203 not-run, 61 timed-out, 52
cancelled, 24 unassessed.

This is the release comparison for
[#261](https://github.com/Binary-Balance/seshat/issues/261). The [JSON
record](execution-reliability-verdicts.json) retains exact counters and timings,
source JSON hashes, artifact coordinates and shared outcome identities. It
contains 765 report projections per build: 350 full assessment results and 415
partial phase results. Empty results count as reports, not outcomes. Apart from
639 per-run path and capture-ID differences in runner reports, which are set
aside and counted, the only differences in the compared assessment fields are 14
reports. They differ in attempted-job counts or in the exit code of a cancelled
Windows process, and are shown in full below. No unexplained difference was
found.

## Builds and coordinates

The baseline is released 0.12.0, direct head
`a311b2fdac98c844e9af9b4b9889ccb3ff1955d6`, built from merge commit
`5c493ef546ad9845ba3a1670be9f2b87f6ca7bc9` in PR #256. The candidate is exactly
PR [#262](https://github.com/Binary-Balance/seshat/pull/262) head
`d64aa48f243f6e4647b23cdf93ccc557877a1f42`, built from merge commit
`a106c83e94a4b956f75338d9da17abc6ff7fa1f4`. These are the coordinates in the
[preserved baseline audit](../releases/0.12.0-audit.json) and the supplied
candidate audit. Every artifact's GitHub run head matches its direct head;
package artifact IDs and digests match the audits.

| Workflow | 0.12.0 run | 0.12.1 run |
| --- | --- | --- |
| Linux x64 | [41563731109](https://github.com/Binary-Balance/seshat/actions/runs/41563731109) | [41618407576](https://github.com/Binary-Balance/seshat/actions/runs/41618407576) |
| Linux ARM64 | [41563731058](https://github.com/Binary-Balance/seshat/actions/runs/41563731058) | [41618407524](https://github.com/Binary-Balance/seshat/actions/runs/41618407524) |
| macOS, both architectures | [41563730896](https://github.com/Binary-Balance/seshat/actions/runs/41563730896) | [41618407710](https://github.com/Binary-Balance/seshat/actions/runs/41618407710) |
| Windows x64 | [41563730938](https://github.com/Binary-Balance/seshat/actions/runs/41563730938) | [41618407605](https://github.com/Binary-Balance/seshat/actions/runs/41618407605) |
| Windows runtime | [41563731038](https://github.com/Binary-Balance/seshat/actions/runs/41563731038) | [41618407578](https://github.com/Binary-Balance/seshat/actions/runs/41618407578) |

The Linux x64, Linux ARM64, macOS x64 and Windows x64 runs also hold the four
latest-Node artifacts; the macOS ARM64 suite is inside its package artifact.
Package examples use Node 24.20.0. The four latest-Node artifacts use 24.22.2 in
both builds. All artifacts of both builds expire on 1 February 2027; their
retained report data remains in the JSON.

## Deterministic comparison

1. Pair artifact names, artifact-relative JSON paths and JSON pointers.
   Recursively read assessment result objects and partial objects with
   `outcomes` arrays; do not parse JSON embedded in command-output strings.
2. When a proof stores both `result` and `report.result`, require exact equality
   and retain the latter once. This removes 67 duplicate results per build.
   Require the example fields in `public-consumer-examples.json` to equal
   `summary.json.publicExamples`, then omit the duplicate file. Keep separately
   executed repetitions and hosts, even when their outcome lists are identical.
3. Match outcomes within each report and phase by kind, path, offset, original
   text and replacement. Require unique keys. Then compare all retained outcome
   fields, including global/local IDs, verdict, `countedAsKilled`, coverage and
   `pseudoTested` where present. No IDs were renumbered. The 130 Node
   load-failure rows supply only ID, verdict and evidence status, so their 210
   outcomes have that narrower check and cannot prove source-edit identity.
4. Compare completeness, cancellation, quality when present, scores, phase
   counters, worker and prepared baselines, setup job states, exit codes and
   errors, and source results. Source arrays are compared in full with no
   normalisation: both versions already include `coverageSuppressions` and
   per-operator site counts. Exclude timings, diagnostics and execution receipts
   from equality checks and retain the original timings separately. In runner
   reports, reduce per-run temporary directories to base file names and mask
   per-run `capture-<process>-<clock>-` IDs in text; 639 such differences were
   set aside this way.
5. For all 350 full reports in each build, assert that setup jobs, mutant jobs,
   worker baselines and prepared baselines sum to `jobsAttempted`. A setup's
   baseline, coverage or direct typecheck counts once when its evidence has
   `ms`; a compiler helper counts once when `compilerStrictness.job` exists. A
   reused typecheck adds no job. The JSON retains this derivation as setup
   `attemptedJobs` and report `jobArithmetic` fields.

Each compared source file has a raw-byte SHA-256 and artifact ID, digest, run
URL and head. Baseline hashes and coordinates equal those in the [previous
report](assessment-scope-verdicts.json) (56 files). Every artifact ZIP of both
builds was downloaded into memory, matched to its GitHub digest, and every
compared JSON file equals its ZIP member byte for byte. Source-array hashes use
UTF-8 JSON with sorted keys, compact separators and literal Unicode. Repeated
outcome lists are stored once in `outcomeSets`; each report references its
shared, added and removed lists, which preserves report multiplicity. Baseline
outcomes are shared plus removed; candidate outcomes are shared plus added. The
method and field exclusions are also in the JSON.

## Outcomes

| Artifact | Reports | Outcomes (both builds) | Changed verdicts |
| --- | ---: | ---: | ---: |
| `linux-x64-package-proof` | 108 | 605 | 0 |
| `linux-arm64-package-proof` | 80 | 483 | 0 |
| `macos-x64-package-proof` | 80 | 483 | 0 |
| `macos-arm64-package-proof` | 139 | 622 | 0 |
| `windows-x64-package-proof` | 89 | 489 | 0 |
| `linux-x64-latest-node` | 59 | 139 | 0 |
| `linux-arm64-latest-node` | 59 | 139 | 0 |
| `macos-x64-latest-node` | 59 | 139 | 0 |
| `windows-x64-latest-node` | 59 | 139 | 0 |
| `windows-shared-fixture-evidence` | 27 | 97 | 0 |
| `windows-runtime-cli-evidence` | 6 | 3 | 0 |
| `windows-runtime-preflight` | 0 | 0 | 0 |
| **Total** | **765** | **3,338** | **0** |

The compared files cover the public examples, Vitest and Jest/Expo checks,
standalone/operator proofs, Debian execution, cancellation, parallel fault
injection, crash continuation, latest Node and Windows runtime scenarios. The
JSON lists every compared file and report pointer. `windows-runtime-preflight`
is metadata only: its JSON has no assessment outcomes. Packaging, notices and
stage validation are outside this assessment comparison.

In each build, 341 reports are incomplete and 52 are cancelled, with the same
states and signals. Across all compared outcomes, `countedAsKilled` stays false
and `countedTimeouts` stays zero. Expected execution errors, cancellations and
timeouts keep their unresolved verdicts.

The statement operator proof, which this patch does not touch, keeps identical
semantic facts on all five hosts and across both builds, and its proof source
file is byte-identical at the two heads (SHA-256
`0ed349aee4deadbc864ec94d7a23d5ec2663e1fd0fb2cc5888417c6ed24cdc9f`).

## Job counts and scheduling variation

All 350 full-report job sums hold in both builds. Of the full reports, 8 differ
in attempted jobs or the setup rows behind them; each is a `source-error`
scenario. Of these, 5 fall by one job, 2 rise by one and 1 keeps its total while
swapping which mutant ran its second setup; the net change is -3. In each, one
mutant's second setup (`low`) is either an attempted execution error ("captured
source changed during execution") or `not-run`. Verdicts, completeness and
withheld scores are identical; the counts below are unnormalised.

| Report | jobsAttempted | Mutation jobs | Setup-row evidence |
| --- | --- | --- | --- |
| `linux-x64-package-proof` `debian11.json` | 14 → 13 | 4 → 3 | mutant 0 (`>=` → `>`): `low` execution-error → not-run |
| `linux-x64-package-proof` `standalone.json` | 13 → 14 | 3 → 4 | mutant 0 (`>=` → `>`): `low` not-run → execution-error |
| `linux-arm64-package-proof` `standalone.json` | 14 → 13 | 4 → 3 | mutant 0 (`>=` → `>`): `low` execution-error → not-run |
| `windows-x64-package-proof` `shared-parallel.json` | 14 → 13 | 4 → 3 | mutant 0 (`>=` → `>`): `low` execution-error → not-run |
| `linux-x64-latest-node` `node-24.22.2/parallel.json` | 13 → 14 | 3 → 4 | mutant 0 (`>=` → `>`): `low` not-run → execution-error |
| `linux-arm64-latest-node` `node-24.22.2/parallel.json` | 13 → 13 | 3 → 3 | mutant 1 (`>=` → `<`): `low` not-run → execution-error; mutant 0 (`>=` → `>`): `low` execution-error → not-run |
| `macos-x64-latest-node` `node-24.22.2/parallel.json` | 14 → 13 | 4 → 3 | mutant 0 (`>=` → `>`): `low` execution-error → not-run |
| `windows-shared-fixture-evidence` `shared-parallel.json` | 14 → 13 | 4 → 3 | mutant 1 (`>=` → `<`): `low` execution-error → not-run |

Variation of this kind already exists inside each build, so these reports do not
show a systematic change. Across the 13 retained `source-error` reports, 0.12.0
has 6 with 13 and 7 with 14 job totals and 0.12.1 has 9 with 13 and 4 with 14. A
single run per host cannot show whether either build shifts that distribution.
This is the same scheduling variation recorded in the [previous
comparison](assessment-scope-verdicts.md#scheduling-variation-and-timings).

| Report | 0.12.0 jobsAttempted (mutants whose `low` setup ran) | 0.12.1 jobsAttempted (mutants whose `low` setup ran) |
| --- | --- | --- |
| `linux-x64-package-proof` `debian11.json` `/parallelChecks` | 13 (mutant 0) | 13 (mutant 0) |
| `linux-x64-package-proof` `debian11.json` `/standaloneParallelChecks` | 14 (mutant 0,1) | 13 (mutant 1) |
| `linux-x64-package-proof` `standalone.json` `/parallelChecks` | 13 (mutant 1) | 14 (mutant 0,1) |
| `linux-arm64-package-proof` `standalone.json` `/parallelChecks` | 14 (mutant 0,1) | 13 (mutant 1) |
| `macos-x64-package-proof` `standalone.json` `/parallelChecks` | 13 (mutant 1) | 13 (mutant 1) |
| `macos-arm64-package-proof` `node-24.22.2/parallel.json` `/` | 13 (mutant 0) | 13 (mutant 0) |
| `macos-arm64-package-proof` `standalone.json` `/parallelChecks` | 14 (mutant 0,1) | 14 (mutant 0,1) |
| `windows-x64-package-proof` `shared-parallel.json` `/` | 14 (mutant 0,1) | 13 (mutant 1) |
| `linux-x64-latest-node` `node-24.22.2/parallel.json` `/` | 13 (mutant 1) | 14 (mutant 0,1) |
| `linux-arm64-latest-node` `node-24.22.2/parallel.json` `/` | 13 (mutant 0) | 13 (mutant 1) |
| `macos-x64-latest-node` `node-24.22.2/parallel.json` `/` | 14 (mutant 0,1) | 13 (mutant 1) |
| `windows-x64-latest-node` `node-24.22.2/parallel.json` `/` | 14 (mutant 0,1) | 14 (mutant 0,1) |
| `windows-shared-fixture-evidence` `shared-parallel.json` `/` | 14 (mutant 0,1) | 13 (mutant 0) |

## Cancelled exit codes

Six cancellation reports differ only in the recorded exit code of a cancelled
process on Windows (five in a setup job, one in a mutant setup row). State,
`cancelled` flag, jobs and verdicts match:

| Report | Job | Exit code, 0.12.0 → 0.12.1 |
| --- | --- | --- |
| `windows-x64-package-proof` `shared-cli.json` `/SIGTERM` | typecheck (cancelled) | -1073741510 → 1 |
| `windows-x64-package-proof` `windows-runtime-cli-evidence.json` `/scenarios/consoleCancellation` | baseline (cancelled) | 1 → -1073741510 |
| `windows-x64-latest-node` `node-24.22.2/cli.json` `/SIGINT` | typecheck (cancelled) | -1073741510 → 1 |
| `windows-shared-fixture-evidence` `shared-cli.json` `/SIGINT` | typecheck (cancelled) | 1 → -1073741510 |
| `windows-shared-fixture-evidence` `shared-cli.json` `/SIGTERM` | typecheck (cancelled) | 1 → -1073741510 |
| `windows-shared-fixture-evidence` `shared-parallel.json` `/SIGINT` | mutant 1 setup `high` (cancelled) | -1073741510 → 1 |

Windows reports either `1` or `-1073741510` (`0xC000013A`, console interrupt)
for these cancelled children, in both builds and in both directions. Across all
retained cancelled Windows setup rows, 0.12.0 has 18 with `-1073741510` and 5
with `1`; 0.12.1 has 18 and 5. Every cancelled Linux and macOS row records no
exit code (`null`) in both builds.

## Timings

The JSON retains all available `phaseTimings`: 465 baseline and 465 candidate
objects, and every full report has them. Mutation/pseudo-test wall times and
per-operator times are retained separately where supplied; `phaseTimings` itself
does not contain those wall times. Nulls remain null.

For orientation only, these are sums across each host's example, Vitest and
Jest/Expo full reports (`summary.json`, `vitest-check.json`,
`jest-expo-check.json`), rounded to milliseconds. Exact report-level numbers
remain in the JSON. They are one sample per scenario on shared hosts and support
no performance claim.

| Host | Reports | Execution ms, 0.12.0 → 0.12.1 | Mutation wall ms | Pseudo-test wall ms |
| --- | ---: | --- | --- | --- |
| Linux x64 | 12 | 61,866 → 96,619 | 17,068 → 26,904 | 9,279 → 14,779 |
| Linux ARM64 | 12 | 85,121 → 87,551 | 24,539 → 25,002 | 13,285 → 13,631 |
| macOS x64 | 12 | 147,472 → 183,896 | 38,076 → 52,768 | 21,812 → 25,900 |
| macOS ARM64 | 12 | 117,945 → 89,887 | 33,787 → 24,638 | 17,957 → 13,522 |
| Windows x64 | 12 | 134,226 → 104,025 | 39,811 → 30,014 | 22,127 → 16,570 |

## Verification and limits

The one-off comparison and retained-data round trip passed assert-based checks
for duplicate handling, identity uniqueness, all 700 full-report job sums,
per-operator count sums, shared outcome equality, source equality, source
commits and reconstruction of both verdict totals. A separate validation script
recounts reports and outcomes from the raw JSON with its own walker, rechecks
every file hash and ZIP digest, and resolves links. The public files use
portable paths.

- No builds, dependency installation or new assessments were run. This compares
  the retained CI artifacts of the two direct heads, rather than rerunning
  fixtures locally.
- The 130 Node load-failure reports (210 outcomes per build) retain outcome ID,
  verdict and evidence status but no source edit identity. Identity claims for
  them are limited to IDs and scenario positions.
- Statement operator proof rows retain only the operator phase and
  totalJobsAttempted. Their per-mutant identities are not retained; the proof
  facts (semantics, fixture hashes, equivalent mutants) are compared separately
  and the proof source file is byte-identical at both heads.
- Runner diagnostics, individual setup execution receipts, execution IDs,
  load-failure diagnostic text and temporary filesystem paths are excluded from
  outcome comparison; temporary-directory prefixes in runner reports are reduced
  to base file names and capture IDs in text are masked. Source arrays are
  compared in full.
- Reports without an outer CLI envelope have no retained quality state. Missing
  partial-report metrics remain missing, not zero.
- Scheduling-sensitive job counts (the source-error scenario) and Windows exit
  codes of cancelled child processes vary between runs of the same build. A
  single retained run of each cannot show that either build differs
  systematically; the censuses show the spread inside each build.
- The linux-x64-debian-stage-evidence artifact of the Linux x64 runs, the build
  logs and archives in each package artifact are outside this comparison (it
  covers the 12 artifacts named in artifacts[]).
- Timings are one sample per scenario on shared hosts. No speedup, rare-failure
  fix, notice audit, stage validation, installation check or publication
  approval is inferred.
