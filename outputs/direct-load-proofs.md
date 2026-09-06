# Direct TypeScript loading: replacement or switching?

The later [coverage-route proof](coverage-routes.md) addresses coverage setup;
the measurements below concern mutation execution only.

Measured on 6 September 2026, Canberra time. Switching is not universally faster
once separate builds are removed. It helped this Jest configuration, slowed this
Vitest fixture, and produced mixed Node results. The four private Rust modules
still fit the implementation.

This follows the [explicit-build experiment](bounded-proofs.md).
[Reproduction instructions](../benchmarks/proofs/README.md#direct-typescript-loading-follow-up)
and [raw results](direct-load-proofs.json) accompany this report.

## Timings

Three sequential samples per runner and strategy. Each sample strictly checks
the original source, runs its baseline, then executes all 20 mutants in fresh
test processes. Switching also runs a prepared-code baseline. Both strategies
perform zero separate builds. Timings include native startup and cleanup, but
not coverage collection.

| Runner | Replacement median | Switching median | Interpretation |
| --- | ---: | ---: | --- |
| Node | 5.15 s | 4.79 s | Mixed; no consistent winner |
| Jest | 17.71 s | 12.76 s | Switching uses 28.0% less elapsed time |
| Vitest | 13.32 s | 14.68 s | Switching takes 10.3% longer |

Node's replacement samples range from 4.59 to 5.22 seconds; switching ranges from
4.76 to 5.40 seconds. Replacement wins two of the three matched sample pairs,
despite switching's lower aggregate median. Do not treat that median difference
as a demonstrated Node speedup.

Jest switching wins all three matched pairs. Replacement ranges from 17.23 to
20.04 seconds; switching ranges from 12.35 to 14.18 seconds. Vitest replacement
wins all three pairs, with ranges of 13.08 to 14.19 seconds for replacement and
14.04 to 17.99 seconds for switching. Three samples of a tiny fixture do not
establish production performance or statistical confidence.

## What changed

The source fixture, mutant definitions and expected outcomes are unchanged.
The driver replaces the explicit TypeScript-to-CommonJS build with each runner's
loading route:

- Node imports a `.ts` ESM copy through its built-in loader.
- Vitest imports the `.tsx` source through its normal loader.
- Jest transforms TypeScript on demand with the already-installed compiler.
  Its transform cache lives inside the disposable execution session. The
  transformer imports the compiler only on a cache miss.

Zero separate builds does not mean zero compilation or transformation. Those
costs are inside the runner timings. Each session begins without a seeded Jest
cache; unchanged switching source can reuse transformed code within that session.
Test runtimes and verdicts are never reused. Cache reuse is a plausible
explanation for Jest's result, not an independently isolated measurement of the
cache's contribution.

Runner order rotates and strategy order alternates between samples. OS caches
are not flushed. The earlier explicit-build timings did not include a strict
check inside each execution; these timings do. Do not subtract the old and new
totals and attribute the whole difference to direct loading.

## Correctness and type checks

All 18 complete executions match the fixed, ordered expected outcomes: 18 killed
and 2 surviving mutants. That is 360 checked mutant executions, each reporting
the same complete fixture mutation score of 90%. The source hashes match and
owned session directories are removed afterward.

Every execution strictly checks its captured original source before mutation.
The median check takes 754 ms. Mutants then run without a type-check. The original
fixture's type narrowing remains checked, but switching still removes narrowing
from the transformed source. This verifies a separate original-validation and
mutation-execution route; it does not fix transformed-source type compatibility.

Both strategies pass these controlled Node failure checks:

- An original-source TS2322 error stops execution before baselines or mutants.
- A setup failure is an execution error, not a kill.
- A timeout is unresolved, not a kill.

No failing case reports a final mutation percentage. In a consuming project,
validation and mutation commands must be separated deliberately. Seshat should
not silently remove type checks from a user's configured test command. The
experimental manifest fields here are not a committed release configuration.

## Cost and limits

The extension adds a 111-line experiment driver and 21 net Rust lines to the
existing executor. It reuses the analysis, scoring, mutation fixture, assertions
and Node reporter. It adds no dependencies, Rust crates or runner plugin system.

Rust unit tests and Clippy pass, as do formatting and script syntax checks. A
two-mutant regression verifies both earlier explicit-build strategies and their
build counts without replacing the earlier benchmark data.

Versions are Node 24.20.0, TypeScript 6.0.3, Jest 30.5.1 and Vitest 5.0.0 on
Linux x64, using the existing Rust 1.98.1/Oxc 0.148.0 proof. The fixture contains
no JSX or non-erasable TypeScript syntax. This does not verify Node TSX support,
tsconfig aliases, Expo/Babel transforms, multi-package builds, parallel workers
or cross-platform process supervision. sample-application and sample-stack were
not executed by this experiment. The earlier coverage gaps remain open.

## Recommendation

Keep the four private modules and make separate builds unnecessary when the
runner already loads the source. Preserve explicit original-source validation.
Do not make switching an unconditional performance requirement or add automatic
strategy tuning based on this fixture.

Keep isolated replacement as the simple reference path. Retain switching as an
experimental candidate where real runner configurations demonstrate a worthwhile
benefit, particularly cached transforms. Resolve coverage attribution next, then
validate the target projects before choosing the release execution strategy.
