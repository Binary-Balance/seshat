# Is Rust worthwhile for Seshat?

**Yes, for the native analysis core. This experiment does not establish a
comparable speedup in mutation-test execution.**

Measured on 5 September 2026, on a Linux x64 VM reporting an AMD EPYC 7763 CPU
and two available CPUs. All engines ran sequentially. Node was v24.20.0,
TypeScript 6.0.3, and Oxc 0.148.0 in both the Node binding and Rust. Rust was
1.98.1 with a release build and thin LTO. The TypeScript implementation was
compiled to JavaScript before timing.

## Results

These are medians. Fresh-process timings include startup, imports, source reads,
analysis and compact summary output. Warm timings exclude startup and source
reads, but include parsing and analysis.

| Workload | TypeScript compiler API | Rust parser + Node traversal | Native Rust + Oxc |
|---|---:|---:|---:|
| sample analysis, fresh process | 608.8 ms | 167.7 ms | **8.8 ms** |
| sample analysis, warm | 56.3 ms | 63.3 ms | **3.3 ms** |
| 20x analysis, fresh process | 1,642.0 ms | 1,307.4 ms | **72.6 ms** |
| 20x analysis, warm | 611.3 ms | 1,159.4 ms | **64.8 ms** |
| Peak analyser RSS, single-corpus fresh run | 130.6 MiB | 82.7 MiB | **3.7 MiB** |
| Baseline + ten synthetic mutant executions, fresh process | 2,325.0 ms | 2,004.5 ms | **1,866.0 ms** |

Native Rust was about **17.1x faster for warmed analysis** of sample and
**9.4x faster on the repeated workload**. Fresh CLI invocations showed an even
larger difference, about 69x, because importing the TypeScript compiler is part
of startup. The absolute single-project saving was about 600 ms fresh or 53 ms
warm. A long-lived integration would benefit from the warm figures, not the
fresh-start ratio.

The 20x workload repeatedly parses the same 51 loaded files. It is a throughput
stress test, not a second application or a genuine 1,020-file corpus. More
repetitions also provide more JIT optimisation opportunities, so its per-pass
timings should not be assumed to scale linearly from the single-corpus test.

## What was checked

The sample corpus contains **51 production TS/TSX files, 332,495 bytes,
493 function bodies and 767 comparison sites**. Source was copied from a clean
sample checkout at commit `e5edade6033a65af7764960122bd6c6ea411fe79`.

Corpus content fingerprint, using the sorted file contents joined by a newline:

`b5d5e93ea355a52b392d198eeac26a21976a01f2b0cb364b91ebdc1df275f5d5`

All three implementations agreed exactly on every function's byte range,
complexity, synthetic CRAP result, comparison operator and operator offset.
An additional hand-checked fixture covers Unicode offsets, comments containing
operators, TSX, nested functions, methods, constructors, accessors, loops and
type-only syntax. Matching output proves agreement on this corpus, not complete
language conformance or production correctness.

The CRAP arithmetic used **fixed synthetic 50% coverage**. Actual coverage
ingestion, source-map remapping and attribution to functions were not implemented.
These numbers must not be interpreted as sample's actual CRAP scores.

sample-stack had no TypeScript source in its inspected checkout, so no sample-stack performance result is claimed.

## Why the hybrid did not win

The Node/Oxc variant parses in Rust but materialises a JavaScript AST and then
visits it in Node. Native Oxc retains its arena-allocated AST in Rust. The
hybrid's warmed analysis was slower than the TypeScript compiler implementation
on both workloads in this experiment.

Separately measured warmed parsing/AST materialisation for the single corpus
was 43.7 ms with TypeScript, 42.1 ms with Node/Oxc and 2.5 ms with native Oxc.
This supports keeping traversal in Rust if choosing Oxc for performance. It does
not establish the exact cost of each boundary: allocation, serialisation,
conversion and traversal were not individually profiled.

