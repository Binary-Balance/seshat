# Seshat release scope

This records the agreed first-release design. Concrete configuration fields,
supported version ranges and execution details must be verified during
implementation; changes to these design choices require renewed discussion.

## First release

- Deliver both CRAP analysis with real coverage attribution and comparison-operator
  mutation testing in the same tool.
- Prioritise small, readable maintained code, then installed size. Track dependency
  count and build costs without treating fewer dependencies or lines as ends in
  themselves.
- Provide npm installation with native Rust execution and a standalone native
  installation option. Consuming projects must not need a Rust toolchain.
- Support Node's built-in test runner, Jest/Expo and Vitest, developed and verified
  one at a time.
- Ship native binaries for Linux and macOS on x64 and ARM64, and Windows on x64.
  Windows ARM64 and Alpine Linux are deferred. Linux x64's verified userspace
  baseline is Debian 11/glibc 2.31 with Node 24.20.0. Minimum kernel versions and
  the other targets' OS/native-library baselines remain to be established.
- Accept full, source-mapped Istanbul JSON coverage, using existing runner
  reporters or conversion tools rather than a custom V8 coverage converter.
- Provide terminal output and versioned machine-readable JSON reports.
- Preserve assurance when optimising, as recorded in
  `adr/0001-preserve-assurance-when-optimising.md`.

## After the first release

Consider broader mutation operators, such as arithmetic changes, boolean-literal
changes and statement removal. These are candidates for later evaluation, not
committed features; do not build extension machinery for them upfront.

Playwright-driven mutation testing is outside the first release. Reconsider it
when there is a demonstrated need.

HTML reports, dashboards and editor integrations are also outside the first
release. Reconsider them when terminal output and JSON do not meet a concrete
need.

## Comparison changes

Generate boundary shifts and paired opposite operators for relational
comparisons, and equality/inequality inversions for equality comparisons. Each
mutant contains one change and is assessed separately. The pairs are:

| Original | Replacements |
| --- | --- |
| `<` | `<=`, `>=` |
| `<=` | `<`, `>` |
| `>` | `>=`, `<=` |
| `>=` | `>`, `<` |
| `==` | `!=` |
| `!=` | `==` |
| `===` | `!==` |
| `!==` | `===` |

Changes between loose and strict equality are deferred until after the first
release. Benchmark the agreed set of mutants, not just the smaller set in the
original experiment.

## Source scope and safety

Use explicit source include/exclude patterns in a small configuration file.
CRAP analysis and mutation testing use the same resolved source scope, which
must be visible in the report.

Mutation testing must not overwrite the developer's source files. Use an isolated
execution copy, with the mutation-preparation strategy verified as described
below. This protects the source checkout but does not sandbox tests or their
access to external systems.

## CRAP calculation

Use `complexity^2 * (1 - coverage)^3 + complexity`, where coverage is the fraction
of measured executable statements executed, from 0 to 1. Attribute statements
separately to their owning functions rather than treating a function invocation
as full coverage. Label the result as CRAP using statement coverage; do not imply
numerical interchangeability with implementations using other coverage measures.

Use one fixed, documented and versioned complexity rule set based on ESLint's
classic calculation, not the benchmark's simplified rules or selectable variants.
Include optional-chain and default-value decisions, keep nested function counts
separate, and handle class initialisers and static blocks explicitly without
inflating the enclosing function.

Score explicit functions, including arrows, methods, constructors and accessors.
Report complexity separately for class-field initialisers and static blocks,
identifying them as outside first-release CRAP scoring. Their comparison operators
remain eligible for mutation testing.

For an in-scope function without reliable matching coverage, report coverage and
CRAP as unknown, mark the run incomplete, and return a non-zero exit status.
Retain successfully analysed results. Valid coverage counters showing no
executions mean 0% coverage; missing evidence does not.

For a function verified from source to contain no executable statements to
measure, report coverage and CRAP as not applicable and retain its complexity.
This case does not make the run incomplete. Do not apply the exception merely
because a report is empty or omits a non-empty function.

## Mutation verdicts

