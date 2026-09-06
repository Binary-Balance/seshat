# Provisional module architecture

Status: provisionally accepted and exercised by bounded proofs, not a release interface.
The [release scope](release-scope.md) and existing ADRs remain authoritative.

## Recommendation

Use one Rust crate with four private modules: analysis, coverage, execution and
assessment. Keep command/configuration handling and output formatting at the
entry point until they become substantial enough to separate. These are ownership
decisions, not a request to create empty files or independently published crates.

The npm launcher only locates and invokes the matching executable, forwarding
arguments and exit status. It does not parse source, calculate scores, schedule
mutants or install missing runner dependencies at execution time.

```text
npm launcher or direct native command
                 |
            command entry
                 |
       execution captures source
                 |
       analysis inspects source
                 |
       execution runs the assessment
          |                    |
   coverage attribution    runner adapters
          |                Node / Jest / Vitest
          +----------+---------+
                     |
            assessment applies policy
                     |
             terminal / JSON output
```

The diagram shows the run sequence, not separate processes for the Rust modules.
Only runner execution crosses into JavaScript. No syntax tree crosses that seam.

## Module ownership

### Analysis

Own source parsing, function and implicit-scope identification, complexity rules,
comparison locations, mutant definitions and source-dependent preparation of
mutation alternatives. Keep Oxc types and allocation lifetimes private.

Return owned, compact facts tied to the captured source: file identities,
function ranges and ownership, complexity, comparison identities and prepared
edits. Explicitly distinguish a callable's complete range from its body so that
default-parameter expressions are not lost. Record the relationships needed to
keep nested functions and class initialisers separate.

Share parsing and traversal between complexity and comparison analysis. Do not
retain an entire syntax tree throughout a long test run. The experiments should
establish whether preparing switching text in the same pass or a later bounded
pass is the better trade-off; do not promise one parse at the expense of much more
retained data or complicated lifetimes.

Source preparation must preserve evaluation order and evaluation count, including
side effects, nested comparisons, comments, TSX and JavaScript value semantics.
Execution must not implement a second text scanner or operator-replacement table.

### Coverage

Own decoding full Istanbul reports, mapping report paths and positions to the
captured original source, validating statement mappings, combining compatible
execution evidence, and attributing statements to explicit functions.

Return measured statement counts, unknown evidence with reasons, or verified
not-applicable cases. Do not turn absent records into zero counters, average
coverage percentages across setups, or infer statement coverage from invocation
counts.

Keep report-coordinate conversion here, using source-location information from
analysis. Rust source offsets and JavaScript report columns must not be treated
as interchangeable. Test Unicode, same-line functions, nested functions, parameter
expressions and generated helpers at this interface.

Coverage describes original source. Collect it before mutation preparation alters
the execution copy, or use another verified equivalent original-source route.
Do not feed the extra switching branches into CRAP. Normalising an execution-copy
path back to the original project path is not the same as remapping changed code.

This module receives bytes and source facts; it does not start test runners or
write coverage files. Raw V8 conversion and source-map generation stay with the
existing coverage tools, as agreed in ADR-0003.

### Execution

Own the complete local execution lifecycle: capturing inputs, temporary project
layout, prepared builds, fresh coverage destinations, baseline gates, runner
invocations, bounded concurrency, deadlines, cancellation and cleanup.

Use an opaque session as its main interface. It holds the immutable source
snapshot and private run state. Callers cannot activate a mutant manually, skip a
required baseline, reuse an old report, or run against unrelated source bytes.
Runner selection is a closed choice among the supported integrations, not a
public plugin mechanism.

Execution calls the pure coverage module after collection so that unusable
coverage can be identified before expensive mutation work. It returns available
evidence and explicitly unfinished work if it stops. The assessment module still
owns scores and the final completeness/threshold policy.

Never let mutable execution source alias the developer's files through hard links
or symlinks. Workspace packages, build outputs and dependency resolution need
real integration fixtures; a directory copy alone does not prove isolation.
Sharing third-party dependencies is acceptable only where their use cannot write
through into developer source. Tests' external resources remain outside this
source-protection promise.

