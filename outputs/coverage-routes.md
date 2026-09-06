# Coverage routes verified on the bounded fixture

Measured on 6 September 2026. Node statement instrumentation, Jest/Babel and
Vitest/Istanbul now pass hand-checked per-function coverage and CRAP assertions.
Vitest/V8 remains unsupported for one same-line arrow mapping. The fix adds no
Rust dependencies or custom source-map converter.

[Reproduce the proof](../benchmarks/proofs/README.md#coverage-route-follow-up),
inspect the [raw evidence](coverage-routes.json), or follow the root
[README setup guidance](../README.md#coverage-setup-verified-by-the-proof).

## Results

| Route | Loaded source | Completely unloaded source |
| --- | --- | --- |
| Node with Istanbul statement instrumentation | Pass | Pass, actual zero counters |
| Jest with Babel coverage | Pass | Pass, actual zero counters |
| Vitest with Istanbul coverage | Pass | Pass, actual zero counters |
| Vitest with V8 coverage | Incomplete, ambiguous arrow range | Pass |

All three accepted routes agree on the hand-checked functions:

| Function | Complexity | Covered statements | CRAP |
| --- | ---: | ---: | ---: |
| `covered` | 2 | 3/3 | 2 |
| `partial` | 2 | 2/3 | 2.148148 |
| `never` | 1 | 0/1 | 2 |
| `defaults` | 4 | 1/1 | 4 |
| `outer` | 2 | 3/3 | 2 |
| Nested `inner` | 2 | 2/3 | 2.148148 |
| `unicode` | 2 | 3/4 | 2.0625 |
| Unloaded `untouched` | 1 | 0/1 | 2 |

The empty function remains not applicable. All three concise arrows receive
one executed statement each, including two on the same line and the JSX arrow.
Class-field initialisation and the static block each retain complexity 2 without
a CRAP score. The Unicode case places an emoji before later statements on the
same line, exercising actual report columns as well as Rust's coordinate tests.

## What fixed the gaps

For Node, the proof instruments TypeScript-compiled CommonJS using
`istanbul-lib-instrument`, passing the compiler's original-source map. It starts
with zero-counter records from files it actually instrumented, collects the
loaded module's runtime counters, then uses `istanbul-lib-coverage` and
`istanbul-lib-source-maps` to merge and remap them. An unloaded file consequently
has measured zeros. Rust never invents counters for a missing report.

Changing Vitest providers alone was insufficient. Both providers emitted
open-ended source locations. The installed Istanbul mapping implementation,
`istanbul-lib-source-maps`'s `originalEndPositionFor`, uses `Infinity` for the end
of a mapping that extends to the end of its source line. JSON serializes this
as `null`. The importer now accepts an explicit null end column as that line-end
bound. A missing column or null start column is still invalid.

A remapped range may also include an arrow or field's trailing semicolon, which
lies outside the expression's AST range. The importer permits only semicolons,
spaces and tabs between the scope end and report end on that same line. It does
not trim over another declaration, expression, comment or newline. This is
coordinate normalization against captured source, not source-map conversion.

With those rules, Vitest/Istanbul passes. Vitest/V8 maps the first same-line
arrow's statement to byte range `639..653`, although that arrow ends at byte 644.
The excess includes the following `export` keyword, so its report remains
incomplete. This is a limitation of this report/importer combination, not a claim
that Vitest's own displayed coverage is wrong.

## Validation and merging

The script asserts counts and scores, rather than merely comparing providers.
It also rejects null starts, absent end columns, out-of-range lines, negative
counters, missing source files and an open end that crosses another function.
Four Rust unit tests pass, including UTF-16/UTF-8 conversion and explicit-null
versus missing-column handling with CRLF. Clippy passes with warnings denied.

Repeated identical reports do not double-count statements. Node and Jest's
maps merge on this fixture. Node and Vitest/Istanbul maps differ, so combining
them is rejected despite their matching per-function counts. Compatible maps,
not matching percentages or a common JSON format, remain the merge requirement.

The previous c8 route is still rejected because its line-based records do not
provide the agreed statement measurement. No fallback to line coverage or
function-invocation coverage was added.

## Scope and cost

The importer grows by 31 net Rust lines including a new test. The 140-line
experiment script reuses existing fixtures and Istanbul libraries. The matching
Vitest/Istanbul provider is added to proof-only development dependencies, and
three already-installed Istanbul libraries are declared as direct dependencies.
No Rust crate, module or runtime dependency is added.

Tested versions are Node 24.20.0, TypeScript 6.0.3, Jest 30.5.1, Vitest and both
coverage providers 5.0.0, `istanbul-lib-instrument` 6.0.3,
`istanbul-lib-coverage` 3.2.2 and `istanbul-lib-source-maps` 5.0.6. The Rust proof
uses Rust 1.98.1 and Oxc 0.148.0. Recorded collection times are diagnostic samples,
not a performance comparison; preparation costs and provider work differ.

This remains a bounded proof. The Node collector handles one test file/process,
not arbitrary child workers. General path normalization, workspace packages,
Expo transforms, source/report provenance and comprehensive syntax coverage
still need integration work. The importer does not prove that a plausible report
contains every counter its provider should have emitted. Conservative rejection
of other source-map ambiguities remains intentional.

## Next step

Use Node statement instrumentation and Vitest/Istanbul as the candidates for
target-project integration, alongside Jest/Babel. Keep the V8 case as a failing
compatibility fixture. Validate real project setup and report mappings before
building out the release CLI or claiming general runner support. This retains
the existing four-module architecture and keeps conversion outside Rust.
