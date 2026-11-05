# Collection phase refactor evidence

Issue [#226](https://github.com/Binary-Balance/seshat/issues/226) splits mutation
execution into planning, preparation, scheduling and summary helpers, and
assessment into original checks, attribution and mutation helpers. These helpers
and their result structs remain private to `collection.rs`.

The before executable was built from
`4128bcc3599f338fa37b4b40492ae8378aae304a` before editing. Both executables used
Rust 1.98.1 on Linux x64 with Node 24.22.2. The public example lockfiles were
unchanged. Each run used `check --json --no-progress` and an external scratch
parent. The two extra Node configurations changed only `workers` to 2; the
switching run also supplied `--experimental-switching`.

## Results

All ten runs exited 0 and completed. Counts and scores below are identical
before and after. Worker baseline counts belong to the operator phase; the
extreme phase reports zero in every run.

| Example / strategy | Score | Total jobsAttempted | Operator jobs | Extreme jobs | workerBaselineJobs | preparedBaselineJobs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Node / replacement, 1 worker | 75 | 9 | 4 | 2 | 0 | — |
| Vitest / replacement, 1 worker | 83.33 | 13 | 6 | 4 | 0 | — |
| Jest/Expo / replacement, 1 worker | 75 | 10 | 4 | 3 | 0 | — |
| Node / replacement, 2 workers | 75 | 10 | 4 | 2 | 1 | — |
| Node / switching, 2 workers | 75 | 12 | 4 | 2 | 2 | 1 |

The [summary](../../outputs/collection-phases/summary.json) retains every phase
timing, mutation scheduling/preparation/cleanup timing, executable hash and
source hash. Full reports retain actual timings and diagnostics:

- [Before reports](../../outputs/collection-phases/before)
- [After reports](../../outputs/collection-phases/after)

These are single samples from a shared machine, with warm caches and concurrent
work. They establish behavior parity, not a performance result.

The original example source and test hashes matched after the before and after
batches. The scratch parent was empty after the first three-report batch and
after every subsequent report. Temporary two-worker configuration files were
removed. Existing Rust checks also cover restoration, worker preparation,
original-job failures, attribution failures, selection retries, deadlines,
cancellation and cleanup errors.

## Comparison rules

Run the retained comparison from the repository root:

```sh
node benchmarks/proofs/collection-phases-parity.mjs
```

The saved reports replace local scratch paths and generated capture identities
with portable placeholders. The comparison normalizes those identities and an
explicit list of duration/rate fields, retaining null timing values. Mutant
timeout limits remain exact. All other report values, object fields and array
ordering must match, including verdicts, coverage, compiler findings, selection
reasons, runner versions, assertion values and job counts. Job totals are also
recomputed from their constituent jobs and baselines.

Timing-derived diagnostics need two specific checks:

- Throughput, summed worker time and the ordered top-five slowest executions
  must equal the values derived from each report's own outcomes and timings.
  Top-five membership and order can change with timings, so that list is checked
  within each report rather than compared across runs. Every referenced mutant's
  ID, path and verdict still match through the complete outcome comparison.
- Runner diagnostics normalize test durations, clocks and timing percentages.
  Vitest orders its duration breakdown by time, so only that breakdown's timing
  components are sorted. Jest omits some zero-duration annotations and sometimes
  includes estimated time. Two Jest diagnostic prefixes end 8 and 1 characters
  apart after timing normalization: longer timing text moved the existing
  1,000-character stream cutoff. The comparison requires both original strings
  to have exactly 1,000 characters and their normalized text to match through
  the shorter prefix. The saved reports retain both suffixes. Assertion values
  and diagnostic text before the cutoff remain exact.

## Checks

```sh
cargo test --manifest-path crates/seshat/Cargo.toml
cargo clippy --manifest-path crates/seshat/Cargo.toml --all-targets
cargo fmt --manifest-path crates/seshat/Cargo.toml --check
git diff --check
```

All 194 Rust tests passed: 180 unit tests, 3 CLI tests and 11 proof-command tests.
Clippy completed with 20 existing warnings, down from 22 because `mutate` and
`run_mutant` no longer take nine arguments. The extraction introduces no new
Clippy warnings. Formatting and diff checks passed.

Validation is local Linux x64; the cross-platform release matrix was not run.