- Killed: following a passing baseline, the runner reports a test failure under
  the mutant, including an assertion failure or an error in the tested code.
- Survived: the selected tests complete successfully under the mutant.
- Timed out: execution exceeds its limit. Do not count this automatically as a
  kill.
- Execution error: building, starting or operating the test environment fails.
  Do not count this as a kill.

Unresolved timeouts and execution errors make the run incomplete. A generic
non-zero process exit is insufficient evidence of a kill.

For a complete run, report `killed / (killed + survived) * 100` alongside raw
counts. With no mutants, report not applicable rather than 100%. For an incomplete
run, report the counts and unresolved executions without a final mutation
percentage.

## Mutation execution

Use isolated source replacement as the default, with fresh test processes.
Retain mutation switching as an explicit experimental option: Rust prepares the
comparison alternatives in an isolated execution copy, and each execution
activates exactly one mutant before application code loads. The experiments
show a benefit in some build-heavy configurations, but no dependable advantage
in the selected real Jest/Expo workload. Keep checking identical outcomes and
measuring matched workloads before promoting switching. Do not select a strategy
automatically. Persistent test-worker reuse is deferred.

Run all configured tests for each mutant in the first release. Automatic per-test
selection is deferred; aggregate Istanbul coverage and static import relationships
are not sufficient evidence for selecting tests reliably.

Support an explicit mutant-worker limit, defaulting to one. Document how to enable
and benchmark parallel execution when tests isolate their external resources.
Avoid multiplying the Seshat worker count by unrestricted test-runner
parallelism. See `adr/0004-reuse-prepared-code-not-test-process-state.md`.

## Configuration

Use one declarative `seshat.json` file with explicit source patterns and runner
settings, validated with useful errors. Do not support executable JavaScript
configuration, configuration inheritance or a plugin registry in the first
release.

Support multiple named test setups in that file. Each identifies its runner,
working directory, test and coverage commands, and coverage-report location. A
single-package project can use one entry; a mixed-runner project can declare
several. Run all configured setups for each mutant.

Combine coverage only when the source and statement mappings agree. Combine
execution evidence for matching statements, not independently calculated
percentages. Conflicting reports make the result incomplete with an explanation;
do not guess a combined score. Verify exact configuration fields against working
runner integrations before publishing setup examples.

## Commands and CI

- `seshat check` runs both CRAP analysis and mutation testing.
- `seshat crap` runs CRAP analysis only.
- `seshat mutate` runs mutation testing only.

Mutation-only execution still requires original typechecks and passing test
baselines. It skips coverage collection and CRAP calculation, not any mutation
test setup.

All commands use the same configuration. Quality thresholds are opt-in:
projects may configure maximum CRAP and minimum mutation scores. With no quality
thresholds configured, a complete successful execution reports its results
without enforcing an arbitrary score threshold. Configuration errors, failed
baselines and incomplete runs always return non-zero independently of thresholds.

The candidate implements optional `thresholds.maxCrap` per measured function and
`thresholds.minMutationScore` for the complete mutation run. Equality passes,
using unrounded values. Exit 1 means unmet thresholds with complete evidence;
exit 2 means invalid input or incomplete execution, and handled SIGINT/SIGTERM
exit 130/143. Incomplete execution takes precedence over threshold failure.
Commands do not request the other assessment to evaluate its threshold. A
genuinely unscored assessment is not applicable, not an invented passing score.
See the README for exact fields, JSON states and CI invocation.

## Coverage collection

A `check` or `crap` run executes the configured coverage command and consumes its freshly
generated full Istanbul JSON report. Do not accept a leftover report as fresh
output. Where the runner integration verifies compatibility, reuse that successful
execution as the mutation baseline instead of running a duplicate baseline.

Importing old coverage reports is deferred until their relationship to the
relevant source and test setup can be established.

Reuse preparation and builds within a run where correctness is verified. Defer
persistent cross-run mutation-verdict caching until after the first release;
invalidation must account for tests, dependencies, configuration and other
relevant inputs, not just mutated source.

