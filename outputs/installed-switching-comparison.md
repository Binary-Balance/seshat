# Installed Seshat switching comparison

This report records the fixed candidate-only Node workspace matrix described by
[`installed-switching-comparison.md`](../benchmarks/proofs/installed-switching-comparison.md).
It is fixture-specific evidence and does not establish a production performance
bound.

The installed candidate source revision is d4b30a11257741cefb0091e37c90d7d91bac8b02.
The candidate tarball SHA-256 is `157856543150f2428c73a303e8bf1d3115bc8b8e333efd10a9e0c333a16f7ee4`. The shared workspace input
hash is `653ef36d6390f8fdee150758411ad04f74aa4d68579ac369467ea5d6a66a8110`; the common worker-independent semantic
hash is `ffed486d93935a9ed099e10dab3cd1e45635ff076de7108d55921ca7ca7e987d`.

The candidate build was one fresh offline `node packaging/pack.mjs
work/debian11-inputs` invocation. Its recorded wall time was 68,416.468 ms
with warm dependency caches and no download time. This is a single
warm-dependency build observation, not a cold or repeated build estimate.

## Timings

Times are milliseconds. Each cell uses five measured samples; brackets contain
the minimum and maximum. Delta is switching minus replacement, so a negative
value favours switching.

| Workers | Replacement median [min, max] | Switching median [min, max] | Delta (percent) |
| ---: | ---: | ---: | ---: |
| 1 | 1844.678 ms [1751.711 ms, 1887.410 ms] | 1963.123 ms [1946.723 ms, 1974.895 ms] | 118.445 ms (6.42%) |
| 2 | 1893.843 ms [1874.204 ms, 1946.147 ms] | 2046.603 ms [2018.740 ms, 2172.278 ms] | 152.760 ms (8.07%) |

The wall boundary runs from installed CLI process spawn through stdout and
stderr drain. It includes capture, runner preparation, original typecheck and
baseline, fresh coverage and CRAP, switching preparation and prepared baselines,
mutation execution, cleanup and report serialization. Report parsing and
semantic validation follow that boundary. Top-level invocations are serial;
workers inside the workers-2 condition may run concurrently.

| Strategy | Workers | Wall | Capture | Execution | Analysis | Runner prep | Typecheck | Baseline | Coverage | Attribution | Worker prep | Switch prep | Prepared baseline | Mutation | Worker cleanup | Cleanup |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| replace | 1 | 1844.678 ms | 0.874 ms | 1838.661 ms | 0.086 ms | 0.182 ms | 614.557 ms | 159.713 ms | 683.411 ms | 0.026 ms | 0.000 ms | unavailable | unavailable | 325.141 ms | 0.000 ms | 0.803 ms |
| switch | 1 | 1963.123 ms | 0.846 ms | 1958.553 ms | 0.085 ms | 0.188 ms | 596.334 ms | 160.338 ms | 693.821 ms | 0.026 ms | 160.603 ms | 160.650 ms | 160.378 ms | 330.333 ms | 0.000 ms | 0.837 ms |
| switch | 2 | 2046.603 ms | 0.873 ms | 2041.845 ms | 0.083 ms | 0.180 ms | 609.385 ms | 158.015 ms | 687.742 ms | 0.026 ms | 323.652 ms | 323.697 ms | 159.994 ms | 255.907 ms | 0.757 ms | 0.745 ms |
| replace | 2 | 1893.843 ms | 0.966 ms | 1888.683 ms | 0.085 ms | 0.182 ms | 619.296 ms | 157.804 ms | 695.937 ms | 0.026 ms | 161.154 ms | unavailable | unavailable | 247.987 ms | 0.703 ms | 0.700 ms |

## Validation

The matrix contains 24 runs: one
warmup and five measured runs for each replacement/switching and worker 1/2
condition. Every run passed the original typecheck, test baseline, fresh coverage
and CRAP attribution. Both source files report the expected `[[1,1,1,1]]`
metrics. Both exact byte-42 `>=` mutants were killed with no unresolved or
not-run outcomes. Strategy-specific prepared and worker baseline rows were
validated separately before semantic parity was compared.

## Provenance

The raw portable reports and per-run timings are in
[`installed-switching-comparison.json`](../outputs/installed-switching-comparison.json).
The report retains the installed package and BUILD metadata, environment,
configuration hashes, source inventory, helper hash and protocol provenance.

The result is descriptive evidence for this small Node workspace. It does not
claim that switching is faster for other projects, runners or hosts.
