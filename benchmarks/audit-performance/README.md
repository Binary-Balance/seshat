# Audit performance measurements

This Linux driver investigates issue #76 without changing the release source or
its Cargo profile. It copies the crate and embedded runner helpers into a new
work directory, appends ignored test modules from `probes.rs`, builds with LTO off
and thin LTO, and runs the existing implementation through those probes. The
extra modules compile only in the test executable. No private API is made public.

Install the dependencies described in [the proof instructions](../proofs/README.md),
then run from the repository root with Rust 1.98.1 and Node 24 on `PATH`:

```sh
python3 benchmarks/audit-performance/run.py \
  --work /tmp/seshat-audit-performance \
  --output outputs/audit-performance.json
```

`--work` must not exist. `--dependencies PATH` can name another checkout with the
same installed benchmark dependencies. Cargo runs offline against its populated
cache. Allow native child processes and Node tests; a sandbox permission failure
is a failed measurement. Do not overlap builds or measurements with other local
heavy work. The driver removes its disposable Cargo targets after copying the
executables, retaining source and executable evidence in the work directory.

Each microbenchmark has one warmup followed by seven samples. A sample repeats
its named operation `iterations` times and reports milliseconds per operation,
including result destruction. All samples are retained. The probes check:

- Analysis, both scope lookup functions, flat and nested switching rendering,
  and load-error coordinates on generated TypeScript.
- Actual coverage coordinate decoding and attribution, with complete mappings,
  measured rows and expected coverage. Unicode comments prevent treating bytes
  and UTF-16 columns as interchangeable.
- Capture, worker copying and full source-byte verification for 10, 100 and 500
  files of approximately 32 KiB each. Copy timings include cleanup and source
  equality checks. Same-size edits fail verification; editing a worker leaves
  the original and captured source unchanged; scratch directories are empty.
- Managed Node jobs versus ordinary blocking Node jobs with 0, 10 and 50 ms
  timer delays. The difference includes pipe handling and process-tree cleanup
  as well as the 2 ms poll loop. It does not isolate polling alone.

Build measurements retain the initial dependency build and three application
rebuilds after `cargo clean -p seshat --release`. Dependencies remain cached for
those three rebuilds. LTO conditions have separate targets. Build order is off,
then thin; this is not a thermal or cache-controlled compiler benchmark.

The real runner reuses the maintained Node workspace fixture and collector. It
adds 100 captured assets totalling 13,107,200 bytes, without adding source or
mutants. Off/thin LTO, workers 1/2 and replacement/switching produce eight
conditions, each with a warmup and three measured fresh CLI invocations. Order
alternates between forward and reverse conditions. Every run must preserve the
two-file scope, complete coverage, exact mutant mappings, two killed outcomes,
original bytes and empty scratch directory. Raw phase timings distinguish
analysis, attribution, capture, worker preparation and runner jobs. Parallel
runner durations are work totals, not additive wall time.

The fixture is a bounded measurement of real code paths. Large generated files
stress scaling; they are not evidence that an ordinary project has the same
shape. Caches stay warm and the temporary filesystem is recorded. Do not infer
SSD copy speed or production latency from a tmpfs run. No sampling or skipped
mutants are used within an assessment, and no time/size substitute for byte
verification or shared mutable hardlink is introduced.