This does not rule out a Node front end calling a small native analysis function
that returns compact results. That design is different from transferring the
entire AST and was not benchmarked.

## Mutation testing

Every engine established a passing baseline, generated the same ten comparison
mutants, wrote isolated source copies and ran the same Node tests. All five runs
per engine produced **eight assertion-detected kills and two intentional
survivors**.

Native Rust reduced total time by about **20%**, or 459 ms, versus the TypeScript
implementation. Much of that difference is preparation and startup. The measured
ten-mutant execution phase after the baseline was:

| Engine | Median | Observed minimum–maximum |
|---|---:|---:|
| TypeScript compiler API | 1,792.7 ms | 1,771.0–3,545.7 ms |
| Node/Oxc | 1,776.3 ms | 1,695.7–1,917.6 ms |
| Native Rust | 1,701.6 ms | 1,669.7–1,856.3 ms |

The ranges overlap substantially. Rust still launches Node to execute tests, so
there is no evidence here of a large improvement in test execution itself.
The small fixture also makes startup a larger fraction than it would be for
hundreds of mutants or slow integration tests.

For real-project context, the unchanged sample domain suite passed all **33
tests** in each of five runs, with a median process wall time of **997.0 ms**.
No mutations were applied to sample itself. A mutation engine that repeatedly
runs a suite of that duration will spend most of its time in test execution.

Mutation switching, reliable test selection and worker reuse remain the more
promising ways to reduce that cost. They were not implemented here; these results
must not be presented as a benchmark against Stryker or an optimised executor.

## Size and maintenance

The combined Node benchmark implementation is 135 lines; the native benchmark
is 145. Both include analysis and a basic mutation executor. Line counts are a
description of these prototypes, not a maintainability score.

The native Linux executable is **1,707,224 bytes**, approximately 1.63 MiB. It
links the system C, maths and GCC support libraries. The installed TypeScript
dependency occupies about 24 MiB; Node/Oxc about 3.6 MiB, excluding Node itself.
The Rust dependency lock contains 58 transitive/direct dependency packages.

Rust therefore did not require a larger handwritten prototype, and its runtime
artifact is small. It does introduce a build toolchain and future packaging work
for different operating systems and CPU architectures. Node remains required for
JavaScript/TypeScript mutation tests. The local Rust toolchain/cache occupies
about 654 MiB and the build directory about 145 MiB; both are ignored scratch
files under this repository, not system-wide installations.

## Decision

Proceed with **Rust plus Oxc for the analysis core** if performance is a defining
goal of Seshat. The measured advantage is large enough to justify the choice,
and this prototype did not need materially more handwritten code.

Keep the next step bounded: add real per-function coverage attribution to this
prototype and repeat the comparison. That will establish whether the advantage
persists through a complete CRAP pipeline. Separately prototype one efficient
Node test-runner integration before choosing the final mutation architecture.

Do not promise an absolute fastest implementation from this experiment. Only
three straightforward implementations, one real source corpus, one machine and
a small synthetic mutation suite were measured. Performance samples include
outliers. There was no Stryker comparison or extensive optimisation of the Node
implementations. Canonical UTF-8 offsets also require conversion on the Node side;
future coverage mapping will require careful handling of UTF-16 source positions
in Rust too.

## Reproduction and evidence

- [Benchmark source and protocol](../benchmarks/README.md)
- [Raw timing samples and environment](benchmark-results.json)
- [TypeScript/Node implementation](../benchmarks/node.ts)
- [Native Rust implementation](../benchmarks/rust/src/main.rs)

There are seven fresh-process samples and fifteen warm samples per engine and
workload, with the warm samples spread over three processes. Engine order rotates
to reduce ordering bias. Dependencies and builds do not overlap measurements.
Memory measurements cover the analyser process, not its child test processes.
The OS filesystem cache was not flushed.

An initial run used the TypeScript entry point directly. It was replaced by the
precompiled-JavaScript run reported here; the initial data remains only under
ignored `work/` for auditability.