## Reproducibility

Identical source, configuration and coverage produce identical analysis and
mutant definitions within the same Seshat version and supported environment.
Identical test outcomes produce identical verdicts, with stable mutant identities
and report ordering. Timings are outside this guarantee.

Report detected test instability explicitly. Do not retry until a preferred
outcome appears, or imply that Seshat can make arbitrary tests deterministic.

## Runtime diagnostics to develop

Provide low-overhead runtime information so a human or consuming-project agent
can see what Seshat is doing, identify expensive phases and tune the project's
configuration using measurements. The CLI candidate now exposes phase-start
notices, event-driven completed/running/remaining mutation counts, resolved source
scope, phase/per-setup timings, job counts and mutation-worker measurements.
Final reports retain completed/not-run/unresolved counts. Runner
version/concurrency summaries, live unresolved breakdowns, throughput and bounded
slow-execution summaries are included. A small-fixture proof compares
progress-on/off runs. A [bounded three-sample matrix](../benchmarks/proofs/README.md#diagnostics-overhead-matrix)
across the three checked-in fixtures recorded fixture-specific
candidate-versus-baseline medians from −7.51% to +10.26%; broader
production-workload overhead measurement remains.

- Show the current phase, elapsed time, completed/total work where known, and
  running, queued and unresolved mutation counts. Label estimates as estimates.
- Report total wall time and separate capture/preparation, analysis, coverage,
  baseline/build and mutation-execution times, with per-test-setup breakdowns.
- Include the resolved source/test scope, actual resolved runner versions and
  discrepancies with declared/locked versions, effective Seshat and
  runner worker limits, test-process/build counts, mutation throughput, slow
  executions and timeout/error counts. Distinguish wall time from accumulated
  worker time; parallel task durations cannot simply be added into wall time.
- Expose the same useful measurements in the versioned final JSON report for
  agents and CI. Keep progress separate from machine-readable stdout, retain
  available diagnostics on incomplete runs, and avoid logging secrets or full
  environment variables. Missing measurements must not look like zero cost.
- Document a repeatable tuning procedure: establish a baseline, change one
  setting, repeat the same work, compare timings and verify unchanged outcomes.
  Explain worker-limit interactions and isolation of ports, files and databases.
  Do not recommend reducing tests/source scope, hiding failures or weakening
  coverage to improve timing. Do not change project configuration automatically.

Start with timings and counters already available during execution. Measure the
diagnostics' own overhead. Detailed CPU/memory profiling, dashboards and automatic
tuning are not implied by this note. Decide exact fields and progress frequency
when implementing reporting, using the consuming-project proofs as examples.

## README requirements

Before release, the README must provide verified installation, configuration and
execution instructions. Include source include/exclude examples for a
single-package project and npm workspaces, explain how to inspect the resolved
scope, and document every required runner or coverage setup step and optional CI
threshold. Include parallel-execution setup and its resource-isolation
requirements. Explain both scores with worked examples, their limitations, the
meaning of unknown and not-applicable results, and how execution failures differ
from unmet quality thresholds. Do not present proposed configuration syntax or
commands as implemented functionality.

## Release evidence

- Correctness: hand-checked scoring and mutation outcomes covering nested
  functions, TSX, initialisation code, missing coverage, timeouts and execution
  failures.
- Integration: working Node, Jest/Expo and Vitest examples and installation
  checks for every supported platform, without a Rust toolchain on the consuming
  machine.
- Performance: complete-command measurements including coverage collection and
  test execution, alongside analysis-only timings. Compare mutation switching
  with isolated source replacement and, where workloads can be matched, Stryker.
- Size: publish maintained code size, installed binary size and dependency counts
  alongside timings. Added optimisation complexity needs a measured benefit.
- Documentation: verify README configuration, execution, result interpretation
  and threshold examples against working installations.

Use self-contained Node, Jest/Expo and Vitest workloads, including TypeScript,
TSX and workspace layouts. Keep any external-project measurements anonymous and
report their scope. Do not claim fastest performance merely because Seshat beats
the original basic benchmark.
