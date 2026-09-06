# Seshat bounded proof results

Local absolute paths in the recorded JSON are normalised to `/workspace/seshat`.
Measurements and verdicts are preserved; those paths are illustrative.

The later [coverage-route proof](coverage-routes.md) provides verified alternatives
for the coverage gaps recorded below. These results describe the earlier run.

Measured on 5 September 2026. The four-module structure remains a reasonable
starting point. Mutation switching matches isolated replacement on the fixture
and saves rebuild time. Coverage integration and strict TypeScript builds are
not yet ready for the release implementation.

These are executable experiments, not production Seshat commands.
[Reproduction instructions](../benchmarks/proofs/README.md) and
[raw evidence](bounded-proofs.json) accompany this report. The original Rust
feasibility benchmark and its results are unchanged.

## Mutation execution

Three sequential samples per runner and strategy, with strategy order alternating
between samples. Each execution includes native startup, preparation, builds,
baselines and 20 fresh mutant test processes. One worker; no persistent test
processes or cached verdicts. OS caches were not flushed.

| Runner | Replacement median | Switching median | Less elapsed time |
| --- | ---: | ---: | ---: |
| Node | 10.38 s | 3.57 s | 65.6% |
| Jest | 22.44 s | 14.05 s | 37.4% |
| Vitest | 21.56 s | 14.81 s | 31.3% |

Every one of the 18 executions produced the same ordered outcomes: 18 killed,
2 survived, or a complete fixture mutation score of 90%. That is 360 mutant
executions checked against fixed expected results, not just matching totals.

Both survivors have a missing equality-boundary case. Mutant 12 changes
`missedBoundary(20)` from `>= 18` to `> 18`. Mutant 17 changes `<=` to `<` where
the tested operands differ. The checks also exercise all comparison operators,
nested comparisons, import-time initialisation, side-effect counts and NaN.
They do not establish transformation equivalence for all JavaScript programs.

Replacement performs 21 builds per sample. Switching performs two, including a
prepared-code baseline with no active mutant. The median sum of the 20 test
process times was about 2.5 seconds for Node and 12 to 13 seconds for Jest/Vitest
under both strategies. Avoided builds account for much of the elapsed saving.

This comparison uses an explicit TypeScript-to-CommonJS build for both strategies.
It does not compare against optimized replacement using native TypeScript
loading or a runner's existing transform cache. Switching is worth pursuing,
but these percentages must not be projected onto other applications. They do not prove that Rust makes the JavaScript tests run faster.

## Coverage attribution

All three coverage test runs pass and produce original-source-mapped Istanbul
JSON. Their statement records are not interchangeable.

| Coverage route | Proof outcome | Reason |
| --- | --- | --- |
| Jest, Babel instrumentation | Complete | Hand-checked function statement counts and CRAP agree |
| Node, c8 | Unknown/incomplete | Line-based records fail executable-statement attribution checks |
| Vitest, V8 provider | Unknown/incomplete | Open-ended source-map columns serialize as `null`; importer requires finite positions |

Jest gives `covered` 3/3 statements and CRAP 2. The partially exercised function
and nested `inner` each receive 2/3 statements and CRAP 2.148148. The uncalled
`never` receives 0/1 and CRAP 2. The empty function is not applicable. Class
initialisers and static blocks retain separate complexity-only results.
Same-line arrows each receive one measured statement, without counting export
initialisation as execution inside the arrow.

Jest collection took 1,376 ms; native report reading, attribution and scoring
took 8.2 ms in a fresh process. These are single diagnostic samples on a tiny
fixture, not a throughput benchmark or a complete `seshat check` measurement.

Vitest's rejected locations are not evidence that its coverage is inherently
wrong. The installed `ast-v8-to-istanbul` implementation deliberately uses
`Infinity` for some remapped ends, which JSON serializes as `null`. The Rust
importer does not yet interpret that convention safely. No guessed positions or
substitute coverage percentages were used.

Compatible copies of the Jest report merge without double counting. Missing
reports, out-of-range columns, a bad report alongside a valid report, and
cross-provider incompatible mappings produce incomplete results. UTF-16 to
UTF-8 coordinate conversion has a separate runnable Unicode check.

## Type-checking and failure evidence

The original mutation fixture passes strict TypeScript checking. The switched
fixture fails with TS18048, because replacing `value !== undefined` with a helper
call removes TypeScript's narrowing before `value.length`.

Runtime parity therefore applies to transpile-only mutation builds. A passing
no-mutant runtime baseline does not establish compatibility with a consumer's
strict build command. This needs an explicit preparation policy before release.

A controlled Node setup failure produces an execution error, not a kill. A
controlled timeout produces a timed-out result, not a kill. Both have no final
mutation percentage. The test caught Node reporting a crashed test file as
`testCodeFailure`; the proof reporter now also checks its process-exit evidence.
Production adapters still need mixed hook/test failure and malformed-report
cases beyond these single-test fixtures.

Source hashes remain unchanged and owned session directories are removed after
completion, including the controlled failures. This checks normal Linux cleanup,
not cancellation, abrupt termination of Seshat, or cross-platform supervision.

## Size and verification

At this measurement, the formatted proof contained 815 Rust lines across four modules and its entry
point, 213 JavaScript tooling/check lines, and 54 TypeScript fixture lines.
Counts include comments and blank lines. This is proof code size, not a release
size budget or a claim of the smallest possible implementation. Later proof
extensions change these counts.

The Linux x64 release executable is 1,809,888 bytes, about 1.73 MiB. The proof
adds no Rust dependency beyond the original benchmark's six direct dependencies.
Its lockfile resolves 58 dependency packages. Node runner tooling is isolated in
the proof's private npm package; it is not a proposed Seshat runtime bundle.

Recorded versions: Node 24.20.0, TypeScript 6.0.3, Rust 1.98.1, Oxc 0.148.0,
c8 12.0.0, Jest 30.5.1, Vitest and its V8 coverage provider 5.0.0. Tests ran on
Linux x64. Three Rust unit tests pass, the full proof script passes, Rust
formatting passes, and Clippy passes with warnings denied.

## Recommendation

Keep analysis, coverage, execution and assessment as private modules in one
crate. Keep the npm launcher thin. Nothing in this experiment justifies another
crate, a public runner plugin interface or a task-graph framework.

Before building the release CLI, verify a statement-instrumentation route for
Node and safe attribution of Vitest's open-ended locations. This revisits the
suggested c8 route in ADR-0003 without moving raw V8 conversion into Rust.

The [direct-loading follow-up](direct-load-proofs.md) compares switching against
direct TypeScript-loading replacement, with an
explicit baseline type-check step and a verified mutation preparation route.
That tests whether switching still earns its extra transformation code
after avoiding unnecessary rebuilds. Real project and workspace integrations
remain required; this proof uses synthetic inputs only.
