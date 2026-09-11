# Installed Jest/Expo switching comparison protocol

This slice measures one explicitly supplied, installed Linux x64 candidate
through the full `check --json` workflow on the existing Jest/Expo React TSX
fixture. It compares the default replacement strategy with
`--experimental-switching`. The result is fixture-specific evidence; it does
not establish a production performance bound or a recommendation for every
Jest or Expo project.

The exact fixture selector is `--switching-fixture jest-expo`. The fixture
identity remains `jestExpo` in JSON evidence for compatibility with the
existing release benchmark.

## Candidate and dependencies

Use the existing candidate tarball and the separately prepared dependency
directory. The benchmark installs the tarball once, offline, into a disposable
consumer. The fixture copies the supplied Jest/Expo `node_modules` tree into
its isolated project; it does not download or resolve dependencies during a
timed run. The dependency directory must contain the versions already used by
the release fixture: Jest 29.7.0, jest-expo 57.0.5, Expo 57.0.20,
React Native and `@react-native/jest-preset` 0.86.3,
`babel-preset-expo` 57.0.10, React 19.2.3 and TypeScript 6.0.3.

The candidate build timing is reused from the earlier candidate measurement;
this slice does not rebuild the candidate. If the direct pack timing capture is
unavailable, pass the prior installed switching comparison JSON as
`--build-evidence`; the driver records its nested `buildCost` as historical
reused timing.

On a clean checkout, install the already declared harness dependencies before
the timed command, without allowing a download during the matrix:

```sh
npm ci --prefix benchmarks --ignore-scripts --no-audit --no-fund
npm ci --prefix benchmarks/proofs --ignore-scripts --no-audit --no-fund
```

Pass the candidate and dependency paths explicitly. Do not use a default or
historical candidate path:

```sh
node benchmarks/proofs/diagnostics-overhead.mjs \
  --switching \
  --switching-fixture jest-expo \
  --repo "$PWD" \
  --candidate "/absolute/path/to/binary-balance-seshat-0.0.0.tgz" \
  --jest-deps "/absolute/path/to/jest-expo-fixture" \
  --candidate-commit RUNTIME_COMMIT \
  --harness-commit BENCHMARK_COMMIT \
  --build-evidence "/absolute/path/to/pack-timing.json" \
  --samples 5 \
  --output outputs/installed-jest-expo-switching-comparison.json \
  --report outputs/installed-jest-expo-switching-comparison.md
```

Run the command from a clean checkout after this protocol and the harness have
been committed. Run it with host permissions. A mutation child `EPERM`, runner
startup failure or malformed report is an environment/execution failure and
must stop the slice; it is never a killed or survived mutant and never a timing
result.

## Fixture and correctness

The driver reuses `makeJestFixture()` and `EXPECTED.jestExpo` in
`diagnostics-overhead.mjs`, with no JavaScript or fixture substitutions. It
copies the existing fixture files and the supplied dependency tree, then writes
the same generated Seshat configuration used by the original release fixture.
The captured inputs are:

```text
package.json
package-lock.json
tsconfig.json
babel.config.cjs
jest.config.cjs
src/status.tsx
tests/status.test.tsx
```

The generated setup typechecks with the local TypeScript compiler, runs the
Jest/Expo test file with `--runInBand`, and collects fresh Babel JSON coverage
for `src/status.tsx`. The input inventory must remain hash
`2620191d8d5b8aad5ed118f0df814da17e5e9646b696722d84afbcc58265ec1c`.

Every run must pass the original typecheck, three-test baseline, fresh coverage
and CRAP attribution before mutation execution. The expected source metrics are:

| Path | Function metrics `[complexity, covered, total, CRAP]` |
| --- | --- |
| `src/status.tsx` | `[[2,3,3,2],[1,1,1,1],[1,1,1,1]]` |

Exactly these four mutants are allowed:

| Path | Byte offset | Original | Replacement | Verdict |
| --- | ---: | --- | --- | --- |
| `src/status.tsx` | 113 | `>=` | `>` | killed |
| `src/status.tsx` | 113 | `>=` | `<` | killed |
| `src/status.tsx` | 216 | `>` | `>=` | survived |
| `src/status.tsx` | 216 | `>` | `<=` | killed |

The expected mutation score is 75%: three mutants are killed and one is
survived. The survived mutant is a complete, passing assessed test result; it
must not be rewritten as a kill. Every run must retain unique complete receipt
execution IDs, report four completed mutants, zero unresolved or not-run
mutants, preserve captured inputs and configuration, and leave the scratch
directory empty after cleanup. Infrastructure errors, timeouts and restoration
failures are not mutation verdicts.

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
reverse, rotating strategy and worker order. Jest remains `--runInBand`; the
workers-2 condition exercises Seshat worker preparation while top-level
processes, installs and builds remain serial. Host filesystem, npm, Jest and OS
caches remain warm.

The wall timer starts immediately before spawning the installed CLI and stops
after stdout and stderr drain. It includes capture, runner preparation,
original typecheck and baseline, fresh coverage and CRAP, switching preparation
and prepared baselines, mutation execution, cleanup and report serialization.
Report parsing, hash checks and semantic validation follow the timed boundary.
Retain the CLI report's top-level and nested phase timings separately; they are
nested diagnostics that may overlap under worker parallelism and are not
additive.

The JSON evidence retains portable complete raw reports and command output,
per-run wall and report timings, source/config/input/dependency/helper hashes,
installed tarball/package/binary/`BUILD.json` metadata, tool/environment
versions and the optional explicitly supplied build timing. The Markdown
report derives medians, ranges and switching-minus-replacement deltas for each
worker count. Do not infer a general speedup from these four fixed conditions.

## Self-check and exclusions

Run the Jest/Expo switching self-check before the matrix:

```sh
node benchmarks/proofs/diagnostics-overhead.mjs \
  --switching --switching-fixture jest-expo --self-check
```

It exercises both killed and survived expected outcomes for replacement and
switching at both worker counts, checks the 24-run summary shape and parity
projection, and rejects changed metrics, operators, verdicts, prepared-baseline
counts, worker baseline phases and semantic hashes. The existing release,
Node switching and Vitest switching self-checks must continue to pass.
`--switching-fixture jest-expo` is rejected unless `--switching` is also
supplied, and unknown fixture names are rejected. `--jest-deps` is required for
this selector and is not required by the Node or Vitest switching modes.

This slice does not run Stryker, compare another candidate, reuse test-process
state, change the shared Node workspace helper, alter the Jest/Expo fixture,
flush host caches or make a cross-platform claim. Historical diagnostics,
release, Node switching, Vitest switching and Stryker reports and protocols
remain separate evidence. The generated output names are
`outputs/installed-jest-expo-switching-comparison.json` and
`outputs/installed-jest-expo-switching-comparison.md`.