### Assessment

Own CRAP arithmetic, mutation verdict aggregation, final completeness, threshold
evaluation and the stable report data. This is pure computation over analysis,
coverage and execution evidence. It knows neither shell commands nor runner
output formats.

Use explicit states for measured, unknown and not-applicable scores. Keep baseline
failures, timeouts, execution errors and unfinished work visible. All required
setup results must be accounted for; one setup detecting a mutant does not erase
another setup's execution error or permit skipping it.

Apply quality policy once. Terminal rendering and JSON serialization consume the
same assessed results, rather than independently calculating percentages or
deciding whether the command succeeded.

## Execution interface alternatives

These signatures and examples are illustrative design notation, not new code.

### A. Opaque execution session

```rust
Session::capture(project) -> Result<(Session, SourceSnapshot), CaptureError>
Session::execute(self, analysis, request, cancellation) -> ExecutionEvidence
```

```rust
let (session, sources) = Session::capture(&project)?;
let analysis = analysis::inspect(&sources, mode)?;
let evidence = session.execute(&analysis, mode, &cancellation);
let result = assessment::evaluate(&analysis, evidence, &policy);
```

The session hides temporary paths, ordering, runner differences, worker allocation
and process cleanup. It rejects analysis or mutants tied to another snapshot.
Consuming the session prevents accidental reuse of prepared test state across
runs.

Return typed runner/process evidence and attributed coverage, not a single
success boolean. Keep final mutation verdicts in assessment. Once a run begins,
failures must preserve available results rather than discard them behind an
early generic error.

This provides the most depth for Seshat's single CLI caller. The cost is that the
execution module has substantial internal responsibilities. Use ordinary private
functions, and private files if needed, rather than exposing lifecycle steps just
to make the file look smaller.

### B. Immutable execution plan

```rust
plan(project, analysis, request) -> Result<ExecutionPlan, PlanError>
execute(plan, cancellation) -> ExecutionEvidence
```

```rust
let plan = execution::plan(&project, &analysis, mode)?;
let evidence = execution::execute(&plan, &cancellation);
let result = assessment::evaluate(&analysis, evidence, &policy);
```

A private immutable plan describes the fixed preparation/baseline/mutation
sequence and expected setup results. The executor hides filesystem/process work.
The caller can inspect what should run and compare it with the evidence returned.

This is useful for reproducible planning tests, but adds a second representation
of the run and spreads sequencing knowledge between planning, execution and
assessment. It must not become a generic task graph, persisted job format or
resume system. Any useful plan records can remain private inside alternative A.

### C. One-shot runner jobs

```rust
run_job(setup, request, deadline) -> JobEvidence
```

```rust
for setup in &project.setups {
    evidence.push(execution::run_job(setup, &request, deadline));
}
```

Each call starts a fresh runner integration for one setup and one phase. A small
request identifies the phase, prepared location, active mutant if any, and an
owned result destination. The result contains normalized test evidence alongside
native process observations.

This hides runner differences and naturally matches fresh-process execution.
Used as the outer interface, however, it makes the caller own setup loops,
baseline gates, workspaces, cancellation and freshness. That increases the ways
to misuse it despite the short signature.

Use this shape privately inside A for the real Node, Jest/Expo and Vitest adapters.
There is no need to expose it to consuming projects or make it an extension
protocol for third-party plugins.

### Comparison and synthesis

A best matches the current caller: the command entry requests an assessment and
does not learn execution mechanics. B makes sequencing more inspectable but
exposes concepts that the single caller does not otherwise need. C is appropriate
for the runner seam, not for coordinating the whole run.

Recommend A externally, using C privately where runner behaviour really varies.
Keep any B-style accounting as ordinary internal data. None of these shapes
requires transferring syntax trees into JavaScript, persistent workers or extra
Rust crates. The recommendation is about depth, locality and correct use; it does
not establish a performance advantage before measurement.

## Evidence and lifecycle rules

