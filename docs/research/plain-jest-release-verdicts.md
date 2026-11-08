# 0.14.0 → 0.15.0 native verdict comparison

All **3,218 retained shared outcomes** keep their verdicts and counted-kill
flags: 2,840 mutation outcomes and 378 extreme/pseudo-testing outcomes.
There are no added or removed outcomes within shared reports. All **508 full
source assessment arrays (549 source records)** are byte-for-byte equivalent
as canonical JSON before path normalization. Scores and completion states match:
298 shared full reports are complete and 210 remain incomplete.

The eight artifact pairs contain **819 report pairs**, 19 added full reports
and no removed reports. Every consumed JSON member was byte-checked against its
exact GitHub artifact ZIP: **16 ZIPs, 175 JSON members** (87 baseline, 88
candidate). The embedded macOS arm64 Node 24.22.2 evidence is included.

| Artifact | Report pairs | Shared outcome pairs |
| --- | ---: | ---: |
| linux-arm64-package-proof | 95 | 493 |
| linux-x64-package-proof | 180 | 714 |
| macos-arm64-package-proof | 211 | 731 |
| macos-x64-package-proof | 95 | 493 |
| windows-runtime-cli-evidence | 6 | 3 |
| windows-runtime-preflight | 0 | 0 |
| windows-shared-fixture-evidence | 84 | 196 |
| windows-x64-package-proof | 148 | 588 |

