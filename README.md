# Seshat

An experiment toward a small, fast TypeScript code-assurance tool combining CRAP
analysis and comparison-operator mutation testing.

The current code includes feasibility proofs and a Linux CLI candidate, not a
production release.

- [Rust feasibility results](outputs/rust-feasibility.md)
- [Reproduce the benchmark](benchmarks/README.md)
- [Raw results](outputs/benchmark-results.json)
- [Bounded coverage and mutation proofs](outputs/bounded-proofs.md)
- [Direct TypeScript-loading comparison](outputs/direct-load-proofs.md)
- [Verified coverage routes and limits](outputs/coverage-routes.md)
- [sample-application and sample-stack-stack integration](outputs/integration-proofs.md)
- [Real Jest/Expo integration](outputs/expo-integration.md)
- [Reproduce the bounded proofs](benchmarks/proofs/README.md)
- [Provisional module architecture](docs/architecture.md)

## Try the CLI candidate

### Local npm installation

The Linux x64/glibc candidate can now be packed and installed locally. It is
private and unpublished; this does not reserve the npm name. With the
[proof dependencies and Rust toolchain](benchmarks/proofs/README.md#run) installed,
run from this repository root:

```sh
node packaging/pack.mjs
```

The command rebuilds offline using the locked Cargo dependencies and prints a
tarball path under `work/npm-pack-*`. In a consuming project:

```sh
npm install --save-dev --save-exact --ignore-scripts /absolute/path/to/the/reported/package.tgz
./node_modules/.bin/seshat --help
./node_modules/.bin/seshat check --config ./seshat.json --json > seshat-report.json
```

The consuming project needs no Rust toolchain. npm links directly to the native
executable; no JavaScript launcher, install hook, download or npm runtime
dependency is added. Existing test-runner, typechecker and coverage setup is
still required. Use [the package instructions](packaging/README.md) for details.

Only Linux x64 with glibc is packaged here. The current binary references glibc
2.39 symbols and is verified on glibc 2.41 with Node 24.20.0 and npm 11.19.0.
Older Linux environments, macOS, Windows and ARM64 are not verified by this work.
The cross-platform release requirements remain unchanged.

A separate [Linux library experiment](benchmarks/proofs/README.md#linux-library-compatibility-experiment)
tests linking against glibc 2.31 without changing the Rust implementation. It
does not change the default npm build or establish an older-distribution support
claim; test runners still use host libraries.

### Build the native command directly

After installing the [proof dependencies and Rust toolchain](benchmarks/proofs/README.md#run),
build and inspect the candidate from this repository root:

```sh
export CARGO_TARGET_DIR="$PWD/benchmarks/rust/target"
cargo build --release --locked --manifest-path benchmarks/proofs/Cargo.toml --bins
benchmarks/rust/target/release/seshat --help
benchmarks/rust/target/release/seshat check --config /absolute/path/to/seshat.json
benchmarks/rust/target/release/seshat crap --config /absolute/path/to/seshat.json --json
benchmarks/rust/target/release/seshat mutate --config /absolute/path/to/seshat.json --json --no-progress
```

Use the [captured-project configuration](#project-capture-proof) below and the
[runner setup guidance](#coverage-setup-verified-by-the-proof). The configuration's
directory is the project root. With no `--config`, Seshat reads `./seshat.json`.
Scratch defaults to the operating system's temporary directory; `--scratch PATH`
selects an existing directory outside the project. Run only trusted test commands.

`check` runs both assessments. `crap` collects fresh coverage without running
mutants. `mutate` requires original typechecks and passing test baselines but
does not collect coverage or calculate CRAP. All three accept the same config,
including its coverage settings. [Optional quality thresholds](#ci-thresholds)
return exit 1 when unmet; without them exit 0 means complete execution, not good
scores. Errors and incomplete runs exit 2; handled
SIGINT/SIGTERM cancellation exits 130/143 and withholds the mutation score.

Readable output includes function scores, mutant verdicts, worker counts and
available timings. `--json` writes one draft versioned report to stdout, including
on failure. Progress goes to stderr; `--no-progress` suppresses it. See the
[report contract and limitations](benchmarks/proofs/README.md#cli-candidate).
No npm package or GitHub release is published by this work.

## Planned project configuration

The candidate above implements the basic commands and explicit configuration.
The remaining release requirements below are not an installation guide for a
finished tool.

Consuming projects will use a declarative `seshat.json` file to configure source
include/exclude patterns and runner settings. CRAP analysis and mutation testing
will use that same scope, and reports will show the resolved scope so omissions
can be checked. Configuration errors will be reported explicitly; executable
configuration and inheritance are outside the first release.

The file will support named test setups, each specifying its runner, working
directory, test and coverage commands, and report location. Use one setup for a
simple project or several for mixed runners in a workspace. All configured setups
will run for each mutant. Coverage reports will be combined only when their source
and statement mappings agree; conflicting reports will produce an explanation
and an incomplete result.

Coverage input will be full Istanbul JSON mapped to the original source, not a
summary-only report. The coverage proof verifies Node statement instrumentation,
Jest's Babel coverage route and Vitest's Istanbul provider on a bounded fixture.
c8's line-based counters do not satisfy the planned statement measurement.
Vitest's V8 provider still produces an ambiguous same-line function range that
the importer rejects. Full Istanbul JSON alone does not guarantee usable
attribution. See the setup guidance below before choosing a provider.

A `check` or `crap` run will execute the configured coverage command and read its fresh
report. Scores will use per-function statement coverage. Missing or unreliable
coverage will make the run incomplete, rather than silently producing a score.

Mutation testing will use isolated source replacement by default, with switching
retained as an explicit experimental option. Both will run all configured tests
for each mutant using fresh test processes. An explicit worker limit will allow
parallel mutation executions, with one worker by default. Increase it only when
tests isolate shared resources such as ports, files and databases, and check that
the results remain consistent.

The release README will include verified setup examples for single-package
projects and npm workspaces, all required test-runner and coverage configuration,
parallel-execution guidance, and commands for running Seshat and checking its
source scope. Exact configuration fields and commands will be documented once
implemented and verified.

See the [agreed release scope](docs/release-scope.md) for the design and the
correctness, integration, performance, size and documentation checks required
before release.

Runtime reports show phase/per-setup timings, worker settings and completed,
not-run and unresolved mutant counts. Progress on stderr includes elapsed time
and snapshots of completed, running and remaining mutation work. These are
event-driven updates, not a heartbeat during a long test. `--no-progress` keeps
the same final measurements while suppressing progress output.

To tune a project, record several complete `check --json` runs with one worker.
Keep source scope, test setups, dependencies and inputs fixed. Change only
`workers`, repeat the same runs and compare whole-command timings alongside
`result.phaseTimings`, worker preparation and mutation wall time. Check identical
function scores, mutant definitions/verdicts and job counts, allowing the expected
extra worker-baseline jobs. Separate processes do not isolate ports, databases
or external files. Coordinate the runner's own concurrency before adding workers.
Keep the faster configuration only if outcomes remain consistent; the earlier
sample helper proof was slower with two workers. Do not reduce assessment scope
or coverage to improve a timing result. See the [measurement definitions](benchmarks/proofs/README.md#cli-candidate)
and [remaining diagnostics work](docs/release-scope.md#runtime-diagnostics-to-develop).

## Project capture proof

The native [project capture proof](benchmarks/proofs/README.md#project-capture-and-configuration)
now validates a small configuration, resolves source patterns and inspects an
isolated copy. It supports explicit capture entries and internal workspace links,
and leaves the original checkout unchanged. `capture` does not run commands.
The experimental [collection command](benchmarks/proofs/README.md#captured-project-collection)
adds Node baselines, fresh Istanbul reports and per-function CRAP scores across
configured setups. The experimental `check` command also validates original
TypeScript and runs replacement mutants through every setup in fresh processes.
It supports verified routes on Linux with Node 24.20.0: Node's built-in runner,
Jest 29.7.0 / jest-expo 57.0.5, and Vitest 5.0.0 with Istanbul coverage. See the
[combined-check instructions](benchmarks/proofs/README.md#captured-project-check).
The [real sample check](benchmarks/proofs/README.md#sample-combined-workflow)
now completes for the four selected domain TypeScript files: 58 killed and 16
surviving mutants (78.38%), with coverage and source isolation verified. A bounded
Node observer distinguishes verified application import failures from unresolved
runner/setup failures; it does not treat every crashed test process as a kill.
Its configuration is experimental, not the finished release interface.
The [combined Expo check](benchmarks/proofs/README.md#expo-combined-workflow) also
completes on the retained, locked sample mobile installation: 13 tests, five
hand-checked CRAP results, and 6 killed / 1 surviving mutant across three selected
source files. This is a bounded mobile assessment, not a whole-application score.
The [combined Vitest check](benchmarks/proofs/README.md#vitest-combined-workflow)
also reproduces the representative sample-stack-stack fixture: three tests,
four hand-checked function scores and four killed mutants. It is synthetic
React/TSX, Fastify and TypeBox evidence, not an assessment of sample-stack itself.
The [lifecycle proof](benchmarks/proofs/README.md#cancellation-and-process-cleanup)
checks Linux SIGINT/SIGTERM cancellation, owned-process cleanup and partial results.
Cancelled checks withhold the mutation score and exit 130/143. SIGKILL can leave
test processes and temporary copies behind; it cannot run cleanup.
The native proof also supports opt-in [parallel mutation workers](benchmarks/proofs/README.md#parallel-mutation-workers)
through top-level `"workers": 2`. It defaults to one, keeps writable copies and
receipts separate, and reports additional baseline/copy overhead. This is not
isolation for shared ports, databases or absolute file paths.
Two-worker checks now reproduce the same results for the verified Vitest and
Jest/Expo fixtures, including their failure controls. See the
[runner-specific parallel checks](benchmarks/proofs/README.md#two-workers-with-vitest-and-jestexpo).

## Coverage setup verified by the proof

These are fixture-tested routes, not a finished Seshat installation guide.
Run the [coverage proof](benchmarks/proofs/README.md#coverage-route-follow-up)
with `node benchmarks/proofs/coverage-routes.mjs` after its dependency/build steps.

For Vitest, the tested pair is `vitest@5.0.0` and
`@vitest/coverage-istanbul@5.0.0`. Merge the coverage settings into the project's
existing Vitest configuration. The proof uses:

```js
export default {
  test: {
    coverage: {
      provider: 'istanbul',
      include: ['subject.tsx', 'unloaded.tsx'],
      reporter: ['json'],
      reportsDirectory: 'coverage',
    },
  },
};
```

Use the project's selected production-source paths instead of the fixture paths,
then run `npx --no-install vitest run --coverage`. Include files that tests never import. Inspect
`coverage/coverage-final.json` to confirm that paths and locations refer to the
original TypeScript, and check that unexecuted files have actual zero counters.
The normal coverage defaults or a summary-only reporter are insufficient here.

For Jest, use `coverageProvider: 'babel'`, `coverageReporters: ['json']` and an
explicit `collectCoverageFrom` covering the selected source. The verified fixture
transpiles TSX to CommonJS with inline original-source maps before running
`npx --no-install jest --coverage`. The [real Expo follow-up](benchmarks/proofs/README.md#real-jestexpo-follow-up)
also verifies sample's existing Jest 29.7.0 / jest-expo 57.0.5 transform on two
TSX components and a TypeScript motion function. Other project configurations
still need their own mapping check; a preset name alone is not a guarantee.

For Node's built-in test runner, the proof uses `istanbul-lib-instrument`,
`istanbul-lib-coverage` and `istanbul-lib-source-maps`. It instruments the compiled
source with its TypeScript map, preserves the instrumenter's initial zero counters
for unloaded files, collects runtime counters, then remaps the merged report.
The [proof script](benchmarks/proofs/coverage-routes.mjs) is the runnable example.
The [integration proof](benchmarks/proofs/integration.mjs) also collects separate
counters from sample-application's four test processes, merges them, and maps them
back to source. It is a bounded example, not a general Node coverage collector.
Do not substitute c8's line records for statement coverage.

Use compatible maps when multiple setups cover the same source. The Node and Jest
reports merge in this fixture; Node and Vitest's maps differ and are rejected,
even though their per-function counts agree. Provider settings alone do not remove
that integration constraint.

## Interpreting the planned results

These are the agreed reporting rules for the first release. The original benchmark
uses synthetic coverage; the bounded proof uses real coverage of a small fixture.
The [integration proof](outputs/integration-proofs.md) reports real sample-application domain functions and a synthetic sample-stack-stack fixture. Its selected
mutation files do not represent either whole project's mutation score.

### CRAP

CRAP combines a function's complexity with its statement coverage:
`complexity^2 * (1 - coverage)^3 + complexity`, using coverage from 0 to 1.
Higher scores identify complex or insufficiently exercised functions to
investigate; they are not a count of bugs or a prediction of failure probability.

For a function with complexity 10:

| Statement coverage | CRAP score |
| --- | --- |
| 0% | 110 |
| 50% | 22.5 |
| 100% | 10 |

Use the complexity and coverage values together to decide whether to add tests,
simplify the function, or both. Executing every statement does not prove that
tests check the right outcomes. Compare scores using the same measurement rules
and coverage setup, not just a matching metric name.

Unknown coverage makes the run incomplete. A genuinely empty function has
not-applicable coverage and CRAP, with complexity still reported. Class-field
initialisers and static blocks receive complexity results but are explicitly
outside first-release CRAP scoring.

### Mutation testing

A killed mutant produced a test failure after a passing baseline. A surviving
mutant passed the selected tests. Inspect survivors for missing inputs or
assertions, but do not assume every survivor is a test defect: a change may be
behaviourally equivalent for the program's valid inputs.

For a complete run, the mutation score is
`killed / (killed + survived) * 100`. Eight kills and two survivors means 80%.
That is 80% of the generated comparison mutants detected, not 80% of all possible
bugs. Even 100% does not establish correctness or cover mutation types outside
Seshat's configured scope.

Timeouts and execution errors are not automatic kills. Unresolved executions
make the run incomplete, with counts reported but no final mutation percentage.
No mutants means not applicable, not 100%.

### CI thresholds

The candidate accepts an optional `thresholds` object in `seshat.json`. Add it
alongside `source`, `capture` and `setups`. Merge this example into the existing
configuration; it is not a complete configuration by itself:

```json
{
  "thresholds": {
    "maxCrap": 30,
    "minMutationScore": 80
  }
}
```

These are examples, not recommended defaults. Inspect results and source scope
before choosing limits. `maxCrap` is a finite number at least zero and applies to
every measured function, not an average across the project. `minMutationScore`
is a finite percentage from 0 to 100 for the complete mutation run. Equality
passes; comparisons use unrounded scores. Omit either field, or set it to null,
to disable that check. Omit the object or use `{}` to disable both. Unknown
fields, invalid types and out-of-range values are configuration errors.

`check` evaluates both configured limits. `crap` labels a configured mutation
limit `not-requested`; `mutate` does the same for a CRAP limit. Neither command
runs an extra assessment just because a threshold exists. Empty functions and
class initialisation scopes remain outside CRAP scoring. No scored functions or
zero planned mutants yields `not-applicable` for the corresponding limit, not a
fabricated passing score. This does not fail CI by itself; check the reported
scope and counts when expecting assessed functions or mutants.

| Exit | Meaning |
| --- | --- |
| 0 | Complete run with no failed applicable threshold |
| 1 | Complete run with at least one unmet threshold; valid scores retained |
| 2 | Invalid configuration, failed baseline, incomplete run or output failure |
| 130 / 143 | Handled SIGINT / SIGTERM cancellation |

Incomplete runs and cancellation take precedence over quality checks, even when
retained partial CRAP results already exceed a limit. JSON keeps execution
`complete` separate from `quality.state`. The latter is `passed`, `failed`,
`incomplete`, `not-configured`, or `not-evaluated` when all configured checks were
unrequested or not applicable. `quality.checks` records each configured metric,
limit, actual unrounded value and state. Unevaluated actual values are null;
`quality` itself is null if configuration/capture did not succeed.

In CI, preserve the command's exit code while redirecting its report:

```sh
/absolute/path/to/seshat check --config ./seshat.json --json > seshat-report.json
```

This invocation returns non-zero for all unmet thresholds, incomplete runs and
configuration errors without requiring JSON parsing. Keep the JSON report as a
CI artifact, including on failure. Thresholds currently belong to the `seshat`
candidate; legacy `seshat-proofs` commands remain measurement-only.

Licensed under [MIT](LICENSE).