1. Capture the configured inputs and analyse the same selected source bytes used
   by the execution copy. Preserve original project-relative file identities.
2. Collect fresh original-source coverage and validate it. Honour the agreed
   coverage requirements for the command; do not silently skip collection as an
   architectural optimisation.
3. Establish a passing baseline for every setup and for the representation used
   in mutation execution. An original-code coverage pass is not automatically an
   instrumented-code baseline. Run with no active mutant where equivalence has
   not been verified. Passing baseline checks alone do not prove transformation
   equivalence; comparison fixtures remain required.
4. Activate one mutant before imports and run all configured setups in fresh
   processes. Keep preparation reusable but writable worker outputs separate.
5. Return completed results and identify every unresolved or unstarted execution.
   Stable setup/mutant ordering must not depend on completion order.

Runner adapters normalize supported runner reports. They do not calculate CRAP,
mutation scores or killed/survived verdicts. Do not identify a kill by searching
stdout for `ERR_ASSERTION` or by observing exit code 1, as the fixed benchmark did.
Separate machine evidence from ordinary test logs, validate that it belongs to
the expected execution, and reject incomplete or contradictory evidence. An
internal versioned result record is sufficient; no general messaging system is
needed. Process observations remain authoritative for timeout and cancellation.

Return owned coverage/evidence needed for assessment, or deliberately retained
artifacts with a defined lifetime. Never return paths into a temporary directory
that has already been deleted. Bound diagnostic capture; do not silently truncate
machine evidence and then treat it as complete.

Cancellation stops scheduling, terminates and reaps owned child processes, and
records unfinished work. Surface cleanup failures without erasing earlier
results. Best-effort cleanup after forced termination is not a guarantee; no
execution path may rely on restoring the developer's source afterward.

## Verification at the interfaces

Analysis, coverage and assessment are in-process computation. Exercise their
interfaces with hand-checked inputs and expected outputs, not mocks of their
internal helper calls. Keep Oxc and Istanbul representation details inside their
own modules.

Filesystem and process behaviour use real temporary projects and short child
programs for isolation, stale-report, timeout and cancellation tests. Do not add
generic filesystem or process adapter traits only for mocking.

Node, Jest/Expo and Vitest are actual external dependencies. Test their concrete
adapters against supported versions, including test failures, setup failures,
empty or malformed output, initialisation mutants and configuration changes.
Separately prove that switched execution preserves the reference outcomes.

Keep the existing feasibility benchmark intact as evidence, not the production
interface. Its fixed coverage, simplified scopes and fixture-specific runner
checks must not become production defaults.

## What happens next

The [bounded proofs](../outputs/bounded-proofs.md) exercise real coverage
attribution and switched-versus-replaced execution. They support retaining this
ownership split, but do not implement every contract above. In particular, the
proof uses JSON records and shared Oxc spans internally. Mutation assessment now
consumes typed test states and owns verdicts, completeness and percentages;
execution normalizes runner evidence and serializes the assessed result. Policy
tests account for multiple setups and unfinished mutants. The earlier `execute`
fixture uses one setup; the combined `check` proof below exercises multiple Node
setups. Typed coverage results, overall run
policy and the general execution lifecycle remain release work.

The [direct-loading follow-up](../outputs/direct-load-proofs.md) verifies strict
original-source checking followed by mutation execution without separate builds
on the fixture. It does not restore narrowing in transformed TypeScript.
Switching helps the tested Jest configuration but is not a universal speedup;
retain replacement as the reference and verify strategy choices on target projects.

