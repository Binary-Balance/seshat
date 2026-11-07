# 0.13.0 → 0.14.0 native verdict comparison

All **3,218 retained shared outcomes** keep their verdicts: 2,840 mutation
outcomes and 378 extreme/pseudo-testing outcomes. There are no added or missing
shared fixture reports or outcomes. All 508 full source assessment arrays
(549 source records) and 533 retained CLI exit statuses match.

The comparison covers eight artifact pairs: the five native package targets
and three Windows runtime artifacts. Every consumed JSON file was byte-checked
against its exact GitHub artifact ZIP: **16 ZIP digests, 171 JSON members**.
The embedded macOS arm64 Node 24.22.2 reports are included.

| Artifact | Report pairs | Outcome pairs |
| --- | ---: | ---: |
| linux-arm64-package-proof | 95 | 493 |
| linux-x64-package-proof | 180 | 714 |
| macos-arm64-package-proof | 211 | 731 |
| macos-x64-package-proof | 95 | 493 |
| windows-runtime-cli-evidence | 6 | 3 |
| windows-runtime-preflight | 0 | 0 |
| windows-shared-fixture-evidence | 84 | 196 |
| windows-x64-package-proof | 148 | 588 |

Baseline: [published 0.13.0 audit](../releases/0.13.0-audit.json), source
`a195f7b55fba51df670c0cd0709d15537011014f`. Candidate: 0.14.0 merge source
`96558b09e79268114b94e8f401fd5377584e11b2`, frozen direct head
`3e4cb482fb914d36c6b8cee5f39912f679b87eb7` in
[PR #276](https://github.com/Binary-Balance/seshat/pull/276).

The [comparison JSON](test-selection-release-verdicts.json) retains each
report's input file and JSON pointer, identities, metrics and exact differences.
The [artifact verification JSON](test-selection-release-artifacts.json) retains
artifact IDs, run IDs, head SHAs, ZIP digests and JSON member hashes. Relative
`work/` paths identify the local retained inputs; they are not committed files.
The comparison's `artifactVerificationSha256` binds these two records.

The unchanged verdicts include 41 timed-out, 44 cancelled, 168 execution-error,
199 not-run and 72 unassessed outcomes. Those outcomes and their setup states
were compared. Operator fixture hashes match in 20 sets (80 file hashes);
unchanged fixture/generator Git object IDs are also retained.

## Measured differences

- Node/Jest file identity and coverage manifests were added. Selection
  availability and selected/full fallback receipts change as intended. These
  reporting changes do not change the shared verdicts or scores.
- macOS arm64 Node 24.22.2 `automatic-cleanup` has one selected pseudo-testing
  attempt followed by a full retry (`selection-not-confirmed`): pseudo jobs
  2 → 3 and total jobs 7 → 8. Its final extreme verdict remains execution-error.
- The source-change fixture schedules one extra mutation attempt on macOS
  arm64 (both baseline Node and Node 24.22.2), macOS x64 and Windows runtime:
  mutation jobs 3 → 4 and total jobs 13 → 14. Linux x64 instead moves the
  source-change failure between its two mutants with the same total. Six
  per-mutant setup transitions are retained. These are attempts; the
  source-change check can prevent process spawn.
- Four Windows cancellation cases differ in child process exit value (`1`
  versus `-1073741510`). Cancelled remains true, timedOut remains false and
  their final statuses/verdicts are unchanged. Exact rows and flags are retained.
- Every recorded `workerBaselineJobs` and `preparedBaselineJobs` value matches.
  The top-level job sum was checked in all 508 full report pairs. Per-report
  metrics retain actual job counts, phase timings, mutation wall time, worker
  timing and outcome/setup timing for both versions.

## New selection evidence and limits

The current native artifacts add 40 Linux debug-binary selected/full pairs and
18 packaged macOS arm64 Node 24.22.2 pairs; all match. Their mutation job counts
include normal 5 → 3, identity-change retry 5 → 4 and guarded fallback 5 → 5.
Jest timeout/cleanup controls use a confirmation retry (1 → 2 attempts); empty
suites remain incomplete with zero mutation attempts. The four current
selection-cancellation rows record cancelled outcomes, one attempt each, and
removed descendants/scratch.

Those 58 auxiliary summaries have no retained 0.13.0 counterpart and omit full
reports, top-level total jobs and worker/prepared baseline attempts. They are
not substituted for the full-report accounting above. New empty and URL-alias
cases support the current proof assertions, not a retained before/after
comparison.

Of the 3,218 shared outcomes, 3,176 use phase plus kind/path/offset/original/
replacement. The remaining 42 reduced node-load-failure outcomes omit those
source fields; they use the unchanged case name plus reported id, backed by
the identical fixture generator.

The four separate latest-Node artifacts are outside this comparison. No
fixtures were rerun and no speed claim is inferred from timing differences.
Version metadata, known temporary roots/capture IDs and adaptive timings
naturally differ; exact measured timing fields remain available. This analysis
does not change runtime code.

## Verification method

1. Read the two audit coordinates. For each artifact, check GitHub metadata
   against the retained ID, digest, size, run ID and direct head. Download its
   ZIP through `gh api repos/Binary-Balance/seshat/actions/artifacts/<id>/zip`.
   Verify SHA-256, byte count, ZIP CRC, safe member paths and unique members.
2. Extract the JSON members listed in the verification record. Check each
   member hash and require the local JSON inventory and bytes to match the ZIP.
   Repeated packaging output under `repeat-pack` is excluded explicitly.
3. Traverse full reports and phase outcome arrays, including JSON encoded in
   CLI stdout. Deduplicate identical outer/result/stdout copies and repeated
   public-example output. Pair by artifact, input file and JSON pointer.
4. Pair outcomes by the identity described above. Compare verdicts and
   counted-kill flags, source assessment arrays, CLI status, setup/execution
   states and deadline policy. Normalize known runner roots, capture IDs and
   execution IDs. Retain reporting additions and setup/exit differences.
5. Preserve measured timings separately from semantic differences. Retain
   every job counter, including worker/prepared baseline attempts, and check
   full-report totals. Confirm fixture hashes and generator Git object IDs.

The retained JSON is the portable comparison record. One-off analysis scripts
and downloaded ZIPs remain under `work/release-0.14.0/verdict-comparison/` in the
maintainer's working checkout. GitHub artifact retention limits later downloads;
the committed records preserve their coordinates, hashes and compared values.
