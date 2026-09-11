# Issue 5 release performance and size evidence audit

Audited at `61f8a604c4b9ab60fc7684689d15b86c6dfc57fe` against [issue 5](https://github.com/Binary-Balance/seshat/issues/5). This maps each acceptance criterion to the retained evidence. It does not close the issue or extend any report beyond its measured workload.

## Verdict

All six issue 5 criteria are evidenced within the boundaries stated below. The older `62bcddd2` release matrix records an unmeasured build cost, but the current `d4b30a1` switching matrices provide candidate-aligned artifact, maintained-code, dependency, install and build fields for all three fixtures. Keep those candidate revisions separate. This audit does not make a wider release-readiness claim.

### Candidate provenance

The reports cover two candidate revisions. The release matrix and Stryker report use `62bcddd2a2008cdcca23b8baf93448b2d147f8d8`; all three installed switching matrices use `d4b30a11257741cefb0091e37c90d7d91bac8b02`. The former is an ancestor of the latter, and their artifact hashes differ. Their timings and sizes must remain separate observations.

| Evidence | Candidate | Primary records |
| --- | --- | --- |
| Installed replacement release matrix | `62bcddd2` | [report](../outputs/release-benchmark.md), [raw JSON](../outputs/release-benchmark.json) |
| Matched Node Stryker comparison | `62bcddd2` | [report](../outputs/stryker-node-comparison.md), [raw JSON](../outputs/stryker-node-comparison.json) |
| Node replacement/switching | `d4b30a1` | [report](../outputs/installed-switching-comparison.md), [raw JSON](../outputs/installed-switching-comparison.json) |
| Vitest replacement/switching | `d4b30a1` | [report](../outputs/installed-vitest-switching-comparison.md), [raw JSON](../outputs/installed-vitest-switching-comparison.json) |
| Jest/Expo replacement/switching | `d4b30a1` | [report](../outputs/installed-jest-expo-switching-comparison.md), [raw JSON](../outputs/installed-jest-expo-switching-comparison.json) |

## Acceptance criteria

### 1. Public, reproducible workload selection

Status: Met within the declared fixture boundary.

The committed [release protocol](../benchmarks/proofs/release-benchmark.md) defines the source, tests, comparison operators, byte offsets, expected CRAP metrics and expected verdicts before its six-condition matrix. It covers the required workload shapes:

| Workload | Source and test | Expected mutation result |
| --- | --- | --- |
| Node workspace | `src/compare.ts`, `packages/rules/index.ts`; `tests/check.mjs` | `>=` at byte 42 has `>` and `<` replacements; 2 killed, score 100 |
| Vitest TSX | `tempo.ts`, `view.tsx`, `server.ts`; `stack.test.tsx` | four listed boundary replacements; 4 killed, score 100 |
| Jest/Expo TSX | `src/status.tsx`; `tests/status.test.tsx` | four listed replacements; 3 killed, 1 survived, score 75 |

The raw release JSON retains input, configuration, semantic and worker-parity hashes. The fixtures are small and Linux x64-specific, but that is an explicit scope limit rather than a missing criterion: the criterion asks for reproducible coverage of these runner and source shapes, not a production workload bound.

### 2. Complete installed command and separate analysis timing

Status: Met.

The [release report](../outputs/release-benchmark.md) records 24 installed `seshat check --json` executions: one warmup and three measured samples for each fixture at workers 1 and 2. Its wall boundary includes process spawn through stdout/stderr drain; capture is retained separately, and execution includes original typecheck, baseline, fresh coverage, analysis and mutation work.

The three later switching reports expose the phase boundary directly. Their worker-1 replacement rows show the following milliseconds; the linked tables retain the full phase and per-setup values:

| Fixture | Wall | Capture | Analysis | Typecheck | Baseline | Fresh coverage | Mutation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Node workspace | 1844.678 | 0.874 | 0.086 | 614.557 | 159.713 | 683.411 | 325.141 |
| Vitest TSX | 9608.468 | 663.940 | 0.134 | 2217.692 | 938.500 | 1310.079 | 4111.334 |
| Jest/Expo TSX | 23345.054 | 1825.239 | 0.708 | 1454.545 | 5039.318 | 5136.998 | 8073.068 |

These phase values are diagnostics and can overlap under worker parallelism; they are not additive. The analysis column is the separate analysis/CRAP phase, not a claim that the entire command is analysis-only.

### 3. Replacement versus switching with fixed work and worker repeats

Status: Met for the `d4b30a1` candidate.

Each installed switching report has 24 runs: one warmup and five measured runs for replacement and switching at workers 1 and 2. The reports validate the same captured inputs, operators, metrics, verdicts and worker-independent semantic hash before calculating deltas.

| Fixture | Workers | Replacement median | Switching median | Switching delta |
| --- | ---: | ---: | ---: | ---: |
| Node workspace | 1 / 2 | 1844.678 / 1893.843 ms | 1963.123 / 2046.603 ms | +6.42% / +8.07% |
| Vitest TSX | 1 / 2 | 9608.468 / 11087.688 ms | 10585.676 / 13831.432 ms | +10.17% / +24.75% |
| Jest/Expo TSX | 1 / 2 | 23345.054 / 31537.761 ms | 22046.467 / 32273.819 ms | -5.56% / +2.33% |

The worker-independent hashes are `ffed486d` (Node), `32cffee0` (Vitest) and `679321ff` (Jest/Expo). The reports retain the complete hashes, input hashes and raw samples. These are fixed-fixture observations, not a general strategy recommendation. The older `62bcddd2` release matrix contains replacement only; it must not be combined with these switching deltas as one candidate result.

### 4. Matched Stryker comparison and exclusions

Status: Met for one matched Node mutation workload.

The [Stryker protocol](../benchmarks/proofs/stryker-node-comparison.md) and [report](../outputs/stryker-node-comparison.md) pin StrykerJS 10.0.0, use the same Node workspace source and test, activate only `EqualityOperator` mutations, and retain the shared input hash `653ef36d`. Stryker uses `coverageAnalysis: "off"`; Seshat's `mutate` path performs the original TypeScript check inside its invocation. Both tools retain the same two active mutants and killed verdicts.

| Workers | Seshat whole invocation | Stryker whole invocation | Stryker typecheck | Stryker mutation command |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1220.838 ms | 2814.209 ms | 759.597 ms | 2038.357 ms |
| 2 | 1284.436 ms | 2658.115 ms | 673.060 ms | 1970.660 ms |

Coverage, CRAP, test selection, builds inside the timed commands and per-mutant TypeScript checks are explicitly excluded. The report therefore makes no equivalent-work claim for a complete `check`, and no Stryker claim is made for Vitest or Jest/Expo where this boundary was not matched.

### 5. Repeated timings, environment, hashes, sizes, maintained code, dependencies and build costs

Status: Met collectively across the retained records.

The evidence records the required repeated timings, environment and artifact data. The historical `62bcddd2` release matrix records:

- three measured samples per fixture/worker condition, Linux x64 environment, Node 24.20.0, npm 11.19.0, kernel, CPU, memory and runner versions;
- the 957,505-byte tarball, 2,404,520-byte installed binary, 2,904,275-byte six-file installed package and their hashes;
- maintained code counts scoped to `benchmarks/proofs/src` and `benchmarks/proofs/diagnostics-overhead.mjs` (12 files, 5,837 lines), plus 66 locked Cargo package entries and 65 external entries in `BUILD.json`;
- the 505.177 ms offline npm install observation and fixture dependency versions. The candidate package has no npm runtime dependency, as documented in the [packaging README](../packaging/README.md).

The current `d4b30a1` switching records complete the collective evidence. The Node report has one fresh warm-cache offline `pack.mjs` observation of 68,416.468 ms; the Vitest and Jest/Expo reports label that same value as historical reused build evidence. All three use the same candidate artifact, with a 973,758-byte tarball, 2,450,880-byte binary, 2,950,635-byte six-file installed package and matching hashes. They record install observations of 478.475 ms, 641.061 ms and 496.541 ms, maintained-code counts in their declared harness scopes (12 files and 6,601, 6,673 or 6,719 lines), 66 locked Cargo entries, 65 external `BUILD.json` entries and the fixture dependency versions.

The `62bcddd2` report's `buildCost.wallMs: null` remains a historical limitation of that report. It is not missing required evidence from the retained release set, because the later candidate-aligned records provide the build cost without pretending that the two revisions are one measurement.

### 6. Portable raw evidence and bounded conclusions

Status: Met.

The linked JSON files retain raw per-run timings, command output, hashes, semantic validation and artifact metadata; the Markdown reports derive summaries from those records. An audit of the five JSON reports and their Markdown summaries found no host-absolute paths such as `/home`, `/tmp` or `/Users`; retained paths use portable `<repo>` and `<work>` markers. Every report limits conclusions to the named fixtures and explicitly disclaims a production bound or general speed claim. Stryker's unmatched phases are also called out rather than folded into an equivalent-work result.

## Remaining scope

Issue 5 has no required evidence gap in the retained records. No new build or switching rerun is needed for this audit. The older `62bcddd2` records stay historical, and the `d4b30a1` records stay the current candidate-aligned switching and size evidence.

Closure can accompany review and merge of this audit. The next implementation slice belongs to issue 2: establish runner availability and minimum OS decisions for one supported target, starting with evidence rather than choosing an unsupported baseline. Platform publication and the remaining release gates in issue 6 stay separate. Do not read this document as final release readiness.
