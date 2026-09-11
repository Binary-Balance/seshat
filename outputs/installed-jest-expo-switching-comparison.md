# Installed Seshat Jest/Expo switching comparison

This report records the fixed candidate-only Jest/Expo fixture matrix described by
[`installed-jest-expo-switching-comparison.md`](../benchmarks/proofs/installed-jest-expo-switching-comparison.md).
It is fixture-specific evidence and does not establish a production performance
bound.

The installed candidate source revision is d4b30a11257741cefb0091e37c90d7d91bac8b02.
The candidate tarball SHA-256 is `157856543150f2428c73a303e8bf1d3115bc8b8e333efd10a9e0c333a16f7ee4`. The fixture input
hash is `2620191d8d5b8aad5ed118f0df814da17e5e9646b696722d84afbcc58265ec1c`; the common worker-independent semantic
hash is `679321ff0cd8fcd4d1b5427215b5fb186b8f9319855b358676e468e7cc674925`.

The build timing is reused from an earlier candidate measurement: 68416.468 ms.
It covers one fresh offline pack invocation including Cargo compilation,
compatibility checks and tarball creation, with warm dependency caches and no
download time.


## Timings

Times are milliseconds. Each cell uses five measured samples; brackets contain
the minimum and maximum. Delta is switching minus replacement, so a negative
value favours switching.

| Workers | Replacement median [min, max] | Switching median [min, max] | Delta (percent) |
| ---: | ---: | ---: | ---: |
| 1 | 23345.054 ms [20302.937 ms, 26634.058 ms] | 22046.467 ms [20221.173 ms, 36334.171 ms] | -1298.587 ms (-5.56%) |
| 2 | 31537.761 ms [27246.927 ms, 49863.655 ms] | 32273.819 ms [30117.430 ms, 39700.116 ms] | 736.058 ms (2.33%) |

The wall boundary runs from installed CLI process spawn through stdout and
stderr drain. It includes capture, runner preparation, original typecheck and
baseline, fresh coverage and CRAP, switching preparation and prepared baselines,
mutation execution, cleanup and report serialization. Report parsing and
semantic validation follow that boundary. Top-level invocations are serial;
workers inside the workers-2 condition may run concurrently.
Phase timings are nested diagnostics that can overlap under worker parallelism;
they are not additive. Measured wall ranges were 20,302.937–26,634.058 ms for
replacement and 20,221.173–36,334.171 ms for switching at worker 1, then
27,246.927–49,863.655 ms and 30,117.430–39,700.116 ms at worker 2. The median
direction changed between worker counts, and these broad samples establish no
dependable speedup.

| Strategy | Workers | Wall | Capture | Execution | Analysis | Runner prep | Typecheck | Baseline | Coverage | Attribution | Worker prep | Switch prep | Prepared baseline | Mutation | Worker cleanup | Cleanup |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| replace | 1 | 23345.054 ms | 1825.239 ms | 19813.278 ms | 0.708 ms | 0.198 ms | 1454.545 ms | 5039.318 ms | 5136.998 ms | 0.028 ms | 0.000 ms | unavailable | unavailable | 8073.068 ms | 0.000 ms | 1187.852 ms |
| switch | 1 | 22046.467 ms | 2013.833 ms | 19270.259 ms | 0.883 ms | 0.255 ms | 1454.152 ms | 4831.468 ms | 5112.697 ms | 0.028 ms | 1933.098 ms | 1933.143 ms | 1932.945 ms | 5939.479 ms | 0.000 ms | 745.447 ms |
| switch | 2 | 32273.819 ms | 2045.535 ms | 28926.089 ms | 0.841 ms | 0.239 ms | 1379.557 ms | 5144.424 ms | 5061.762 ms | 0.027 ms | 9647.550 ms | 9647.591 ms | 2137.887 ms | 5991.465 ms | 1006.175 ms | 1146.812 ms |
| replace | 2 | 31537.761 ms | 1865.726 ms | 28796.962 ms | 0.758 ms | 0.243 ms | 1458.247 ms | 5107.030 ms | 5080.467 ms | 0.028 ms | 6816.236 ms | unavailable | unavailable | 7398.852 ms | 719.751 ms | 871.362 ms |

## Validation

The matrix contains 24 runs: one
warmup and five measured runs for each replacement/switching and worker 1/2
condition. Every run passed the original typecheck, test baseline, fresh coverage
and CRAP attribution. The `src/status.tsx` reports `[[2,3,3,2],[1,1,1,1],[1,1,1,1]]`. The exact mutants (`src/status.tsx` byte-113 `>=` -> `>`, `src/status.tsx` byte-113 `>=` -> `<`, `src/status.tsx` byte-216 `>` -> `>=`, `src/status.tsx` byte-216 `>` -> `<=`) produced 3 killed and 1 survived outcomes (score 75%), with no unresolved or not-run outcomes. Strategy-specific prepared and worker baseline rows were
validated separately before semantic parity was compared.

## Provenance

The raw portable reports and per-run timings are in
[`installed-jest-expo-switching-comparison.json`](../outputs/installed-jest-expo-switching-comparison.json).
The report retains the installed package and BUILD metadata, environment,
configuration hashes, source inventory, helper hash and protocol provenance.

The result is descriptive evidence for this small Jest/Expo fixture. It does not
claim that switching is faster for other projects, runners or hosts.
