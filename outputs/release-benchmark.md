# Linux x64 release benchmark

The installed candidate completed the six requested fixture and worker
conditions with one warmup and three measured runs per condition. This is
descriptive evidence for the checked-in fixtures. It does not establish a
production overhead bound.

All 24 executions completed with normal progress enabled, replacement
mutation, serial test-runner commands and serial host execution. The expected
results held on every run: Node killed 2/2 mutants with score 100, Vitest
killed 4/4 with score 100, and Jest/Expo killed 3/4 with score 75. Worker 1
attempted 5, 7 and 7 jobs for those fixtures; worker 2 attempted 6, 8 and 8.
The worker-independent parity hash matched between worker counts for every
fixture while the full semantic hashes remained distinct because worker and job
counts are part of the full report.

## Timings

Times are milliseconds. `Harness wall` measures the parent process from spawn
through stdout/stderr drain and report serialization. The other columns come
from the candidate JSON report. `Capture` is Seshat's project capture phase.
`Execution` includes typecheck, baseline, fresh coverage, analysis and
mutation work. `Report wall` is the CLI-reported total. Seshat does not expose
a separate AST or CRAP-only timer in this report.

| Fixture | Workers | Harness wall median [min, max] | Capture median [min, max] | Execution median [min, max] | Report wall median [min, max] |
| --- | ---: | ---: | ---: | ---: | ---: |
| Node workspace | 1 | 1874.602 [1817.335, 1954.699] | 0.943 [0.841, 1.146] | 1869.920 [1812.501, 1948.174] | 1871.804 [1814.333, 1950.560] |
| Node workspace | 2 | 1960.178 [1912.616, 2010.527] | 0.984 [0.862, 1.043] | 1954.832 [1907.256, 2005.437] | 1956.556 [1909.214, 2007.362] |
| Vitest TSX | 1 | 9215.511 [8990.154, 9220.240] | 1389.247 [780.958, 1460.807] | 7598.097 [7531.205, 7941.652] | 9210.887 [8986.909, 9216.014] |
| Vitest TSX | 2 | 9646.675 [9483.885, 10081.473] | 613.058 [594.188, 636.817] | 8812.795 [8664.874, 9221.959] | 9643.169 [9480.317, 10077.653] |
| Jest/Expo TSX | 1 | 19426.972 [18857.269, 20159.126] | 1632.078 [1627.510, 2463.363] | 17098.467 [16637.295, 17186.869] | 19423.188 [18853.446, 20155.391] |
| Jest/Expo TSX | 2 | 25464.283 [25322.447, 27183.525] | 1765.865 [1696.600, 2132.039] | 22969.114 [22674.708, 24325.329] | 25460.279 [25317.698, 27179.762] |

On these small two-CPU fixtures, worker 2 was slower by 85.576 ms (4.6%) for
Node, 431.164 ms (4.7%) for Vitest and 6037.311 ms (31.1%) for Jest/Expo.
That includes the extra worker baseline and does not predict larger projects.

## Reproduction

The [protocol](../benchmarks/proofs/release-benchmark.md) fixes the fixture
inputs, expected metrics and verdicts. Reuse the prepared candidate tarball
and Jest/Expo dependencies with:

```sh
REPO_ROOT="$PWD"
CANDIDATE_TARBALL="$REPO_ROOT/work/npm-pack-BR2zxn/binary-balance-seshat-0.0.0.tgz"
JEST_DEPS="$REPO_ROOT/work/jest-expo-fixture"

node benchmarks/proofs/diagnostics-overhead.mjs \
  --repo "$REPO_ROOT" \
  --release \
  --candidate "$CANDIDATE_TARBALL" \
  --jest-deps "$JEST_DEPS" \
  --candidate-commit 62bcddd2a2008cdcca23b8baf93448b2d147f8d8 \
  --harness-commit 6410b8099e2252423bf3ce7723c2c2e39261f02b \
  --samples 3 \
  --output outputs/release-benchmark.json
```

The [raw JSON evidence](release-benchmark.json) retains all 24 run records,
including every report timing, diagnostics snapshot, semantic hash, parity
hash, source/config hash and artifact measurement.

## Environment and provenance

