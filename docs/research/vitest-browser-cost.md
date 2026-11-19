# Vitest browser job costs

This is item 8 of [#293](https://github.com/Binary-Balance/seshat/issues/293),
measured after the per-job temporary-directory change in #301. The
[cost runner](../../benchmarks/proofs/vitest-browser-cost.mjs) drives the existing
[browser proof](../../benchmarks/proofs/vitest-browser-check.mjs) and fixture.
It changes no runtime defaults.
All runs use source replacement and fresh Vitest/browser processes.

Measured on 2026-11-19 with CLI source `499e4c4` and
[harness `05c9a81`](https://github.com/Binary-Balance/seshat/tree/05c9a81c7f6520d171a8d93e7a8e9fc31de9da9c).
The recorded source hashes identify the producing harness; its final path-parser
and tracing-environment fixes do not affect the measured Linux jobs.

## Method

Three samples per browser and variant, rotating browser and variant order:

- Normal cache and failure screenshots, with one and two mutation workers.
- Remove `.vite` before every job, with one worker and failure screenshots.
- Normal cache with `browser.screenshotFailures: false`, with one worker.

The full fixture keeps its React layout and offline Web Audio tests, all 19
comparison mutants and seven extreme mutants. Every run must have identical
source assessments and operator/extreme verdicts: 13/6 operator kills/survivors
and 6/1 extreme kills/survivors. Browser mutant jobs run the full test command.
The Node comparison uses the proof's separate, identical one-test control in
both environments; it cannot run the browser-only fixture.
Its ratio measures the whole job, including launch, reporting and shutdown;
this experiment does not time those browser costs separately.

All variants have benchmark-only tracing. Snapshots are taken outside test
bodies but within measured job time, so tracing overhead remains in the
numbers. The cold variant deliberately removes an existing cache; it does not
describe the default. OS page caches are not cleared. The Chromium pilot ran
before the recorded samples.

The result file records binary and harness hashes, CLI source revision,
tool/browser versions, timestamps, host details and load averages. This is a
shared two-vCPU Linux host with background services. No other CPU-heavy
workload was observed in process snapshots during setup and the first samples. Load averages also include the preceding
benchmark jobs; they are not a measure of unrelated host activity. There was
no continuous measurement of unrelated process CPU usage. These are small
fixture comparisons, not production-project performance guarantees.

## Results

Three-sample medians follow. Mean job time is the median of each sample’s
mean across its 19 operator jobs. The operator phase excludes extreme
mutation; complete-check wall time includes it. Two workers can reduce
phase wall time while increasing individual job duration through contention.
The [portable result file](vitest-browser-cost.json) retains every sample.

| Browser | Variant | Complete check, s | Operator phase, s | Mean operator job, s |
| --- | --- | ---: | ---: | ---: |
| Chromium | Normal cache, 1 worker | 78.85 | 51.00 | 2.68 |
| Chromium | Cold every job, 1 worker | 82.83 | 54.76 | 2.88 |
| Chromium | No failure screenshots, 1 worker | 74.76 | 48.54 | 2.55 |
| Chromium | Normal cache, 2 workers | 73.66 | 45.71 | 4.66 |
| Firefox | Normal cache, 1 worker | 157.55 | 105.19 | 5.53 |
| Firefox | Cold every job, 1 worker | 162.55 | 108.08 | 5.69 |
| Firefox | No failure screenshots, 1 worker | 157.31 | 103.88 | 5.46 |
| Firefox | Normal cache, 2 workers | 149.41 | 92.69 | 9.51 |

- Chromium: normal complete checks ranged from 76.11 to 80.51 s.
  Forced-cold checks changed the median by +5.0%; disabling
  screenshots changed it by -5.2%; two workers changed
  it by -6.6%. The matched one-test control took
  2.23 s per browser mutant job against 0.60 s in Node
  (3.70×).
- Firefox: normal complete checks ranged from 157.52 to 159.46 s.
  Forced-cold checks changed the median by +3.2%; disabling
  screenshots changed it by -0.2%; two workers changed
  it by -5.2%. The matched one-test control took
  4.91 s per browser mutant job against 0.60 s in Node
  (8.13×).

All recorded runs completed without unresolved executions or browser retries.
There were 36 complete CLI checks, including 24 full-fixture checks and 12
matched-control checks.

Both browsers reused dependency metadata in 25/28 normal-cache
fixture jobs in every sample. Normal runs wrote 38 new PNG files
(failure screenshots plus Vitest’s attachment copies); screenshot-disabled
runs wrote none. Forced-cold jobs always started with an empty `.vite`.

The cache and screenshot differences do not explain the much larger
browser-versus-Node control-job cost. These results support keeping the existing
cache layout and one-worker default. Screenshots can be disabled explicitly,
but the Firefox difference is smaller than the observed run-to-run variation.
Measure the consuming project before increasing workers: the modest wall-time
gain here came with much slower individual jobs through contention.


## Cache and temporary files

The trace distinguishes cache files merely being present from reuse: it
compares dependency metadata hashes and modification times before and after
each job. The checked execution copy persists between jobs. Its configured
`.vite` directory is outside each private temporary directory.

Vitest 5.0.0 creates a new project temporary directory with `nanoid()` for each
process and writes transformed content there. Its source does this independently
of Seshat's choice of `TMPDIR`. The trace records temporary-file counts and
sizes, but they do not establish reusable-cache hits. No Node compile-cache
directory was configured for this experiment.

Playwright gives each browser launch a fresh profile even when its parent
temporary directory is shared. This fixture enables neither TypeScript
incremental builds nor a separate persistent compiler cache. The inspected
toolchain therefore supplies no identified temporary cache that previously
survived between jobs; the Vite dependency cache is the reuse measured here.

This experiment does not compare a pre-#301 binary, so it cannot quantify a
before/after temporary-directory regression or generalise to tools with their
own temporary caches.

## Reproduce

Install the fixture dependencies and browsers, build the release CLI, and run
the command in the [proof README](../../benchmarks/proofs/README.md#browser-job-cost).
`result.json` retains per-sample timings and cache counters; the benchmark's
work directory also retains full proof reports, receipts and cache traces.
Disposable execution inputs are removed only after a proof passes.