Baseline: [0.14.0 audit](../releases/0.14.0-audit.json), merge source
`96558b09e79268114b94e8f401fd5377584e11b2`, direct build head
`3e4cb482fb914d36c6b8cee5f39912f679b87eb7`. Candidate: 0.15.0 merge source
`8f8f2e80eed241d6276d66605a98f22bcda4de9b`, frozen direct build head
`e82e0b2ad8a680373598a87600494833604ae91f` in
[PR #280](https://github.com/Binary-Balance/seshat/pull/280), tracked by
[issue #279](https://github.com/Binary-Balance/seshat/issues/279).

The [comparison JSON](plain-jest-release-verdicts.json) retains coordinates, stable identities,
all differences, source-array hashes, completion/score summaries, execution
flags, and measured jobs/timings. The [artifact verification](plain-jest-release-artifacts.json)
retains official IDs, run/head/name metadata, ZIP digests/sizes, and member
hashes. `artifactVerificationSha256` binds the records. Local `work/` paths name
retained inputs; they are not committed files.

The unchanged shared verdicts include 41 timed-out, 44 cancelled, 168
execution-error, 199 not-run and 72 unassessed outcomes. They are compared as
such; they do not constitute completed assurance.

## Actual differences

- Existing Expo baseline, coverage and mutant receipts now describe their
  resolved environment. `configDiscoveryMs` is a measured duration: excluded
  from semantic comparison in both assessments and every outcome/setup,
  retained unchanged in file/report metrics. This does not change scores or
  verdicts.
- `standalone.json#/parallelChecks/source-error/result` changes mutation/total
  attempts from 3/13 → 4/14 on Linux x64, and 4/14 → 3/13 on macOS arm64 and
  macOS x64. Linux adds the second setup attempt for `>=` → `<`; macOS arm64
  removes it for `>=` → `>`; macOS x64 removes it for `>=` → `<`.
  Windows `shared-parallel.json#/source-error/result` keeps its total but moves
  that setup attempt from `>=` → `>` to `>=` → `<`. These five setup transitions
  are `not-run` ↔ `execution-error`, all reporting captured-source change when
  attempted. Each final outcome remains execution-error. These reduced
  pre-spawn failures omit `cancelled`/`timedOut` flags; no values are inferred.
- Four Windows receipt-error setup strings exchange `capture-N-1` and
  `capture-N-3` in the missing receipt filename for `<` → `<=` / `>=`.
  Execution-error, exit=1, cancelled=false and timedOut=false remain unchanged.
- Five Windows cancellation child exit values differ below. **Every row keeps
  state=cancelled, cancelled=true and timedOut=false.** Numeric CLI statuses
  remain unchanged.

| Artifact | Input file | Report and setup pointer | Child exit |
| --- | --- | --- | --- |
| windows-runtime-cli-evidence | `windows-runtime-cli-evidence.json` | `/scenarios/consoleCancellation/result/setups/0/baseline` | 1 → -1073741510 |
| windows-shared-fixture-evidence | `shared-cli.json` | `/SIGINT/result/setups/0/typecheck` | 1 → -1073741510 |
| windows-shared-fixture-evidence | `shared-cli.json` | `/SIGTERM-after-receipt/result/setups/0/baseline` | -1073741510 → 1 |
| windows-x64-package-proof | `shared-cli.json` | `/SIGINT/result/setups/0/typecheck` | -1073741510 → 1 |
| windows-x64-package-proof | `shared-cli.json` | `/SIGTERM/result/setups/0/typecheck` | -1073741510 → 1 |

All **632 shared numeric process-status values** match, including **533
stdout-capturing CLI cases**. The broader set also includes execution/tool
records without stdout. The only added numeric process record is the Expo
npm-wrapper execution (status=0, signal=null). Across shared process records, 220 changed stderr strings
are retained explicitly, separately from the 25 version-bearing payload-error
messages in supplemental evidence. Outcome diagnostic strings and timing-ranked
`slowestExecutions` arrays also retain their exact portable differences; an
index-level verdict change in a ranked list is not an outcome identity change.

Every shared `workerBaselineJobs` and `preparedBaselineJobs` value matches.
Total-job arithmetic passes for all 508 shared and all 19 added full reports.
File/report metrics preserve top-level and per-outcome/setup timings, phase
and worker timings, deadlines, throughput, jobs and CLI envelope/process times.
They are observations from separate runs; no speed claim follows.

## Added reports and bounded controls

Five native package targets add the public `examples/jest` normal report.
Each is complete: four mutation outcomes (3 killed, 1 survived), score 75,
two killed extreme mutants, 9 total jobs (4 mutation + 2 pseudo + 3 setup).
These five reports have no retained 0.14.0 counterpart.

macOS arm64 Node 24.22.2 adds `node-24.22.2/jest-check.json` with these 13 cases:

| Cases | Result | Total jobs |
| --- | --- | ---: |
| node-replacement, jsdom-replacement, npm-wrapper | complete; mutation 3 killed / 1 survived, score 75; 2 extreme kills | 9 each |
| node-switching, jsdom-switching | same outcomes and score | 10 each |
| v8, custom-transform, custom-environment, multiple-projects, docblock-bypasses-evidence, unsupported-jest, unsupported-environment | incomplete; 6 unassessed outcomes; no mutation attempts or final score | 2 each |
| failing-baseline | failed baseline; incomplete; same 6 unassessed outcomes | 2 |

The seven unsupported/evidence controls report baseline execution-error;
`failing-baseline` reports baseline failed. Coverage is not run in all eight.
Their retained JSON contains envelopes and reports, not raw numeric child exit
statuses; the proof driver asserts expected exits, which is a different form of
evidence. They are not counted among shared CLI status pairs.

The same macOS artifact adds
`node-24.22.2/jest-expo-check.json#/runs/npm-wrapper/report/result`: complete,
mutation 3 killed / 1 survived (score 75), 3 extreme kills, 10 total jobs.
Its retained child execution status is 0. The proof's requested/completed count
changes 12 → 13; the Node 24.22.2 summary adds the passed `jest-check` check
and shifts subsequent list positions. No existing case or report was removed.

Together the 19 new full reports contain **115 outcomes: 56 killed, 11 survived,
48 unassessed**. These are new evidence, not before/after equivalence.

## Auxiliary summaries and fixture identity

Separately, **58 selected/full summary pairs** (40 Linux x64 debug-binary,
18 packaged macOS arm64 Node 24.22.2) retain all **335 reduced outcome rows**,
completeness, scores and recorded phase jobs unchanged. The four Linux selected/
full SIGINT/SIGTERM cancellation summaries also match: cancelled, one attempt,
descendants and scratch removed. All 80 execute-cancellation cases across five
native targets match, including verdict arrays, calls, exits and cleanup.
Two Linux supervision summaries retain the same states, errors and cleanup
observations; their binary hashes change. These reduced summaries omit full
source/operator identities and some total/worker/prepared jobs; missing values
are not filled in or folded into the 3,218 outcome count.

`fixtureSourceVerification` records Git object identities at both direct heads.
The full existing `examples/node`, `examples/vitest`, `examples/jest-expo` and
`examples/workspaces` trees, both fixture trees, and 15 existing generators are
identical. Operator fixture hashes match in 20 sets (80 hashes). Changed/added
proof and example objects are listed explicitly. `jest-expo-check.mjs` adds
only the wrapper case; `examples/verify.mjs` adds the plain-Jest case and expected
results. Reporter/environment/config adapters and proof/summary drivers do
change, so they are not described as unchanged fixture generators.

Of the 3,218 shared outcomes, 3,176 pair by phase plus kind/path/offset/original/
replacement. The 42 reduced node-load-failure outcomes pair by case coordinate
and reported id, backed by the identical generator. Supplemental cases are
retained separately; 25 payload errors change only version text, two supervision
binary hashes change, and the new proof check/count additions are explicit.

## Reproduction and limits

From the repository root, with retained audit/evidence paths available:

```sh
python3 work/release-0.15.0/verdict-comparison/verify_artifacts.py
python3 work/release-0.15.0/verdict-comparison/compare.py
python3 work/release-0.15.0/verdict-comparison/render_comparison.py
```

The verifier checks live GitHub artifact ID/name, unexpired status, digest,
size, workflow run and exact direct head; cached/downloaded ZIP bytes must match
SHA-256 and size, unique/safe paths and CRC. Local JSON inventory and every
consumed member must match the ZIP exactly. Duplicate `repeat-pack` packaging
JSON is excluded. Full reports, all phase outcomes, decoded CLI stdout and
reduced summaries are traversed; identical wrapper/result/stdout copies and
public-example copies are deduplicated explicitly.

Known runner/capture roots, path separators and execution IDs are normalized;
selected file-valued fields use basenames. All 508 source arrays also match
without that normalization. Timing fields and adaptive durations are separated
from semantics; exact errors, diagnostic text and state/verdict changes are
retained without a broad exception. Script self-checks cover a changed second
outcome, pseudo-testing, stdout/dedup traversal and configDiscoveryMs retention.
Script SHA-256 values are recorded in the JSON:

- verifier: `53124ef71994e6078cca5010f1c30ca63fba6b5ab183f92c8e7fd5580d38c2a4`
- comparator: `4ae8a12ee2df696b2d7be7d4c9feeef8ff43fd698a74ea29b62a425f9c06f544`
- report renderer: `4939dae8b13bdf46446d46b2cb73289541e3861d0b374516fca3130602797a4f`

No fixtures were rerun, and this analysis changes no runtime code. Separate
latest-Node artifacts and later release/archive runs are outside these frozen
inputs. GitHub retention may prevent later downloads; the records preserve
coordinates, hashes and compared values. This is a retained-fixture comparison,
not a claim about all possible projects or unsupported Jest configurations.
