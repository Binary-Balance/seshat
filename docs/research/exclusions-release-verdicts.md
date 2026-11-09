# 0.15.0 → 0.16.0 native verdict comparison

All **3,333 retained shared outcomes** keep their verdicts
and counted-kill flags: 2,916 mutation outcomes and
417 extreme/pseudo-testing outcomes. No outcome or report
was added or removed. All **527 full source assessment
arrays (568 source records)** match exactly once the new
fields' empty defaults are removed. Scores and completion states match:
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

Baseline: [0.15.0 audit](../releases/0.15.0-audit.json), merge source
`8f8f2e80eed241d6276d66605a98f22bcda4de9b`, direct build head
`e82e0b2ad8a680373598a87600494833604ae91f`. Candidate: 0.16.0 merge source
`f04d3095a8133ac9866539cd142855b41a5efbda`, direct build head
`8c4c97c424872264ed0cbe4d6f5531096a31da1a` in
[PR #285](https://github.com/Binary-Balance/seshat/pull/285), tracked by
[issue #284](https://github.com/Binary-Balance/seshat/issues/284).

The [comparison JSON](exclusions-release-verdicts.json) retains coordinates, stable
identities, all differences, source-array hashes, completion/score summaries,
execution flags and measured jobs/timings. The
[artifact verification](exclusions-release-artifacts.json) retains official IDs, run/head
metadata, ZIP digests/sizes and member hashes. Local `work/` paths name
retained inputs; they are not committed files.

The unchanged shared verdicts include 41 timed-out,
44 cancelled, 168
execution-error, 199 not-run and 120
unassessed outcomes. They are compared as such; they do not constitute
completed assurance.

## New report fields

0.16.0 adds `equivalentDeclarations` to source results, `equivalence` to
mutation outcomes, `equivalent` to mutation totals and per-operator rows, and
`staleDeclarations` to mutation totals. No retained fixture declares an
equivalent mutant, so each holds its empty default: `[]`, `null` or `0`. The
comparator removes only those exact defaults from the candidate, counting
6,821 removals (`equivalence` 3,159, `equivalent` 2,204, `equivalentDeclarations` 701, `staleDeclarations` 757).
Any other value would have been kept and reported; none appeared. The
baseline contains none of these fields.

No retained report contains a `partially-suppressed` function, so the
partial-hint change does not appear here. That behaviour is covered by the
[partial suppression evidence](../../outputs/partial-coverage-suppression.md),
not by this comparison.

## Actual differences

- **Fault-injection scheduling.** The `source-error` case changes a captured
  source while mutants run. Which second-setup job starts before the change is
  noticed varies by run. 6 setup states move between
  `not-run` and `execution-error` in 5 reports; every
  affected outcome remains execution-error. 4 of those reports
  run one job more or fewer; in the others the attempt moves between mutants.

| Report and setup | Setup state |
| --- | --- |
| `linux-x64-package-proof` `debian11.json#/parallelChecks/source-error/result/mutation/outcomes/1/setups/1` | execution-error → not-run |
| `linux-x64-package-proof` `standalone.json#/parallelChecks/source-error/result/mutation/outcomes/0/setups/1` | execution-error → not-run |
| `macos-arm64-package-proof` `node-24.22.2/parallel.json#/source-error/result/mutation/outcomes/1/setups/1` | execution-error → not-run |
| `macos-arm64-package-proof` `standalone.json#/parallelChecks/source-error/result/mutation/outcomes/0/setups/1` | not-run → execution-error |
| `macos-x64-package-proof` `standalone.json#/parallelChecks/source-error/result/mutation/outcomes/0/setups/1` | execution-error → not-run |
| `macos-x64-package-proof` `standalone.json#/parallelChecks/source-error/result/mutation/outcomes/1/setups/1` | not-run → execution-error |

- **Receipt filenames.** In the `receipt-error` case, 16
  missing-receipt messages exchange `capture-N-1` and `capture-N-3`. Each stays
  execution-error with unchanged exit and flags.
- **Windows cancellation exits.** 3 child exit values change between `1`
  and `-1073741510`. State, cancellation and timeout flags are unchanged, and
  so are all numeric CLI statuses.

| Report and setup | Child exit |
| --- | --- |
| `windows-shared-fixture-evidence` `shared-cli.json#/SIGINT/result/setups/0/typecheck` | -1073741510 → 1 |
| `windows-x64-package-proof` `shared-cli.json#/SIGINT/result/setups/0/typecheck` | 1 → -1073741510 |
| `windows-x64-package-proof` `windows-runtime-cli-evidence.json#/scenarios/consoleCancellation/result/setups/0/baseline` | -1073741510 → 1 |

- **Temporary folder names.** 44 Jest environment paths in
  macOS arm64 `node-24.22.2/jest-check.json` differ only in the proof's random
  `jest-check-XXXXXX` folder, which the comparator does not normalise.
- **Version text and binaries.** 25 expected payload-error
  messages name 0.16.0 instead of 0.15.0, and two supervision summaries record
  the new binary hashes.
- **stderr.** 230 process stderr strings differ; all
  633 shared numeric process statuses, including
  533 CLI cases, match. Outcome diagnostic strings and
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
Changed objects are `.github/workflows/linux-x64-package.yml`, `.github/workflows/npm-publish.yml`, `benchmarks/proofs/README.md`, `benchmarks/proofs/coverage-branches.mjs`, `benchmarks/proofs/parallel.mjs`.
`coverage-branches.mjs` gained the partial-suppression proof cases, and
`parallel.mjs` expects the new `equivalentDeclarations` field.

## Reproduction and limits

From the repository root, with the retained audit and evidence paths present:

```sh
python3 -I work/release-0.16.0/verdict-comparison/verify_artifacts.py
python3 -I work/release-0.16.0/verdict-comparison/compare.py
python3 -I work/release-0.16.0/verdict-comparison/render_comparison.py
```

The scripts adapt the 0.15.0 comparison: they add the default-removal step
above and update the fixture lists for `examples/jest` and the changed
`parallel.mjs`. The verifier checks each artifact's ID, name, expiry, digest, size,
workflow run and direct head, and that every consumed JSON member matches the
ZIP. Paths, capture prefixes and execution IDs are normalised; timings are
separated from semantic comparison but retained. Script SHA-256 values:

- verifier: `f0aadad81c254db53ff48d31cf754ae38324881297adbd2c024c4b5e0d8d3472`
- comparator: `da54faa1a46f68b71fe6280281fa9b9e68988ae39f19d9d99bfa2a33e7819aae`
- report renderer: `775e8e450704fa20ba156f9757cb73780d24122a5098d9c0d1827d1c74a32fc2`

No fixtures were rerun. GitHub retention may later prevent downloads; the
records keep coordinates, hashes and compared values. This compares retained
fixtures, not all possible projects.
