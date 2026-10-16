# Inferred-any compiler evidence

Issue [#134](https://github.com/Binary-Balance/seshat/issues/134), step 3.

## Compiler contract

The existing bounded compiler helper parses the setup's original command and
configuration, then creates one program with the project's installed compiler.
No compiler is bundled, no output is emitted and no checker runs per mutant.
The original typecheck command still runs independently. Counts remain separate
per setup and assess only selected source. Test files participate only when
selected, and out-of-program source never becomes a measured zero.

The metric counts any-typed runtime expression sites, including uses flowing
from explicit annotations. It does not reconstruct the origin of an unsafe
value or duplicate TypeScript's `noImplicitAny` diagnostics. Exact fields and
counting rules are in the [report format](../report-format.md#type-safety-findings).
There is no combined score, type-safety threshold or cross-run checker cache.

TypeScript's [checker](https://github.com/microsoft/TypeScript/blob/v6.0.3/src/compiler/checker.ts)
uses `TypeFlags.Any` for real `any` and recovery types. Suppressed errors can
leave recovery types without diagnostics. The helper therefore collects
[pre-emit diagnostics](https://github.com/microsoft/TypeScript/blob/v6.0.3/src/compiler/program.ts)
and rejects any-flagged types whose internal intrinsic name is not `any`.
Some ordinary untyped JavaScript imports also use recovery types, so their
findings remain unknown. `noCheck` likewise produces unknown findings.

Expression classification, intrinsic names and alias-emission decisions use
internal compiler APIs. The supported range is deliberately `>=5.0 <7.0`, with
representative compiler checks below. The [compiler API guide](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
warns that TypeScript 7.1 changes the API. The
[expression-context rules](https://github.com/microsoft/TypeScript/blob/v6.0.3/src/compiler/utilities.ts)
need explicit handling for shorthand reads, property-name tokens, runtime class
bases and JSX. Ambient declarations are skipped. Internal namespace import
aliases follow the compiler's own [alias emission rules](https://github.com/microsoft/TypeScript/blob/v5.0.4/src/compiler/transformers/ts.ts),
including elision of type-only or unused module aliases and the older
`preserveValueImports` option. The helper preserves
BOM bytes when converting the compiler's UTF-16 positions to original UTF-8
byte offsets.

## Compatibility checks

Run the same proof against each installed compiler:

```sh
node benchmarks/proofs/compiler-strictness.mjs /path/to/typescript/bin/tsc
```

Verified on 2026-10-16 with Node 24.22.0 on Linux x64:

| TypeScript | Passing cases |
| --- | ---: |
| 5.0.4 | 33 |
| 5.9.3 | 34 |
| 6.0.3 | 35 |

Cases include configuration inheritance and overrides, direct arguments,
response files, real any values, declarations and assertions, nested functions,
JavaScript, JSX, shorthand reads, class bases, BOM/astral Unicode/CRLF locations,
compiler errors, suppressed recovery types, `noCheck`, unsupported versions,
excluded sources, ambient classes, emitted/elided namespace aliases and project
references with present or missing declaration outputs. Rust checks separately
prove smallest-scope attribution, distinct setup counts, unknown values and
rejection of malformed UTF-8 boundaries. The CLI
proof checks positive findings through `check`, `crap`, `mutate` and text output.
The local run passed 132 Rust tests, 69 CLI scenarios plus legacy parity, the
12-scenario combined check and the parallel execution/cancellation suite.

## Synthetic cost probe

```sh
node benchmarks/proofs/inferred-any-performance.mjs
```

The probe compares metadata-only helpers with the same helper collecting inferred
any. Each condition uses a fresh process, one warmup and three measured samples;
condition order alternates. Fixtures have 10 or 500 TypeScript files with 20
functions per file. Each function contributes three any expression sites, and
the probe asserts those counts before retaining a sample. Both fixtures use
`strict`, `noEmit` and `skipLibCheck`. The helper's SHA-256, environment and raw
samples are retained in the cost report.

Recorded on 2026-10-16 with TypeScript 6.0.3, Node 24.22.0, Linux x64 and an
AMD EPYC 7763 CPU. Medians from the
[raw samples](../../outputs/inferred-any-cost.json):

| Source files | Functions | Mode | Wall time, ms | Peak RSS, MiB |
| ---: | ---: | --- | ---: | ---: |
| 10 | 200 | Metadata only | 229.1 | 97.5 |
| 10 | 200 | Inferred any | 1,098.2 | 221.8 |
| 500 | 10,000 | Metadata only | 243.7 | 100.6 |
| 500 | 10,000 | Inferred any | 2,389.2 | 373.0 |

The larger fixture adds about 2.15 seconds and 272 MiB over metadata alone in
this sample. This is a once-per-setup cost; there are no additional mutant jobs.

Wall time covers child startup through process exit. RSS is that process's
peak resident memory. The checker submeasurement includes program construction,
diagnostics and expression traversal; it overlaps helper wall time. These are
synthetic compiler costs, not full assessment timings or production bounds.
They exclude Rust attribution, original typechecks, capture and mutation work.
Projects with more declarations, different options or several setups can cost
more. Helper work uses the existing setup deadline; expiry produces unknown
findings. No arbitrary runtime cap or automatic type-safety threshold is added.