The run used Node 24.20.0, npm 11.19.0, Linux x64 on kernel
6.12.107+deb13-cloud-amd64, an AMD EPYC 7763 host with 2 available logical
CPUs and 16,720,142,336 bytes of memory. The fixture tools were TypeScript
6.0.3, Vitest 5.0.0, `@vitest/coverage-istanbul` 5.0.0, Jest 29.7.0 and
`jest-expo` 57.0.5.

The candidate source revision is `62bcddd2a2008cdcca23b8baf93448b2d147f8d8`.
The benchmark harness revision is `6410b8099e2252423bf3ce7723c2c2e39261f02b`.
The candidate revision is an ancestor of base `e722117`; runtime source, Cargo
inputs and packaging inputs are unchanged between those revisions. The package
does not embed a source commit, so this Git comparison and the recorded
candidate revision provide the source provenance.
The harness SHA-256 is
`13aad6a4c24dfcfbe8f0cc043af772e0dc307a8424a9d2e511a6fc03586b6826`; the
protocol SHA-256 is
`6b7ffb0129ccb1b3bf1901080d86b526be9625ffc1f88022a0e85efcb65a9f06`.

| Artifact | Size | SHA-256 or meaning |
| --- | ---: | --- |
| npm tarball | 957,505 bytes | `ebfbe1d8af92572f2eb92dc034aba22eeffa769af725fe5b88391e64a8b7c135` |
| installed binary | 2,404,520 bytes | `9e4adaad4531ae410eac83004b764d04cc4d3198b6d09b4dedcc84ae6d8fec88` |
| installed package, 6 files | 2,904,275 bytes | inventory hash `56107f0db58a266ba19cc3eddf57e4b5f3a67c364dfa1cffcc872aff37581da7` |
| installed `BUILD.json` | 7,692 bytes | `cbdf34b605b6d0a0fefabd4d6b8b8afe4c0e67692d86b57a342e134812f0bc65` |

The installed package inventory hash covers file paths, sizes and per-file
hashes. It is not a hash of concatenated package bytes. `BUILD.json` lists 65
external Cargo package entries from `cargo metadata`; the locked
`benchmarks/proofs/Cargo.lock` has 66 package stanzas because it also includes
the root package. The reused build cost is unmeasured and recorded as
`buildCost.wallMs: null`; the offline npm installation itself took 505.177 ms.

Maintained code counts cover only `benchmarks/proofs/src` and
`benchmarks/proofs/diagnostics-overhead.mjs`: 12 files and 5,837 lines. They
are not whole-repository source counts.

Fixture input and worker configuration hashes are:

| Fixture | Inputs | Workers 1 / 2 configuration |
| --- | --- | --- |
| Node workspace | `653ef36d6390f8fdee150758411ad04f74aa4d68579ac369467ea5d6a66a8110` | `3507dbf3e3eb37e60cb80615087f5b3fc897afbb272fc229a8c11c9f41649ecd` / `b4af2581ddc2a7205f37f1ac822584496bb34895ed6cb6303300e605020f48fa` |
| Vitest | `a031b45a18aebad086e832f8c73972fdcbc129e9837c8d63f20c0fb8a4c6f455` | `e54e9be63161d315586c9271b27258c572560451557b037f182a2eab5870a886` / `3831485e15d2ae504f98fcc61aa1eeefc233b10ecff33c27337ec56820448841` |
| Jest/Expo | `2620191d8d5b8aad5ed118f0df814da17e5e9646b696722d84afbcc58265ec1c` | `546d484e4f91ec62c8656827c0f0a4c6bfdfe0409939074dd6282538cd0a2a7f` / `038b5b9872ce19f33c89d141a3eb89a02b117981ea7d2be69e67d42511ed3331` |

## Remaining issue #5 gaps

This slice leaves broader workloads, a production performance bound, and build
time measurement open. Experimental switching remains unmeasured because the
installed `check` command has no switching strategy option. Stryker remains
uninstalled and unmeasured. A later comparison must pin Stryker, restrict it to
the equivalent `EqualityOperator` mutations, use `coverageAnalysis: "off"`,
match the exact source and tests, and define typecheck, fresh coverage, CRAP
and baseline work before timing. See the [supported mutators](https://stryker-mutator.io/docs/mutation-testing-elements/supported-mutators/)
and [Stryker configuration](https://stryker-mutator.io/docs/stryker-js/configuration/).
