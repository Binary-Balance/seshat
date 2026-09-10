# Installed Seshat Vitest switching comparison

This report records the fixed candidate-only Vitest/TSX fixture matrix described by
[`installed-vitest-switching-comparison.md`](../benchmarks/proofs/installed-vitest-switching-comparison.md).
It is fixture-specific evidence and does not establish a production performance
bound.

The installed candidate source revision is d4b30a11257741cefb0091e37c90d7d91bac8b02.
The candidate tarball SHA-256 is `157856543150f2428c73a303e8bf1d3115bc8b8e333efd10a9e0c333a16f7ee4`. The fixture input
hash is `a031b45a18aebad086e832f8c73972fdcbc129e9837c8d63f20c0fb8a4c6f455`; the common worker-independent semantic
hash is `32cffee0844d54727a9d7316e98dde4cf76c76e1533bab00ecaa9665221f6a53`.

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
| 1 | 9608.468 ms [9281.716 ms, 10561.165 ms] | 10585.676 ms [10431.559 ms, 12165.074 ms] | 977.208 ms (10.17%) |
| 2 | 11087.688 ms [10449.576 ms, 11763.327 ms] | 13831.432 ms [11595.490 ms, 14152.991 ms] | 2743.744 ms (24.75%) |

The wall boundary runs from installed CLI process spawn through stdout and
stderr drain. It includes capture, runner preparation, original typecheck and
baseline, fresh coverage and CRAP, switching preparation and prepared baselines,
mutation execution, cleanup and report serialization. Report parsing and
semantic validation follow that boundary. Top-level invocations are serial;
workers inside the workers-2 condition may run concurrently. Phase timings are
nested diagnostics that can overlap under parallelism; they are not additive.

| Strategy | Workers | Wall | Capture | Execution | Analysis | Runner prep | Typecheck | Baseline | Coverage | Attribution | Worker prep | Switch prep | Prepared baseline | Mutation | Worker cleanup | Cleanup |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| replace | 1 | 9608.468 ms | 663.940 ms | 8694.085 ms | 0.134 ms | 0.190 ms | 2217.692 ms | 938.500 ms | 1310.079 ms | 0.035 ms | 0.000 ms | unavailable | unavailable | 4111.334 ms | 0.000 ms | 242.437 ms |
| switch | 1 | 10585.676 ms | 671.958 ms | 9669.301 ms | 0.127 ms | 0.223 ms | 2180.830 ms | 962.791 ms | 1348.968 ms | 0.036 ms | 1050.356 ms | 1050.402 ms | 1049.993 ms | 3919.727 ms | 0.000 ms | 240.859 ms |
| switch | 2 | 13831.432 ms | 657.661 ms | 12845.109 ms | 0.129 ms | 0.187 ms | 2208.676 ms | 939.868 ms | 1358.914 ms | 0.038 ms | 2652.060 ms | 2652.101 ms | 1013.721 ms | 4557.287 ms | 284.681 ms | 281.248 ms |
| replace | 2 | 11087.688 ms | 665.459 ms | 10101.722 ms | 0.127 ms | 0.193 ms | 2269.795 ms | 971.294 ms | 1355.629 ms | 0.036 ms | 1617.506 ms | unavailable | unavailable | 3646.588 ms | 239.990 ms | 240.168 ms |

## Validation

The matrix contains 24 runs: one
warmup and five measured runs for each replacement/switching and worker 1/2
condition. Every run passed the original typecheck, test baseline, fresh coverage
and CRAP attribution. The `tempo.ts` reports `[[3,5,5,3]]`; `view.tsx` reports `[[1,1,1,1]]`; `server.ts` reports `[[1,3,3,1],[1,1,1,1]]`. All 4 exact mutants (`tempo.ts` byte-60 `<` -> `<=`, `tempo.ts` byte-60 `<` -> `>=`, `tempo.ts` byte-91 `>` -> `>=`, `tempo.ts` byte-91 `>` -> `<=`) were killed with no unresolved or not-run outcomes. Strategy-specific prepared and worker baseline rows were
validated separately before semantic parity was compared.

## Provenance

The raw portable reports and per-run timings are in
[`installed-vitest-switching-comparison.json`](../outputs/installed-vitest-switching-comparison.json).
The report retains the installed package and BUILD metadata, environment,
configuration hashes, source inventory, helper hash and protocol provenance.

The result is descriptive evidence for this small Vitest/TSX fixture. It does not
claim that switching is faster for other projects, runners or hosts.
