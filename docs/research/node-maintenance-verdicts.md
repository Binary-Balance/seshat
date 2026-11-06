# Node maintenance verdict evidence

The 0.13.0 candidate keeps all 3,338 outcome identities in the previous
comparison's 765-report scope. Exactly 115 verdicts change from
`execution-error` to `killed` on actual Node 24.22.2: 110 outcomes in eleven
attributable import-failure scenarios and five `mixed-files` outcomes with no
concurrent unresolved file error. No identity is added, removed or renumbered.
Every source assessment array is identical.

A separate, bounded CLI supplement retains 16 full reports and 16 outcomes from
two observer cases in eight CLI suites. It adds five intended `execution-error`
→ `killed` changes. Combined, the two scopes contain 781 reports, 3,354 outcomes
and 120 changed verdicts. No unexplained semantic difference remains.
Source-error scheduling, cancelled Windows exits and thirteen adaptive timeout
limits also differ; their actual values are retained below.

This is the release comparison for
[#267](https://github.com/Binary-Balance/seshat/issues/267) and [PR
#268](https://github.com/Binary-Balance/seshat/pull/268). The [JSON
record](node-maintenance-verdicts.json) holds report pointers, raw hashes,
artifact links, exact counters, original timings, actual runtime/observer
receipts and every classified difference. The previous [execution reliability
comparison](execution-reliability-verdicts.json) remains the baseline provenance
record; its 0.12.1 candidate coordinates and all 56 compared source JSON hashes
match.

## Builds and artifact scope

Released 0.12.1 has direct head `d64aa48f243f6e4647b23cdf93ccc557877a1f42` and
was built from merge commit `a106c83e94a4b956f75338d9da17abc6ff7fa1f4`. The
0.13.0 candidate has direct head `8b51fd7859e71124edf7a18d218cb302fcafd64f` and
was built from merge commit `a195f7b55fba51df670c0cd0709d15537011014f`. These
match the [preserved baseline audit](../releases/0.12.1-audit.json) and the
[candidate audit](../releases/0.13.0-audit.json). Every compared artifact's run head
equals its build's direct head; the native package artifact coordinates also
match the audits.

