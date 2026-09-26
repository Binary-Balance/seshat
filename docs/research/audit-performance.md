# Audit performance investigation

Issue [#76](https://github.com/Binary-Balance/seshat/issues/76) asked for evidence
before changing analysis or execution. This investigation keeps the runtime and
release profile unchanged. The scaling probes identify costs worth revisiting
for large individual files or many captured sources, but do not establish an
end-to-end benefit that warrants a new index, cache, copy implementation or
process supervision policy.

## Reproduce and inspect

Run the [benchmark driver](../../benchmarks/audit-performance/README.md). The
[raw evidence](../../outputs/audit-performance.json) records the measured source
revision and source hashes, environment, build costs, executable hashes, all
microbenchmark samples and every Node workspace run. The asset-byte metadata
was corrected from 11,468,800 to 13,107,200 after summing the retained files.
Timing samples, executable hashes and original measurement-input hashes remain
unchanged; the raw evidence records the correction. Tests call the existing
private functions through test-only modules added to a disposable crate copy.
The shipped source has no benchmark branches or clocks.

The measurements use Linux x64, Rust 1.98.1 and Node 24.21.0 on a two-vCPU host
reporting an AMD EPYC 7763. Inputs and copies live on tmpfs. Top-level runtime invocations run
sequentially, with concurrency inside the requested two-worker runs. Filesystem caches stay
warm. This is neither an SSD throughput result nor a production workload survey.

## Measurements

All values below are milliseconds, shown as median [minimum, maximum].
Microbenchmarks have seven samples; CLI conditions have three measured samples
after one warmup. Nested phase intervals must not be added together.

### Analysis and attribution

| Operation | 100 scopes | 1,000 scopes | 3,000 scopes |
| --- | ---: | ---: | ---: |
| Full analysis | 0.114 [0.113, 0.124] | 1.236 [1.226, 1.356] | 3.760 [3.736, 3.955] |
| Both owner lookups over all scopes | 0.064 [0.064, 0.069] | 6.358 [6.309, 6.960] | 57.490 [57.168, 58.131] |
| Full attribution | 0.909 [0.648, 1.008] | 30.805 [30.530, 31.557] | 253.142 [251.884, 254.669] |
| Decode all coverage coordinates | 0.455 [0.454, 0.463] | 21.769 [21.570, 22.058] | 189.176 [187.190, 204.751] |
| Load-error coordinates | 0.225 [0.224, 0.278] | 22.040 [21.311, 27.544] | 205.191 [192.851, 292.795] |
| Render all flat comparisons | 0.101 [0.101, 0.103] | 2.278 [2.255, 2.313] | 15.345 [15.271, 15.549] |

The ordinary-size probe has 100 one-line functions, while the 1,000 and 3,000
function files deliberately stress repeated scanning. Load-error coordinates
use separate files with one throw per function. Their cost is separate from
coverage decoding. These isolated measurements overlap the full operations;
they are not an additive decomposition.

Nested switching medians for 16, 64 and 128 comparisons are 0.013 ms, 0.066 ms, 0.225 ms.

### Capture and integrity checks

| Files, about 32 KiB each | Capture and cleanup | Worker copy and cleanup | Verify all source bytes |
| ---: | ---: | ---: | ---: |
| 10 | 1.213 [1.172, 1.692] | 1.161 [1.140, 1.291] | 0.657 [0.640, 0.663] |
| 100 | 14.173 [13.509, 14.572] | 13.745 [13.551, 14.464] | 6.781 [6.683, 6.840] |
| 500 | 77.503 [76.228, 80.682] | 70.972 [68.345, 72.968] | 33.802 [33.567, 34.101] |

Verification remains relevant when repeated around many runner jobs. These
measurements retain the complete safety checks and do not extrapolate their
cost to another filesystem. Copy measurements include equality checks and
destruction, whereas the CLI preparation phases below have narrower boundaries.

### Managed jobs

| Node timer delay | Managed job | Ordinary blocking job |
| ---: | ---: | ---: |
| 0 | 30.265 [28.778, 38.603] | 27.728 [26.646, 28.838] |
| 10 | 38.865 [36.965, 40.069] | 37.170 [36.552, 38.251] |
| 50 | 79.231 [78.400, 79.641] | 78.035 [77.570, 78.530] |

### Real Node workspace

The fixture has two source files, two mutants and 100 captured assets totalling
13,107,200 bytes. All 32 runs passed the same scope, mapping, outcome, source
integrity and scratch cleanup checks. One Node test case checks three comparison boundary values
and the workspace import; both mutants are killed.

| LTO | Workers | Strategy | Whole CLI |
| --- | ---: | --- | ---: |
| off | 1 | replace | 1808.720 [1762.637, 1863.872] |
| off | 1 | switch | 2049.714 [2005.504, 2189.407] |
| off | 2 | replace | 1962.952 [1934.083, 2124.871] |
| off | 2 | switch | 2229.631 [2075.384, 2233.608] |
| thin | 1 | replace | 1940.680 [1799.193, 2029.848] |
| thin | 1 | switch | 2281.925 [2026.145, 2553.051] |
| thin | 2 | replace | 1994.832 [1903.692, 2066.754] |
| thin | 2 | switch | 2069.457 [2061.676, 2090.445] |

Median phase timings for the current LTO-off profile:

| Workers / strategy | Analysis | Attribution | Capture | Worker preparation | Original runner jobs | Mutant runner jobs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 / replace | 0.067 | 0.019 | 12.938 | 0.000 | 1465.425 | 326.167 |
| 1 / switch | 0.064 | 0.019 | 12.722 | 172.937 | 1526.575 | 330.824 |
| 2 / replace | 0.063 | 0.019 | 13.652 | 173.852 | 1510.503 | 490.039 |
| 2 / switch | 0.072 | 0.019 | 13.159 | 343.817 | 1574.143 | 511.641 |

Runner columns sum measured job durations, including process start, polling and
cleanup. They are not child-CPU time. Worker preparation includes worker
baselines; original runner jobs cover typecheck, test and coverage. The raw
report retains switching and prepared-baseline durations separately. Two-worker
mutant jobs overlap, so their sum must not be interpreted as elapsed wall time.

### LTO build and size tradeoff

| Release LTO | Binary bytes | Initial build | Application rebuild |
| --- | ---: | ---: | ---: |
| off | 2,015,944 | 46365.449 | 8795.258 [8717.475, 8925.016] |
| thin | 1,937,384 | 59416.964 | 20633.642 [20160.566, 20844.272] |

Thin LTO saves 78,560 bytes, 3.9%, and takes 2.35 times the
median application rebuild time. Runtime medians change direction across
conditions and have overlapping ranges. This matrix does not establish a
consistent runtime gain. Fat LTO was not measured.

## Decisions and limits

Coordinate conversion repeatedly scans preceding lines, and both owner lookups
scan scopes. The probes retain these costs separately from full attribution.
Coordinate rescans are a reproduced cost, not a theoretical concern. Revisit a
line-start table when an actual selected file has roughly 1,000 or more mapped
statements, or attribution repeatedly takes at least 50 ms per file. At that
point compare complete mappings and end-to-end timings before introducing the
index. The 3,000-statement stress case already exceeds that time threshold; it
is a reproducible input for evaluating a future implementation, not evidence
of how often ordinary projects hit it. Consider a scope index only after
coordinate conversion is addressed and owner lookup remains material. Coverage continues to validate UTF-16
coordinates,
executable statement starts, compatible mappings and complete scope.

Switching rendering recursively scans the comparison list. Flat and nested
inputs are measured separately. The runner matrix still executes every mutant
in a fresh process, including inactive prepared baselines. Switching is an
explicit experiment; these timings do not make it the default.

Source verification measures the actual `unchanged` method, including path
checks, checked file opens and byte comparison. The runnable check alters bytes
without changing file size and requires rejection. A worker edit must leave the
captured and original files unchanged. No mtime or size shortcut, memoized
verification, or shared mutable hardlink is proposed.

The current capture path opens and checks files before calling `std::io::copy`
with file handles. This preserves the path-swap protections. Rust already
provides kernel-assisted copying where supported, both for
[`std::fs::copy`](https://doc.rust-lang.org/1.98.1/std/fs/fn.copy.html) and for
[`std::io::copy`](https://doc.rust-lang.org/1.98.1/std/io/fn.copy.html) on Linux.
The measurement does not establish which kernel syscall ran on this tmpfs mount.
A custom reflink implementation is not justified, and replacing checked handles
with a path-based copy would need separate assurance evidence.

The managed-job comparison includes polling, pipes and process-tree cleanup.
It cannot attribute their combined overhead solely to the 2 ms sleep. Keep the
existing interval and its cancellation checks. Since no supervision code
changes, this investigation makes no new cancellation-latency guarantee.

Keep release LTO off. Thin LTO is a size, runtime and build-cost choice, not a
correctness fix. These local rebuilds are not release reproducibility evidence;
a future flag change still requires the repository's reproducibility checks.
