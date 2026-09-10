# Installed Vitest switching comparison protocol

This slice measures one explicitly supplied, installed Linux x64 candidate
through the full `check --json` workflow on the existing Vitest React/Fastify
TSX fixture. It compares the default replacement strategy with
`--experimental-switching`. The result is fixture-specific evidence; it does
not establish a production performance bound or a recommendation for every
Vitest project.

## Candidate and dependencies

Build the candidate with the existing Debian inputs before the matrix:

```sh
node packaging/pack.mjs work/debian11-inputs
```

The benchmark installs the explicitly supplied tarball once, offline, into a
disposable consumer. The fixture copies the already installed proof
dependencies from `benchmarks/proofs/node_modules`; it does not download or
resolve dependencies during a timed run. The fixture records the versions of
Vitest, `@vitest/coverage-istanbul`, Fastify, TypeBox, React and ReactDOM.
TypeScript is recorded from `benchmarks/node_modules` as the harness tool.

On a clean checkout, install the already declared dependencies before the
timed command, without allowing a download during the matrix:

```sh
npm ci --prefix benchmarks --ignore-scripts --no-audit --no-fund
npm ci --prefix benchmarks/proofs --ignore-scripts --no-audit --no-fund
```

Pass the tarball explicitly. Do not use a default or historical candidate
path. The source and harness revisions are required provenance fields:

```sh
node benchmarks/proofs/diagnostics-overhead.mjs \
  --switching \
  --switching-fixture vitest \
  --repo "$PWD" \
  --candidate "/absolute/path/to/binary-balance-seshat-0.0.0.tgz" \
  --candidate-commit RUNTIME_COMMIT \
  --harness-commit BENCHMARK_COMMIT \
  --build-evidence "/absolute/path/to/pack-timing.json" \
  --samples 5 \
  --output outputs/installed-vitest-switching-comparison.json \
  --report outputs/installed-vitest-switching-comparison.md
```

The build evidence may be the direct JSON captured by `pack.mjs`. If that
capture is unavailable, the prior installed switching comparison JSON may be
passed instead; the driver records its `buildCost` as historical reused build
timing and keeps that label in the portable evidence and report. A reused
timing is not a fresh Vitest build measurement.

Run the command from a clean checkout after this protocol and the harness have
been committed. Run it with host permissions. A mutation child `EPERM`, runner
startup failure or malformed report is an environment/execution failure and
must stop the slice; it is never a killed mutant or a timing result.

## Fixture and correctness

The driver reuses `makeVitestFixture()` in
`diagnostics-overhead.mjs`, with no JavaScript or fixture substitutions. It
copies the existing `benchmarks/proofs/fixtures/vitest` files and the existing
proof dependency tree, then writes the same generated Vitest config for every
run. The source, test and config inputs are:

```text
tempo.ts
view.tsx
server.ts
stack.test.tsx
package.json
tsconfig.json
vitest.config.mjs
```

The generated Seshat setup typechecks with the local TypeScript compiler, runs
Vitest 5 with `--maxWorkers=1 --no-file-parallelism --maxConcurrency=1`, and
collects fresh Istanbul JSON coverage from `tempo.ts`, `view.tsx` and
`server.ts`. The input inventory must remain hash
`a031b45a18aebad086e832f8c73972fdcbc129e9837c8d63f20c0fb8a4c6f455`.

Every run must pass the original typecheck, test baseline, fresh coverage and
CRAP attribution before mutation execution. The expected source metrics are:

| Path | Function metrics `[complexity, covered, total, CRAP]` |
| --- | --- |
| `tempo.ts` | `[[3,5,5,3]]` |
| `view.tsx` | `[[1,1,1,1]]` |
| `server.ts` | `[[1,3,3,1],[1,1,1,1]]` |

Exactly these four mutants are allowed, and all must be killed:

| Path | Byte offset | Original | Replacement | Verdict |
| --- | ---: | --- | --- | --- |
| `tempo.ts` | 60 | `<` | `<=` | killed |
| `tempo.ts` | 60 | `<` | `>=` | killed |
| `tempo.ts` | 91 | `>` | `>=` | killed |
| `tempo.ts` | 91 | `>` | `<=` | killed |

The expected mutation score is 100% with three passing tests. Each run must
be complete, retain unique receipt execution IDs, report four completed
mutants and zero unresolved or not-run mutants, preserve captured inputs and
configuration, and leave the scratch directory empty after cleanup. A test
assertion failure is a kill only when the run is otherwise complete;
infrastructure errors, timeouts and restoration failures are not kills.

Replacement runs must report strategy `replace`, no prepared baseline jobs and
`workerBaselineJobs == workers - 1`. Switching runs must report strategy
`switch`, one passing primary `preparedBaselines` row and
`preparedBaselineJobs == 1`; each additional worker must have one passing
`prepared-baseline` row. The top-level job count is 7 or 8 for replacement at
workers 1 or 2, and 8 or 9 for switching. Mutation jobs remain four. These
strategy and worker-specific fields are validated before they are removed from
the worker-independent semantic parity projection.

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
builds remain serial. Host filesystem, npm, Vitest and OS caches remain warm.

The wall timer starts immediately before spawning the installed CLI and stops
after stdout and stderr drain. It includes capture, runner preparation,
original typecheck and baseline, fresh coverage and CRAP, switching preparation
and prepared baselines, mutation execution, cleanup and report serialization.
Report parsing, hash checks and semantic validation follow the timed boundary.
Retain the CLI report's top-level and nested phase timings separately; they are
diagnostics and may overlap under parallelism.

The JSON evidence retains portable complete raw reports and command output,
per-run wall and report timings, source/config/input/dependency/helper hashes,
installed tarball/package/binary/`BUILD.json` metadata, tool/environment
versions and the optional explicitly supplied build timing. The Markdown
report derives medians, ranges and switching-minus-replacement deltas for each
worker count. Do not infer a general speedup from these four fixed conditions.

## Self-check and exclusions

Run the Vitest switching self-check before the matrix:

```sh
node benchmarks/proofs/diagnostics-overhead.mjs \
  --switching --switching-fixture vitest --self-check
```

It exercises valid replacement and switching reports for both worker counts,
checks the 24-run summary shape and parity projection, and rejects changed
metrics, operators, verdicts, prepared-baseline counts, worker baseline phases
and semantic hashes. The existing Node switching self-check and release
self-check must continue to pass. `--switching-fixture vitest` is rejected
unless `--switching` is also supplied, and unknown fixture names are rejected.

This slice does not run Stryker, compare another candidate, reuse test-process
state, change the shared Node workspace helper, alter the Vitest fixture,
flush host caches or make a cross-platform claim. Historical diagnostics,
release, Node switching and Stryker reports and protocols remain separate
evidence. The generated output names are
`outputs/installed-vitest-switching-comparison.json` and
`outputs/installed-vitest-switching-comparison.md`.