| Workflow | 0.12.1 run | 0.13.0 run |
| --- | --- | --- |
| Linux x64 | [41618407576](https://github.com/Binary-Balance/seshat/actions/runs/41618407576) | [41998219578](https://github.com/Binary-Balance/seshat/actions/runs/41998219578) |
| Linux ARM64 | [41618407524](https://github.com/Binary-Balance/seshat/actions/runs/41618407524) | [41998219546](https://github.com/Binary-Balance/seshat/actions/runs/41998219546) |
| macOS, both architectures | [41618407710](https://github.com/Binary-Balance/seshat/actions/runs/41618407710) | [41998219666](https://github.com/Binary-Balance/seshat/actions/runs/41998219666) |
| Windows x64 | [41618407605](https://github.com/Binary-Balance/seshat/actions/runs/41618407605) | [41998219598](https://github.com/Binary-Balance/seshat/actions/runs/41998219598) |
| Windows runtime | [41618407578](https://github.com/Binary-Balance/seshat/actions/runs/41618407578) | [41998219594](https://github.com/Binary-Balance/seshat/actions/runs/41998219594) |

Both builds use Node 24.20.0 for pinned package checks and actual Node 24.22.2
for the latest-Node suites. The macOS ARM64 latest suite is inside its package
artifact. The four other latest suites have separate artifacts. Windows
preflight has no assessment outcomes. The supplemental column shows full reports
/ changed verdicts and is separate from the original scope.

| Artifact | Original reports | Full reports | Outcomes per build | Changed verdicts | CLI supplement |
| --- | ---: | ---: | ---: | ---: | ---: |
| `linux-x64-package-proof` | 108 | 51 | 605 | 0 | 2 / 0 |
| `linux-arm64-package-proof` | 80 | 23 | 483 | 0 | 0 / 0 |
| `macos-x64-package-proof` | 80 | 23 | 483 | 0 | 0 / 0 |
| `macos-arm64-package-proof` | 139 | 56 | 622 | 23 | 2 / 1 |
| `windows-x64-package-proof` | 89 | 32 | 489 | 0 | 2 / 0 |
| `linux-x64-latest-node` | 59 | 33 | 139 | 23 | 2 / 1 |
| `linux-arm64-latest-node` | 59 | 33 | 139 | 23 | 2 / 1 |
| `macos-x64-latest-node` | 59 | 33 | 139 | 23 | 2 / 1 |
| `windows-x64-latest-node` | 59 | 33 | 139 | 23 | 2 / 1 |
| `windows-shared-fixture-evidence` | 27 | 27 | 97 | 0 | 2 / 0 |
| `windows-runtime-cli-evidence` | 6 | 6 | 3 | 0 | 0 / 0 |
| `windows-runtime-preflight` | 0 | 0 | 0 | 0 | 0 / 0 |
| **Total** | **765** | **350** | **3,338** | **115** | **16 / 5** |

All 24 artifact ZIPs were downloaded and checked against their GitHub SHA-256
digests and byte sizes, CRCs, safe unique membership, and exact extracted JSON
membership. All 108 JSON files per build match their ZIP members byte for byte.
Metadata snapshots also retain changed binary/tarball hashes and Windows
preflight release coordinates, capture time, runner image and command-shell
version; those are separate from assessment counters. The JSON retains those
receipts and each compared file's raw-byte hash. ZIP bytes are not retained in
the public report; the artifact URLs and digests identify them until GitHub
expiry (baseline artifacts: 1 February 2027; candidate: 3 February 2027).

## Node load-failure changes

Every latest host retains 26 scenarios and 42 planned outcomes. The table below
is identical on all five hosts and includes both outcomes when a scenario has
two. The structured legacy rows retain ID, verdict and execution evidence rather
than source-edit identity; matching those rows proves ID/scenario parity only.

| Scenario | Outcomes per host | Verdicts per host, 0.12.1 → 0.13.0 | Completeness and score |
| --- | ---: | --- | --- |
| `module-guard` | 2 | 2 execution-error → 2 killed | incomplete, score null → complete, score 100 |
| `catch-guard` | 2 | 2 execution-error → 2 killed | incomplete, score null → complete, score 100 |
| `finally-guard` | 2 | 2 execution-error → 2 killed | incomplete, score null → complete, score 100 |
| `try-finally-guard` | 2 | 2 execution-error → 2 killed | incomplete, score null → complete, score 100 |
| `nested-try-finally` | 2 | 2 execution-error → 2 killed | incomplete, score null → complete, score 100 |
| `nested-child-cwd` | 2 | 2 execution-error → 2 killed | incomplete, score null → complete, score 100 |
| `unicode-crlf` | 2 | 2 execution-error → 2 killed | incomplete, score null → complete, score 100 |
| `called-guard` | 2 | 2 execution-error → 2 killed | incomplete, score null → complete, score 100 |
| `function-in-try` | 2 | 2 execution-error → 2 killed | incomplete, score null → complete, score 100 |
| `arrow-in-try` | 2 | 2 execution-error → 2 killed | incomplete, score null → complete, score 100 |
| `custom-error` | 2 | 2 execution-error → 2 killed | incomplete, score null → complete, score 100 |
| `setup-throw` | 1 | 1 execution-error → 1 execution-error | incomplete, score null → incomplete, score null |
| `process-exit` | 1 | 1 execution-error → 1 execution-error | incomplete, score null → incomplete, score null |
| `missing-module` | 1 | 1 execution-error → 1 execution-error | incomplete, score null → incomplete, score null |
| `reused-error` | 1 | 1 execution-error → 1 execution-error | incomplete, score null → incomplete, score null |
| `caught-error` | 1 | 1 execution-error → 1 execution-error | incomplete, score null → incomplete, score null |
| `outer-catches-catch` | 1 | 1 execution-error → 1 execution-error | incomplete, score null → incomplete, score null |
| `outer-catches-finally` | 1 | 1 execution-error → 1 execution-error | incomplete, score null → incomplete, score null |
| `outer-catches-static` | 1 | 1 execution-error → 1 execution-error | incomplete, score null → incomplete, score null |
| `function-has-catch` | 2 | 1 execution-error, 1 survived → 1 execution-error, 1 survived | incomplete, score null → incomplete, score null |
| `background-error` | 1 | 1 execution-error → 1 execution-error | incomplete, score null → incomplete, score null |
| `custom-stack` | 2 | 2 execution-error → 2 execution-error | incomplete, score null → incomplete, score null |
| `primitive-throw` | 2 | 2 execution-error → 2 execution-error | incomplete, score null → incomplete, score null |
| `mixed-files` | 2 | 2 execution-error → 1 execution-error, 1 killed | incomplete, score null → incomplete, score null |
| `unverified-observer-import` | 2 | 2 execution-error → 2 execution-error | incomplete, score null → incomplete, score null |
| `unverified-observer-assertion` | 1 | 1 killed → 1 killed | complete, score 100 → complete, score 100 |

The eleven attributable scenarios each have two outcomes. On every latest host,
both now have a complete runner receipt, zero unresolved errors, one failed test
file and one attributed application module failure. Their phase reports become
complete with score 100. The retained receipt includes actual Node version, file
names, line/column and test counts. Setup throws, missing modules, caught or
reused errors, background failures, custom stacks and primitive throws retain
unresolved verdicts.

`mixed-files` needs both outcomes explained. Outcome 0 changes its runner counts
from errors=2/failed=0 to errors=1/failed=1 and gains one attributed application
failure, but stays `execution-error` because an unrelated file still errors.
Outcome 1 changes from errors=1/failed=0/passed=1 to errors=0/failed=1/passed=1
and becomes `killed`. Its raw diagnostic emits `if ((ready))`; the unrelated
fixture only throws when the source contains `!==`, which belongs to outcome 0.
The second execution therefore has positive application attribution and no
concurrent unresolved file failure. The `mixed-files` report stays incomplete
with score `null`, and its killed count rises from 0 to 1.

The synthetic legacy fallback keeps the scenario names
`unverified-observer-import` and `unverified-observer-assertion`, but changes
the forced Node version from `24.22.0` to `24.21.0-rc.1`. The import stays
unresolved and the ordinary assertion stays killed. Both actual-runtime receipts
and this synthetic version change are retained; this is guard testing, not
prerelease support evidence.

## CLI observer supplement and diagnostics

Ordinary CLI proof rows store their JSON result only in a stdout string. The
previous structural walker deliberately omitted JSON strings. This supplement
parses only `import-observer` and the fallback scenario, preserving separate
counts. Its JSON `pointer` selects the stdout string, `decodedPointer` is
`/result`, and `baselinePointer` records a renamed case. Other JSON stdout
remains outside the comparison.

| CLI suite | Import case: runtime, observer, verdict | Scenario count |
| --- | --- | ---: |
| `linux-x64-package-proof` `debian11.json` | 24.20.0, active, killed → 24.20.0, active, killed | 85 → 85 |
| `macos-arm64-package-proof` `node-24.22.2/cli.json` | 24.22.2, inactive, execution-error → 24.22.2, active, killed | 85 → 85 |
| `windows-x64-package-proof` `shared-cli.json` | 24.20.0, active, killed → 24.20.0, active, killed | 85 → 85 |
| `linux-x64-latest-node` `node-24.22.2/cli.json` | 24.22.2, inactive, execution-error → 24.22.2, active, killed | 85 → 85 |
| `linux-arm64-latest-node` `node-24.22.2/cli.json` | 24.22.2, inactive, execution-error → 24.22.2, active, killed | 85 → 85 |
| `macos-x64-latest-node` `node-24.22.2/cli.json` | 24.22.2, inactive, execution-error → 24.22.2, active, killed | 85 → 85 |
| `windows-x64-latest-node` `node-24.22.2/cli.json` | 24.22.2, inactive, execution-error → 24.22.2, active, killed | 85 → 85 |
| `windows-shared-fixture-evidence` `shared-cli.json` | 24.20.0, active, killed → 24.20.0, active, killed | 85 → 85 |

The five latest-Node import cases change exit status 2 → 0, become complete with
mutation score 100, and change the outer quality state from `incomplete` to
`not-configured` (these cases configure no quality threshold). Each has one
attributed module failure and zero unresolved errors. Pinned Node 24.20.0 import
cases remain active and killed. The original structural reports retain sixty
actual-runtime diagnostic changes; the supplement retains thirteen more report
diagnostic changes. All five latest-suite summaries, including the embedded
macOS ARM64 summary, also add the explicit `active` / actual `24.22.2` /
`killed` receipt.

Two explicit scenario mappings apply in each of the eight 85-case suites:

- `import-observer-unverified` → `import-observer-missing-context`
- `import-observer-unverified-readable` →
  `import-observer-missing-context-readable`

The baseline control forced unsupported Node `24.22.0`. The candidate runs on
its actual supported runtime after deleting `SESHAT_LOAD_CONTEXT`. All eight
JSON fallback cases remain `execution-error`, incomplete, score `null`, exit 2
and without a module-failure receipt. Their diagnostics correctly say the
observer version gate is active. This proves an active gate alone cannot
establish a kill without load context. The readable case retains the withheld
score and unresolved count; its inactive-observer message disappears. Eight
individual duration lines change and remain in the JSON as `readableDuration`,
with the surrounding text required to match exactly. Every suite retains all 85
scenario names/statuses, including the restored readable case.

## Counts and unchanged assessments

| Verdict | Original 0.12.1 | Original 0.13.0 | CLI 0.12.1 | CLI 0.13.0 |
| --- | ---: | ---: | ---: | ---: |
| killed | 1,968 | 2,083 | 3 | 8 |
| survived | 639 | 639 | 0 | 0 |
| execution-error | 391 | 276 | 13 | 8 |
| not-run | 203 | 203 | 0 | 0 |
| timed-out | 61 | 61 | 0 | 0 |
| cancelled | 52 | 52 | 0 | 0 |
| unassessed | 24 | 24 | 0 | 0 |

Original incomplete reports fall from 341 to 286 solely through the 55 complete
attributable phase results. The supplement's incomplete reports fall from 13 to
8 through five import cases. Original cancellation remains 52 reports per build,
with the same flags and signals. Worker/prepared baseline counts, all other
verdicts, pseudo-test results, source arrays, per-operator site counts and
unaffected scores/quality states are preserved. No timeout is counted as killed.

The statement operator proof retains the same semantic facts, fixture hashes,
equivalent mutants and samples on all five native hosts and across builds. Its
source file is byte-identical at the two heads, SHA-256
`0ed349aee4deadbc864ec94d7a23d5ec2663e1fd0fb2cc5888417c6ed24cdc9f`. That proof
does not retain individual mutant source identities; those claims remain limited
to its available phase and semantic facts.

## Source-error scheduling

Twelve `source-error` reports differ in which mutant attempted its second setup
(`low`). Four gain one attempted job, four lose one, and four keep the same
total while swapping the attempted mutant. Net job change is zero. The attempted
setup errors with “captured source changed during execution”; the other state is
`not-run`. Verdicts, source assessments, incomplete state and withheld scores
stay equal. Both builds' complete 13-report census contains nine reports with 13
jobs and four with 14 jobs. The JSON retains every census row, not just
differences.

| Report | jobsAttempted | Mutation jobs | `low` setup evidence |
| --- | ---: | ---: | --- |
| `linux-x64-package-proof` `debian11.json` `/parallelChecks/source-error/result` | 13 → 14 | 3 → 4 | mutant 1: not-run → execution-error |
| `linux-x64-package-proof` `debian11.json` `/standaloneParallelChecks/source-error/result` | 13 → 14 | 3 → 4 | mutant 0: not-run → execution-error |
| `linux-x64-package-proof` `standalone.json` `/parallelChecks/source-error/result` | 14 → 13 | 4 → 3 | mutant 0: execution-error → not-run |
| `linux-arm64-package-proof` `standalone.json` `/parallelChecks/source-error/result` | 13 → 14 | 3 → 4 | mutant 0: not-run → execution-error |
| `macos-x64-package-proof` `standalone.json` `/parallelChecks/source-error/result` | 13 → 13 | 3 → 3 | mutant 1: execution-error → not-run; mutant 0: not-run → execution-error |
| `macos-arm64-package-proof` `standalone.json` `/parallelChecks/source-error/result` | 14 → 13 | 4 → 3 | mutant 0: execution-error → not-run |
| `windows-x64-package-proof` `shared-parallel.json` `/source-error/result` | 13 → 13 | 3 → 3 | mutant 1: execution-error → not-run; mutant 0: not-run → execution-error |
| `linux-x64-latest-node` `node-24.22.2/parallel.json` `/source-error/result` | 14 → 13 | 4 → 3 | mutant 0: execution-error → not-run |
| `linux-arm64-latest-node` `node-24.22.2/parallel.json` `/source-error/result` | 13 → 14 | 3 → 4 | mutant 0: not-run → execution-error |
| `macos-x64-latest-node` `node-24.22.2/parallel.json` `/source-error/result` | 13 → 13 | 3 → 3 | mutant 1: execution-error → not-run; mutant 0: not-run → execution-error |
| `windows-x64-latest-node` `node-24.22.2/parallel.json` `/source-error/result` | 14 → 13 | 4 → 3 | mutant 1: execution-error → not-run |
| `windows-shared-fixture-evidence` `shared-parallel.json` `/source-error/result` | 13 → 13 | 3 → 3 | mutant 1: not-run → execution-error; mutant 0: execution-error → not-run |

This is the same scheduling-sensitive scenario described in the [previous
comparison](execution-reliability-verdicts.md). The observed counts show
within-build variation; one sample cannot establish whether either build changes
its distribution.

## Cancelled Windows exits

Six reports differ only in the recorded exit code of a cancelled child process,
alongside any separately listed scheduling variation. Every affected row remains
cancelled with matching state, jobs and verdicts. Both codes occur in both
builds: `1` and `-1073741510` (`0xC000013A`, console interrupt). Across the
original scope's cancelled Windows rows, their counts are 5/18 in 0.12.1 and
1/22 in 0.13.0. Cancelled Linux and macOS rows retain `null` exit codes.

| Report | Job | Exit, 0.12.1 → 0.13.0 |
| --- | --- | ---: |
| `windows-x64-package-proof` `shared-cli.json` `/SIGINT/result` | typecheck | 1 → -1073741510 |
| `windows-x64-package-proof` `shared-cli.json` `/SIGTERM/result` | typecheck | 1 → -1073741510 |
| `windows-x64-package-proof` `shared-cli.json` `/SIGTERM-after-receipt/result` | baseline | -1073741510 → 1 |
| `windows-x64-latest-node` `node-24.22.2/cli.json` `/SIGINT/result` | typecheck | 1 → -1073741510 |
| `windows-shared-fixture-evidence` `shared-parallel.json` `/SIGINT/result` | mutant 1, setup `high` | 1 → -1073741510 |
| `windows-runtime-cli-evidence` `windows-runtime-cli-evidence.json` `/scenarios/consoleCancellation/result` | baseline | 1 → -1073741510 |

## Adaptive timeout limits

Thirteen macOS x64 Jest reports have different actual mutant timeout limits.
Each is retained as `adaptiveTimeout`; none is dropped by a broad `*Ms` rule. In
both builds every value exactly equals `min(60000, max(30000, ceil(5 ×
baseline.ms)))`, using that run's own passing baseline. No worker baseline
contributes in these reports. The 60,000 ms configured job limit, 30,000 ms
minimum and factor 5 are unchanged. Their outcomes, completeness and scores
match. Exact baseline milliseconds and the derivation are in each JSON
`adaptiveTimeoutChecks` row.

| Report | mutantTimeoutMs, 0.12.1 → 0.13.0 |
| --- | ---: |
| `macos-x64-package-proof` `jest-expo-check.json` `/runs/normal-1/report/result` | 39945 → 60000 |
| `macos-x64-package-proof` `jest-expo-check.json` `/runs/assertion-kill/report/result` | 30687 → 39116 |
| `macos-x64-package-proof` `summary.json` `/publicExamples/examples/jest-expo/normal/result` | 30000 → 31993 |
| `macos-x64-latest-node` `node-24.22.2/jest-expo-check.json` `/runs/normal-1/report/result` | 59826 → 60000 |
| `macos-x64-latest-node` `node-24.22.2/jest-expo-check.json` `/runs/automatic-cleanup/report/result` | 33744 → 30000 |
| `macos-x64-latest-node` `node-24.22.2/jest-expo-check.json` `/runs/mixed-load-hook/report/result` | 33551 → 30000 |
| `macos-x64-latest-node` `node-24.22.2/jest-expo-check.json` `/runs/before-all-timeout/report/result` | 34845 → 38028 |
| `macos-x64-latest-node` `node-24.22.2/jest-expo-check.json` `/runs/assertion-kill/report/result` | 35066 → 39367 |
| `macos-x64-latest-node` `node-24.22.2/jest-expo-check.json` `/runs/expect-assertions/report/result` | 31991 → 30000 |
| `macos-x64-latest-node` `node-24.22.2/jest-expo-check.json` `/runs/survivor/report/result` | 32672 → 30000 |
| `macos-x64-latest-node` `node-24.22.2/jest-expo-check.json` `/runs/before-all/report/result` | 32034 → 33243 |
| `macos-x64-latest-node` `node-24.22.2/jest-expo-check.json` `/runs/test-timeout/report/result` | 31738 → 30000 |
| `macos-x64-latest-node` `node-24.22.2/jest-expo-check.json` `/runs/hook-timeout/report/result` | 30998 → 30000 |

These are timing-derived limits, not performance evidence.
`uncappedMutantTimeoutMs` remains compared exactly too.

## Method, verification and limits

Reports pair by artifact name, relative JSON path and report pointer, with only
the two explicit CLI scenario mappings above. A duplicated `result` and
`report.result` must be deeply equal before one is omitted. The public-example
file must equal its embedded summary fields before its duplicate is omitted.
Separate executions and hosts remain separate reports.

Within each phase, source-edit identities use kind, path, offset, original text
and replacement; global/local IDs and every other retained outcome field are
then compared. Node load rows use phase and ID. Full source arrays compare
without normalization. The JSON interns repeated outcome lists under
`outcomeSets`: baseline rows are shared+removed; candidate rows apply every
stored `candidateChanges` operation to shared rows, then add new rows. This
release has no additions/removals. Setup states, runner counts, load-attribution
receipts and all changed values remain reconstructible.

The original scope retains 465 `phaseTimings` objects per build; the supplement
adds 16. All 366 full reports per build retain them. Original floating-point
values, scalar phase/per-operator timings and nulls remain exact. Equality
excludes only an explicit duration field list, diagnostic text/derived
scheduling diagnostics and per-run execution identities. Timeout limits stay
semantic. Actual runtime and observer diagnostics remain compared. Inside runner
reports, temporary paths become base names and execution/capture IDs are removed
or masked; file names, line/column, states and counts remain. The original
assessment comparison counts 639 such temporary-identity differences in 85
reports. Observer receipt paths use the same documented basename rule. No
source-array normalization occurs.

All 732 full-report job sums pass: setup baseline/coverage/direct-typecheck jobs
plus compiler jobs, phase jobs, worker baselines and prepared baselines equal
`jobsAttempted`. Reused typecheck contributes no job. Per-operator
planned/completed/job sums pass too. An independent verifier imports no
comparison code: it reconstructs every retained outcome against raw JSON,
independently walks and recounts the structural reports, checks phase
counters/timings, runtime diagnostics, all 366 source-array pairs, 112
report-file hash checks, all 216 ZIP JSON hash checks, baseline provenance, CLI
inventories and adaptive-limit arithmetic. Links, portable paths and whitespace
checks pass. No unexplained difference remains.

- No builds, dependency installation or new assessments were run; this compares
  retained CI artifacts of two direct heads.
- The original scope has 765 structural report projections. The separate
  observer CLI supplement parses only two JSON stdout cases in each of eight
  85-scenario CLI suites. Other JSON stdout, readable output beyond the stated
  fallback projection, and packaging/stage checks are outside this assessment
  comparison.
- The 130 Node load-failure reports retain 210 structured outcomes per build
  with ID-only identity. Diagnostic source text explains mixed-files outcome 1,
  but does not turn the retained rows into full source-edit identities.
- Statement operator rows retain phase counters rather than each mutant
  identity. Separate semantic facts and proof source hashes are retained for all
  five hosts.
- Exclude raw runner diagnostic text, execution IDs, individual mutant execution
  durations and setup execution receipts beyond the retained status/report
  projections. Normalize only per-run runner-report paths/capture IDs as
  documented; preserve source arrays and timeout limits.
- Missing partial-report metrics remain absent and null timings remain null.
  Reports without an outer CLI envelope have no retained quality state.
- Source-error scheduling, Windows cancelled child exit codes and timing-derived
  timeout limits vary between retained runs. The report retains actual values
  and the checks explaining them; a single run cannot establish a distribution
  or performance change.
- Artifact ZIP members and all extracted JSON bytes are verified, but build
  logs, package archives, the separate linux-x64-debian-stage-evidence artifact,
  notices and publication approval are outside this comparison.
- Readable fallback projections retain their exact diagnostic lines, including
  eight changing individual execution durations. Those eight differences are
  classified readableDuration after requiring all surrounding text to match.
- All timings are actual single shared-runner samples. No performance claim
  follows.
