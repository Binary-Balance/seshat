# Seshat Rust feasibility experiment

This is a reproducible experiment, not a production CRAP or mutation-testing tool.
It compares a TypeScript compiler-API implementation, Node with the Rust Oxc
parser, and a native Rust/Oxc implementation.

## Reproduce

Requirements: Linux, Node 24, npm, and Rust 1.98.1 or a compatible newer toolchain.
The Rust memory probe uses `/proc/self/status`.

From the repository root:

```sh
npm ci --prefix benchmarks --ignore-scripts --no-audit --no-fund
cargo build --release --locked --manifest-path benchmarks/rust/Cargo.toml
node benchmarks/run.mjs --check
node benchmarks/run.mjs
```

The experiment installed Rust locally without changing the system PATH. To reuse
that installation in this checkout:

```sh
export RUSTUP_HOME="$PWD/work/toolchain/rustup"
export CARGO_HOME="$PWD/work/toolchain/cargo"
export PATH="$CARGO_HOME/bin:$PATH"
```

The benchmark defaults to the checked-in TypeScript fixtures. To measure another
trusted source tree, pass its source directory explicitly:

```sh
SESHAT_BENCH_ROOT=/path/to/typescript/source node benchmarks/run.mjs --check
SESHAT_BENCH_ROOT=/path/to/typescript/source node benchmarks/run.mjs
```

The driver recursively selects production `.ts` and `.tsx` files, excluding common
build/dependency directories and test/declaration files. It copies source into
ignored `work/corpus/` and uses only the benchmark's own mutation tests. It does
not run an external application's test suite. An empty source corpus is an error.
The Node implementation is compiled to JavaScript before timing either Node engine.

Historical measurements in `outputs/benchmark-results.json` use a separate
51-file corpus that is not distributed here. They are not measurements of the
checked-in default fixtures; run the driver to obtain timings for your own inputs.

## Measurement contract

- Functions with bodies include methods, constructors, accessors, arrows and
  nested callbacks; overload declarations and type signatures are excluded.
- Experimental complexity is 1 plus `if`, loop, catch, non-default switch case,
  conditional expression, logical expression and logical assignment nodes.
  Nested functions receive their own counts. Optional chains and default
  parameters do not add complexity in this experiment. This is an explicit
  benchmark convention, not a finished Seshat specification or full ESLint parity.
- Comparison candidates are the eight operators `< <= > >= == != === !==`.
  The source parser identifies expressions before the code locates their tokens.
  Comments, strings, JSX delimiters and type syntax are not mutation candidates.
- Every result contains canonical UTF-8 byte offsets, complexity, and CRAP at
  **fixed synthetic 50% coverage**. No actual project CRAP scores are claimed.
  Coverage ingestion, source-map remapping and statement-to-function attribution
  are not implemented or benchmarked.
- Parity checks compare every function range, complexity, synthetic CRAP value,
  comparison operator and comparison offset, not just aggregate counts.
- The fixture has hand-checked complexity values `[6,2,1,1,8,2,3]`, 14 comparison
  sites, Unicode text, comments containing operators, methods, nested arrows,
  type-only syntax, JSX, loops and logical assignments.

## Timing protocol

Each workload is run sequentially across engines in rotating order. No builds
or dependency downloads overlap timed execution. Both Rust and TypeScript are
built before timing. Rust uses a release build with thin LTO, no CPU-specific flags.

- **Fresh process:** seven samples of process start, imports, file reads, parsing,
  analysis and compact summary output. The OS filesystem cache is not flushed.
- **Warm analysis:** three processes per engine, each with three warm-up rounds
  and five measured rounds. Source is already loaded. These timings include
  parsing, visiting, result allocation, sorting and synthetic CRAP arithmetic.
- **Parse:** separate parser measurements. The Node/Oxc API materialises a
  JavaScript AST; native Oxc keeps its AST in Rust. These representations have
  different allocation and transfer costs. Parsing performs syntax diagnostics,
  not type checking or complete semantic validation.
- **20x workload:** reprocess the same 51 loaded source files twenty times. This
  is a throughput stress test, not an independent 1,020-file application. Its
  memory numbers should not be extrapolated to a large unique source corpus.
- **Memory:** peak parent-process RSS, measured by Node resourceUsage or Rust
  `/proc`. Child test processes are not included.

## Mutation execution experiment

All engines run the same fixed fixture through the same Node test runner. They
first establish a passing baseline, then replace one operator at a time, launch
a fresh test process and collect its verdict. Five runs per engine rotate order.
All ten mutant outcomes must agree: eight killed by assertion failures and two
surviving because the tests omit boundary values.

The outer harness has a 60-second process timeout; Node's inner executor also
has a 10-second limit. The native executor has no separate per-mutant timeout.
The fixed fixture does not contain mutation-induced loops. This is deliberately
not a general-purpose executor for arbitrary untrusted projects.

This experiment measures a basic fresh-process execution strategy. It does not
measure mutation switching, test selection, concurrent workers, incremental
caching, a Rust test runner, or parity with Stryker. Rust still launches Node
to execute TypeScript application tests.

## Interpretation

The experiment compares specific implementations and parser libraries. It does
not isolate language alone or prove that Rust is faster than every possible
TypeScript implementation. It also does not establish absolute fastest-in-class
performance, complete language conformance, or production readiness.

Raw samples are in `outputs/benchmark-results.json`; the decision report records
the measured results and their practical limits. The native benchmark is roughly
the same source length as the combined Node benchmark, but it does not yet bear
the cost of distributing native binaries across operating systems and CPUs.
