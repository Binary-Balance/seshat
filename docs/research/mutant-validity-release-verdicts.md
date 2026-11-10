# 0.16.0 → 0.17.0 native verdict comparison

All **3,333 retained shared outcomes** keep their verdicts
and counted-kill flags: 2,916 mutation outcomes and
417 extreme/pseudo-testing outcomes. No outcome or report
was added or removed. All **527 full source assessment
arrays (568 source records)** match exactly once the new
field's zero defaults are removed. Scores and completion states match:
309 shared full reports are complete and 218 remain
incomplete.

The eight artifact pairs contain **838 report pairs**. Every
consumed JSON member was byte-checked against its exact GitHub artifact ZIP:
**16 ZIPs, 176 JSON members**.

| Artifact | Report pairs | Shared outcome pairs |
| --- | ---: | ---: |
| linux-arm64-package-proof | 96 | 499 |
| linux-x64-package-proof | 181 | 720 |
| macos-arm64-package-proof | 226 | 822 |
| macos-x64-package-proof | 96 | 499 |
| windows-runtime-cli-evidence | 6 | 3 |
| windows-runtime-preflight | 0 | 0 |
| windows-shared-fixture-evidence | 84 | 196 |
| windows-x64-package-proof | 149 | 594 |

Baseline: [0.16.0 audit](../releases/0.16.0-audit.json), merge source
`f04d3095a8133ac9866539cd142855b41a5efbda`, direct build head
`8c4c97c424872264ed0cbe4d6f5531096a31da1a`. Candidate: 0.17.0 merge source
`72c5c087b8a7debe32378156929ff72fdd1161ba`, direct build head
`217a29315bf2b3460bbcb940ca707394387ca58a` in
[PR #290](https://github.com/Binary-Balance/seshat/pull/290), tracked by
[issue #289](https://github.com/Binary-Balance/seshat/issues/289).

The [comparison JSON](mutant-validity-release-verdicts.json) retains coordinates, stable
identities, all differences, source-array hashes, completion/score summaries,
execution flags and measured jobs/timings. The
[artifact verification](mutant-validity-release-artifacts.json) retains official IDs, run/head
metadata, ZIP digests/sizes and member hashes. Local `work/` paths name
retained inputs; they are not committed files.

The unchanged shared verdicts include 41 timed-out,
44 cancelled, 168
execution-error, 199 not-run and 120
unassessed outcomes. They are compared as such; they do not constitute
completed assurance.

## Mutant eligibility and new report fields

0.17.0 stops mutating arithmetic with a string or template literal operand and
declaration-only code in every operator family. Every shared per-operator row
keeps its `eligibleSites`, `excludedSites` and `planned` counts, so the new
rules exclude no site in any retained assessed source. This confirms the fixture scan recorded in
[PR #287](https://github.com/Binary-Balance/seshat/pull/287).

0.17.0 adds `compileErrors` to mutation totals and per-operator rows. No
retained fixture sets `typecheckMutants`, so each holds `0`, and no retained
report contains a `compile-error` verdict or the setting. The comparator
removes only that exact default from the candidate, counting
2,204 removals. Any other value would have been kept
and reported; none appeared. The baseline contains no such field.

The opt-in behaviour is covered by the new `typecheck-mutants.mjs` proof, which
ran in the [Linux x64 package job](https://github.com/Binary-Balance/seshat/actions/runs/42753276996/job/129621652420)
at the candidate head. With the setting off, `?.` survived and `+`, `&&` and
`true` were killed; with it on, all four were `compile-error` and the
type-valid `>=` control stayed killed. That proof writes no retained artifact,
so it is not part of this comparison.

## Actual differences

- **Fault-injection scheduling.** The `source-error` case changes a captured
  source while mutants run. Which second-setup job starts before the change is
  noticed varies by run. 8 setup states move between
  `not-run` and `execution-error` in 7 reports; every
  affected outcome remains execution-error. 6 of those reports
  run one job more or fewer; in the others the attempt moves between mutants.

| Report and setup | Setup state |
| --- | --- |
| `linux-arm64-package-proof` `standalone.json#/parallelChecks/source-error/result/mutation/outcomes/1/setups/1` | execution-error → not-run |
| `linux-x64-package-proof` `debian11.json#/parallelChecks/source-error/result/mutation/outcomes/1/setups/1` | not-run → execution-error |
| `linux-x64-package-proof` `standalone.json#/parallelChecks/source-error/result/mutation/outcomes/0/setups/1` | not-run → execution-error |
| `macos-arm64-package-proof` `node-24.22.2/parallel.json#/source-error/result/mutation/outcomes/0/setups/1` | execution-error → not-run |
| `macos-arm64-package-proof` `node-24.22.2/parallel.json#/source-error/result/mutation/outcomes/1/setups/1` | not-run → execution-error |
| `macos-x64-package-proof` `standalone.json#/parallelChecks/source-error/result/mutation/outcomes/0/setups/1` | not-run → execution-error |
| `windows-shared-fixture-evidence` `shared-parallel.json#/source-error/result/mutation/outcomes/0/setups/1` | execution-error → not-run |
| `windows-x64-package-proof` `shared-parallel.json#/source-error/result/mutation/outcomes/0/setups/1` | not-run → execution-error |

- **Receipt filenames.** In the `receipt-error` case, 28
  missing-receipt messages exchange `capture-N-1` and `capture-N-3`. Each stays
  execution-error with unchanged exit and flags.
- **Windows cancellation exits.** 5 child exit values change between `1`
  and `-1073741510`. State, cancellation and timeout flags are unchanged, and
  so are all numeric CLI statuses.

| Report and setup | Child exit |
| --- | --- |
| `windows-runtime-cli-evidence` `windows-runtime-cli-evidence.json#/scenarios/consoleCancellation/result/setups/0/baseline` | -1073741510 → 1 |
| `windows-shared-fixture-evidence` `shared-cli.json#/SIGTERM-after-receipt/result/setups/0/baseline` | 1 → -1073741510 |
| `windows-shared-fixture-evidence` `shared-cli.json#/SIGTERM/result/setups/0/typecheck` | 1 → -1073741510 |
| `windows-x64-package-proof` `shared-cli.json#/SIGTERM-after-receipt/result/setups/0/baseline` | -1073741510 → 1 |
| `windows-x64-package-proof` `windows-runtime-cli-evidence.json#/scenarios/consoleCancellation/result/setups/0/baseline` | 1 → -1073741510 |

- **Temporary folder names.** 44 Jest environment paths in
  macOS arm64 `node-24.22.2/jest-check.json` differ only in the proof's random
  `jest-check-XXXXXX` folder, which the comparator does not normalise.
- **Version text and binaries.** 25 expected payload-error
  messages name 0.17.0 instead of 0.16.0, and two supervision summaries record
  the new binary hashes.
- **stderr.** 228 process stderr strings differ; all
  633 shared numeric process statuses, including
  533 CLI cases, match. Setup and outcome diagnostic strings and
  timing-ranked `slowestExecutions` arrays keep their exact differences in the
  JSON.

Every shared `workerBaselineJobs` and `preparedBaselineJobs` value matches.
Total-job arithmetic passes for all 527 full reports.
Timings are retained as observations from separate runs; no speed claim
follows.

## Auxiliary summaries and fixture identity

58 selected/full summary pairs keep all
335 reduced outcome rows,
completeness, scores and phase jobs. The 4 selection
cancellation summaries and
80
execute-cancellation cases also match. These reduced summaries are not folded
into the shared outcome count.

`fixtureSourceVerification` records Git object identities at both direct
heads. All 21 fixture trees, examples and
existing proof generators are identical, and operator fixture hashes match in
20 sets (80 hashes).
Changed objects are `.github/workflows/linux-x64-package.yml`, `.github/workflows/npm-publish.yml`, `benchmarks/proofs/README.md`, `benchmarks/proofs/typecheck-mutants.mjs`:
the new proof, its README entry and Linux x64 workflow step, and the
publisher's default version.

## Reproduction and limits

From the repository root, with the retained audit and evidence paths present:

```sh
python3 -I work/release-0.17.0/verdict-comparison/verify_artifacts.py
python3 -I work/release-0.17.0/verdict-comparison/compare.py
python3 -I work/release-0.17.0/verdict-comparison/render_comparison.py
```

The scripts adapt the 0.16.0 comparison, replacing its default-removal list
with `compileErrors`. The verifier checks each artifact's ID, name, expiry, digest, size,
workflow run and direct head, and that every consumed JSON member matches the
ZIP. Paths, capture prefixes and execution IDs are normalised; timings are
separated from semantic comparison but retained. Script SHA-256 values:

- verifier: `bbb2839139baa6d3551b50a32b84659fb41da6546a239d19b64446f6d39d8419`
- comparator: `928b376de7ae4110b8ace7507b0c9ccd10f2215fc440c0accae2cf18226601ee`
- report renderer: `2e0934dd5417d1ec9864bda9e1a9771e869fa50a9f9290916f8b5b8a2660dda8`

No fixtures were rerun. GitHub retention may later prevent downloads; the
records keep coordinates, hashes and compared values. This compares retained
fixtures, not all possible projects.
