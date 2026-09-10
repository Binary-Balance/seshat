# Installed switching comparison protocol

This slice measures one explicitly supplied, installed Linux x64 candidate
through the full `check --json` workflow on the shared Node workspace. It
compares the default replacement strategy with `--experimental-switching`.
The result is fixture-specific evidence; it is not a production performance
bound or a recommendation for every project.

## Candidate and dependencies

Build the candidate before running the matrix with the existing Debian inputs:

```sh
node packaging/pack.mjs work/debian11-inputs
```

The benchmark installs the resulting tarball once, offline, into a disposable
consumer. Its timed commands use only the installed `seshat` executable. The
benchmark requires the existing Node/TypeScript and coverage collector
dependencies under `benchmarks/` and `benchmarks/proofs/`; it does not require
the Jest/Expo fixture or Stryker.

On a clean checkout, install those already declared dependencies before the
timed command, without allowing a download during the matrix:

```sh
npm ci --prefix benchmarks --ignore-scripts --no-audit --no-fund
npm ci --prefix benchmarks/proofs --ignore-scripts --no-audit --no-fund
```

Pass the tarball explicitly. Do not use a default or historical candidate path.
The source and harness revisions are required provenance fields:

```sh
node benchmarks/proofs/diagnostics-overhead.mjs \
  --switching \
  --repo "$PWD" \
  --candidate "/absolute/path/to/binary-balance-seshat-0.0.0.tgz" \
  --candidate-commit RUNTIME_COMMIT \
  --harness-commit BENCHMARK_COMMIT \
  --build-evidence "/absolute/path/to/pack-timing.json" \
  --samples 5 \
  --output outputs/installed-switching-comparison.json \
  --report outputs/installed-switching-comparison.md
```

Run the command from a clean checkout after the protocol and harness have been
committed. Run it with host permissions. A mutation child `EPERM`, runner
startup failure or malformed report is an environment/execution failure and
must stop the slice; it is never a killed mutant or a timing result.

## Fixture and correctness

Every invocation uses the exact workspace emitted by
`node-workspace-fixture.mjs`:

```text
src/compare.ts:
export const adult = (age: number) => age >= 18;

packages/rules/index.ts:
export const answer = () => 42;
```

The one Node test, strict no-emit TypeScript configuration, package metadata
and `node_modules/@seshat/rules -> ../../packages/rules` symlink are included.
The input inventory must remain hash
`653ef36d6390f8fdee150758411ad04f74aa4d68579ac369467ea5d6a66a8110`.

Each run invokes `check --json` with the same generated configuration and
fresh scratch parent. The original typecheck, test baseline, coverage and
CRAP attribution must pass before mutation execution. Both source files must
report `[[1,1,1,1]]` as their function metrics. Exactly these two mutants are
allowed, and both must be killed:

| Path | Byte offset | Original | Replacement | Verdict |
| --- | ---: | --- | --- | --- |
| `src/compare.ts` | 42 | `>=` | `>` | killed |
| `src/compare.ts` | 42 | `>=` | `<` | killed |

Every run must be complete with score 100, one passing test in the original
baseline and coverage report, two completed mutants, zero unresolved or
not-run mutants, unchanged captured inputs and configuration, and an empty
scratch directory after cleanup. A test assertion failure is a kill only when
the run is otherwise complete; infrastructure errors, timeouts and restoration
failures are not kills.

Replacement runs must report strategy `replace`, no prepared baseline jobs and
`workerBaselineJobs == workers - 1`. Switching runs must report strategy
`switch`, one passing primary `preparedBaselines` row and
`preparedBaselineJobs == 1`; each additional worker must have one passing
`prepared-baseline` row. The top-level job count is 5 or 6 for replacement at
workers 1 or 2, and 6 or 7 for switching. These strategy and worker-specific
fields are validated before they are removed from the worker-independent
semantic parity projection.

## Matrix and timing

Use exactly one warmup and five measured samples for each of these four
conditions, for 24 serial top-level invocations:

| Strategy | Workers |
| --- | ---: |
| replacement | 1 |
| switching | 1 |
| switching | 2 |
| replacement | 2 |

Warmups use the listed order. Measured pairs alternate that order and its
reverse, rotating strategy and worker order. Mutation workers within the
workers-2 condition may run concurrently; top-level processes, installs and
builds remain serial. Host filesystem, npm, runner and OS caches remain warm.

The wall timer starts immediately before spawning the installed CLI and stops
after stdout and stderr drain. It therefore includes capture, runner
preparation, original typecheck and baseline, fresh coverage and CRAP,
switching preparation, prepared baselines, mutation execution, cleanup and
report serialization. Report parsing, hash checks and semantic validation
follow the timed boundary. Retain the CLI report's top-level and nested phase
timings separately; they are diagnostics and may overlap under parallelism.

The JSON evidence retains portable complete raw reports and command output,
per-run wall and report timings, source/config/input/helper hashes, installed
tarball/package/binary/`BUILD.json` metadata, tool/environment versions and
the optional explicitly supplied build timing. The Markdown report derives
medians, ranges and switching-minus-replacement deltas for each worker count.
Do not infer a general speedup from these four fixed conditions.

## Self-check and exclusions

Run the harness self-check before the matrix:

```sh
node benchmarks/proofs/diagnostics-overhead.mjs --switching --self-check
```

It exercises valid replacement and switching reports for both worker counts,
checks the 24-run summary shape and parity projection, and rejects changed
metrics, operators, verdicts, prepared-baseline counts, worker baseline phases
and semantic hashes.

This slice does not run Stryker, compare another candidate, reuse test-process
state, change the shared fixture helper, flush host caches or make a
cross-platform claim. Historical diagnostics, release and Stryker reports and
protocols remain separate evidence.