The [coverage follow-up](../outputs/coverage-routes.md) verifies bounded Node
instrumentation and Vitest/Istanbul routes alongside Jest. The V8 route and
cross-provider map compatibility remain constrained. Verify these routes and
consuming-project preparation on actual integrations before growing the release
CLI. These are problems within the existing modules, not reasons to add a plugin
system.
The [integration follow-up](../outputs/integration-proofs.md) adds a real sample
domain workspace and a synthetic React/Fastify/Vitest package. It exercises
multi-file Node coverage and suite failures, but the orchestration remains a
bounded proof script. A private capture implementation now validates experimental
configuration, resolves source scope, copies explicit inputs and rewrites internal
workspace links. Its capture-only command inspects immutable source bytes and
removes the copy. The experimental `collect` command now connects that copy to
sequential Node baselines, fresh Istanbul collection and CRAP attribution across
setups. Execution owns private receipts, bounded output, deadlines, source checks
and cleanup; coverage consumes borrowed reports without per-source JSON copies.
The combined `check` proof now adds explicit original typechecks per setup and
replacement mutation execution across every setup. Original bytes stay immutable;
execution tracks one intended edit, checks/restores it and retains unfinished rows
on failure. Typed runner states feed the existing pure mutation assessment. This
path remains sequential and direct-loading/transpile-only; switching,
general build handling and the release interface remain unfinished.
The real sample combined check now completes for four domain TypeScript files:
58 killed and 16 surviving mutants out of 74, with unchanged CRAP measurements.
Node's parent reporter drops exceptions from failed test-file imports. A private
execution observer therefore correlates the actual entry-import exception with
its uncaught error and an eligible throw location in the active source. Analysis
supplies parser-derived locations; pure mutation assessment remains unchanged.
This bounded Node 24.20.0 route does not classify generic process crashes as kills.
Unsupported import failures still leave the assessment incomplete.
The [Jest/Expo follow-up](../outputs/expo-integration.md) established three real
mobile test files, Babel coverage and separate hook/timeout evidence. That locked
Jest 29.7.0 / jest-expo 57.0.5 route now also uses native capture and combined
assessment: 13 passing original tests, five unchanged function scores and 6 killed
/ 1 surviving mutant across the same three source files. Its private environment
observer and reporter supply per-file evidence to execution; capture, supervision,
coverage attribution and assessment are reused. Generic Jest environments,
broader runner/version support and cross-platform supervision remain release work.
Vitest 5.0.0 now also uses native capture/check on the representative sample-stack
fixture, with three passing tests, four unchanged function scores and four killed
mutants across the same three source files. A small subclass invokes Vitest's
existing test callback and records evidence before cleanup; its private reporter
checks the final errors against that evidence. Hook/cleanup failures, timeouts and
unhandled errors remain unresolved. This reuses supervision, coverage attribution
and assessment without adding dependencies or a new module boundary. Browser
mode, alternative pools and custom runners remain unverified.

The Linux captured-project lifecycle proof now exercises SIGINT/SIGTERM during
typechecking, baseline, coverage and mutation jobs. An atomic signal flag feeds
the existing executor; group shutdown and direct-child reaping occur outside the
handler. Cancellation retains earlier results, prevents further job scheduling,
marks interrupted work cancelled and withholds the mutation score. Timeout,
overflow and leader-exit controls also check descendant cleanup and isolation
from an unrelated process. The explicit SIGKILL control demonstrates leftover
processes and temporary copies: uncatchable termination has no cleanup guarantee.
Detached descendants and worst-case capture latency remain unverified.

The captured-project executor now has opt-in bounded mutation workers, defaulting
to one. Scoped Rust threads share immutable analysis facts and claim the next
planned mutant; writable project copies and receipts remain separate. Each extra
copy passes fresh setup baselines before mutation scheduling starts. Reusing the
existing copy validator and job supervisor keeps these details inside execution.
Results are assembled by planned ID after joining workers, so completion order
does not change the report order. Unresolved work stops new scheduling; signal
cancellation reaches all active workers. Copy/baseline overhead and mutation wall
time are reported separately. Two-worker Vitest and Jest/Expo fixture checks now
retain the serial CRAP records and ordered mutant verdicts, including unresolved
runner failures. They reuse the same adapters without runtime or dependency
changes. Whole-project performance and broader concurrency/runner combinations
remain bounded by the evidence described in the proof README.

The precise runner evidence fields, supported version ranges and process-tree
handling must be established by those proofs. No unverified runner-specific
behaviour is promised by these sketches.
