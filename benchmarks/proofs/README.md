# Bounded Rust architecture proofs

These experiments test coverage attribution and mutation execution. They include
a CLI candidate, not a published release or a production executor.
The earlier benchmark under `benchmarks/rust/` is unchanged.

## Run

Requirements: Linux x64, Node 24, npm, Rust 1.98.1 and a `kill` executable that
supports process-group IDs. The recorded run used Node 24.20.0. Dependencies are
pinned in the two npm lockfiles and this directory's Cargo lockfile.

From the repository root:

```sh
npm ci --prefix benchmarks --ignore-scripts --no-audit --no-fund
npm ci --prefix benchmarks/proofs --ignore-scripts --no-audit --no-fund
export CARGO_TARGET_DIR="$PWD/benchmarks/rust/target"
cargo test --locked --manifest-path benchmarks/proofs/Cargo.toml
cargo build --release --locked --manifest-path benchmarks/proofs/Cargo.toml
node benchmarks/proofs/run.mjs
```

To reuse this checkout's project-local Rust installation, first set the three
toolchain variables shown in [the original benchmark instructions](../README.md).
The proof dependencies are development tools, not proposed Seshat runtime
dependencies. Do not run untrusted test suites with this experimental executor.

The default is three samples per runner and strategy. For a shorter correctness
run, use `SESHAT_PROOF_SAMPLES=1 node benchmarks/proofs/run.mjs`. Use
`node benchmarks/proofs/run.mjs --coverage-only` to omit mutation execution.
Each successful invocation overwrites `outputs/bounded-proofs.json`, so a
coverage-only invocation does not retain earlier mutation results.

Generated fixtures and coverage artifacts remain under ignored
`work/assurance-proofs/run-*` directories. Mutation sessions use their own copies
and remove those copies on normal completion. The script checks source hashes
and checks that no session directories remain. It never changes either consuming
project or writes mutants into the source fixture.

## CLI candidate

The `seshat` and `seshat-proofs` binaries share the existing private Rust modules.
No CLI framework or new dependency was added. The Cargo package remains the
unpublished `seshat-proofs` version `0.0.0`; moving and packaging release code is
separate work. `cargo run` still defaults to the legacy proof entry point.

After the installation above, build both binaries and run the regression:

```sh
cargo build --release --locked --manifest-path benchmarks/proofs/Cargo.toml --bins
node benchmarks/proofs/cli.mjs
node benchmarks/proofs/process-environment-check.mjs
benchmarks/rust/target/release/seshat --help
benchmarks/rust/target/release/seshat check --config /absolute/path/to/seshat.json --json
```

The regression uses disposable Node tests, the real TypeScript compiler and the
existing statement-coverage collector. It checks all three commands, legacy
proof parity, config/scratch defaults, JSON/progress separation, invalid options,
missing typechecks, failed baselines, coverage failure and omission, zero mutants,
SIGINT/SIGTERM score withholding, child shutdown and copy cleanup. Threshold
controls verify inclusive boundaries, unchanged assessment results, exit 1,
invalid limits, command-specific checks and incomplete/cancellation precedence. It retains
results under `work/assurance-proofs/cli-*`, not the recorded benchmark outputs.
Rust tests additionally check human formatting of unknown and unscored functions.

Use the [configuration guide](../../docs/configuration.md).
The configuration directory is the project root; all commands use its source and
setup scope. Default config is `./seshat.json`; default scratch is the OS temporary
directory. `--scratch PATH` must name an existing parent outside the project.
Paths with spaces must be shell-quoted. Unknown, duplicate or missing options are
errors before capture. Help and version do not read configuration.

| Command | Original checks | Coverage | Mutants |
| --- | --- | --- | --- |
| `check` | Required typecheck and test baseline per setup | Fresh, required | All configured setups |
| `crap` | Configured typecheck, test baseline per setup | Fresh, required | None |
| `mutate` | Required typecheck and test baseline per setup | Not requested | All configured setups |

Coverage configuration is still required for all commands, but `mutate` never
executes the coverage command. It reports coverage as `not-requested` and omits
function CRAP results. This does not permit skipping any mutation test setup.
`workers` remains a config setting; no command-line worker override is provided.

Installed `check` and `mutate` accept `--experimental-switching`; `crap` rejects
the option. Replacement remains the default. Switching prepares all selected
sources after the original checks, runs an inactive prepared baseline on the
primary copy and every worker, and then executes each mutant in a fresh test
process. The mutation report includes `preparedBaselines`,
`preparedBaselineJobs`, `switchPreparationMs` and `preparedBaselineMs` so the
extra work stays visible. The experiment does not typecheck transformed helpers;
helper wrapping can affect TypeScript narrowing and runtime reflection.

Default stdout is readable text. `--json` instead emits one JSON object, even for
argument/config errors. Phase notices and mutation snapshots go to stderr;
`--no-progress` suppresses them. Captured test output stays in JSON evidence, never interleaved
with stdout. Draft schema version 1 has these top-level fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion`, `toolVersion` | Report contract and candidate version |
| `command` | Requested command, or null on argument errors |
| `complete`, `cancelled`, `signal` | Assessment completeness, cancellation flag and signal number or null |
| `scope` | Include/exclude patterns, resolved source paths and setup names/runners/directories; null when capture fails |
| `timings` | `wallMs`, `captureMs`, `executionMs`; unavailable phases are null |
| `result` | Existing assessment evidence plus runtime diagnostics |
| `quality` | Threshold state and configured checks, or null when config/capture did not succeed |

Timings are milliseconds. Wall time covers argument handling, capture, assessment
and cleanup, but excludes final threshold evaluation, formatting/output and
process-launch overhead.
Capture measures config validation and the first copy. Execution starts at source
analysis and includes runner jobs, attribution and mutation work, but excludes
final cleanup of the primary copy and receipts. Mutation evidence separately
reports `workerPreparationMs`, `mutationWallMs` and `workerCleanupMs`. These are
nested intervals, not additive costs; parallel job durations must not be summed
as wall time. Per-job details remain in `result`.

`result.phaseTimings` contains `analysisMs`, `preparationMs` for runner evidence,
`typecheckMs`, `baselineMs`, `coverageMs`, `attributionMs` and primary `cleanupMs`.
Original typecheck/baseline/coverage totals sum the sequential measured setup
phases. Each setup also retains these three fields under `timings`. They include
validation and receipt handling; coverage includes report reading and validation.
Attribution includes producing the source-assessment rows. No attempted phase
means null, including coverage/attribution in `mutate`. Failed or cancelled phases
retain elapsed time, not a fabricated zero. Errors before runner-evidence
preparation succeeds can still lack these phase measurements.

Each attempted mutant gets `executionMs`, covering replacement, its setup jobs
and restoration. Mutation `completed` counts returned attempts, including failed
ones; it does not mean killed or successfully assessed. `notRun` counts planned
mutants without a returned attempt. `unresolved` is planned minus killed minus
survived, including unattempted mutants. These counters do not override the
run's `complete` flag, which can also fail for cleanup or worker errors.

`result.diagnostics.runnerVersions` records the Node version from a validated
runner receipt and the runner package versions observed by the private
reporters. It also reports captured `package.json` runner and Node-engine
declarations and `package-lock.json` versions when present. Exact declarations
are compared with
the observed version; ranges are `not-comparable`, and missing receipts or
manifests are `unavailable`. It never treats a declared range as a mismatch.
`result.diagnostics.concurrency.seshat` reports the configured mutation worker
limit and its effective use. Each runner entry is labelled `test` or
`coverage` and reports an effective worker limit only when the direct runner
invocation or resolved receipt establishes one. Node and Jest use supported
runner flags (`--test-concurrency`, `--runInBand`/`-i`, or `--maxWorkers`);
Vitest uses the resolved limit for the selected project(s), including a
`fileParallelism: false` override. Wrappers, unresolved config values and
selected projects with conflicting limits remain `unavailable`.

`result.mutation.diagnostics` contains `unresolvedBreakdown` by verdict,
`throughput` measured against mutation wall time, cumulative returned-mutant
`workerTimeMs`, and at most five `slowestExecutions` rows. Mutation wall time is
the scheduler interval and worker time is the sum of returned mutant attempt
durations; parallel durations must not be added to wall time. Missing job
durations are omitted from the slow list and do not become zero.

Progress reports elapsed time since assessment began, after initial capture.
Mutation snapshots show completed attempts, currently running attempts,
remaining unstarted work and the unresolved timeout/error/cancellation/not-run
counts observed so far. Their work counts sum to the plan size. Updates occur
at attempt starts/finishes, at most four per second, plus phase/final notices.
There is no polling thread, ETA or periodic update while a test is still running.
The final mutation notice adds resolved/unresolved and not-run counts. Final
counts and phase timings remain available with progress disabled. Output errors
on stderr are ignored; a blocked stderr consumer can still slow the command.

`cli.mjs` alternates three progress-enabled and three quiet mutation runs, checks
identical work and outcomes, and records external whole-command wall times. This
small-fixture comparison measures the marginal progress-output cost, not all
timing instrumentation or a production-workload guarantee. Run it without other
proofs concurrently. To check snapshots across worker overlap, failures and
cancellation using the existing parallel controls:

```sh
SESHAT_PARALLEL_CLI=1 node benchmarks/proofs/parallel.mjs
```

The recorded Linux verification passed 42 CLI scenarios and all 11 parallel
controls. Two three-pair timing batches measured progress-on/off medians of
1234/1300 ms and 1368/1319 ms respectively, with identical work and results.
The direction changed between batches; these samples do not establish a reliable
overhead bound. Evidence remains in `work/assurance-proofs/cli-ybny6Y`,
`cli-yq1i0W` and `parallel-JttVJe` under that same parent directory.

Snapshots are diagnostic text, not a stable parsing interface. Use the versioned
JSON for automation. Version observations come only from the supported private
receipts; an opaque command or unsupported runner cannot be made precise by
guessing from its executable name.

For tuning, first run the complete command with fixed source, configuration,
coverage and runner inputs, retaining the JSON report and outcome rows. Change
one setting, such as Seshat `workers` or an explicit runner worker limit, and
repeat the same command at least three times after a warmup. Compare wall and
phase timings, throughput, unresolved breakdowns and slowest rows, then verify
identical source scope, scores, mutant definitions and verdicts. Keep runner
workers bounded when Seshat workers overlap, and isolate ports, files and
databases per worker. Do not reduce tests or source scope, hide failures or
weaken coverage to improve timing.

### Diagnostics overhead matrix

The bounded overhead proof uses the baseline tarball from commit
`fbe06e9280cedb8daea41edc07b90f39e369bbe6` and a candidate built from the
diagnostics commit. Build the candidate with the local toolchain and the pinned
Debian inputs:

The recorded candidate was built from runtime commit
`62bcddd2a2008cdcca23b8baf93448b2d147f8d8`.

```sh
REPO_ROOT="$PWD"
export RUSTUP_HOME="$REPO_ROOT/work/toolchain/rustup"
export CARGO_HOME="$REPO_ROOT/work/toolchain/cargo"
export PATH="$REPO_ROOT/work/toolchain/cargo/bin:$PATH"
node packaging/pack.mjs work/debian11-inputs
```

For a fresh baseline, archive the pinned commit into a separate source root and
run the same pack command there; the recorded run reused its captured tarball:

```sh
BASELINE_ROOT="$REPO_ROOT/work/diagnostics-baseline/source"
mkdir -p "$BASELINE_ROOT"
git archive fbe06e9280cedb8daea41edc07b90f39e369bbe6 | tar -x -C "$BASELINE_ROOT"
(cd "$BASELINE_ROOT" && \
  RUSTUP_HOME="$REPO_ROOT/work/toolchain/rustup" \
  CARGO_HOME="$REPO_ROOT/work/toolchain/cargo" \
  PATH="$REPO_ROOT/work/toolchain/cargo/bin:$PATH" \
  node packaging/pack.mjs "$REPO_ROOT/work/debian11-inputs")
```

The Jest/Expo dependency directory is prepared as shown in the
[Jest/Expo combined workflow](#jestexpo-combined-workflow). The current pack
completes with the pinned Debian inputs and records the resulting artifact
hashes in the retained JSON evidence. Set these paths to the resulting files:

```sh
BASELINE_TARBALL=/absolute/path/to/baseline/binary-balance-seshat-0.0.0.tgz
CANDIDATE_TARBALL=/absolute/path/to/candidate/binary-balance-seshat-0.0.0.tgz
JEST_DEPS=/absolute/path/to/jest-expo-fixture
```

Then run the fixed matrix:

```sh
node benchmarks/proofs/diagnostics-overhead.mjs \
  --repo "$PWD" \
  --baseline "$BASELINE_TARBALL" \
  --candidate "$CANDIDATE_TARBALL" \
  --jest-deps "$JEST_DEPS" \
  --baseline-commit fbe06e9280cedb8daea41edc07b90f39e369bbe6 \
  --candidate-commit 62bcddd2a2008cdcca23b8baf93448b2d147f8d8 \
  --samples 3 \
  --output outputs/diagnostics-overhead.json
```

The driver installs both tarballs offline into separate consumers with isolated
npm caches and configs. It runs the Node workspace, Vitest React/Fastify TSX and
Jest/Expo fixtures at Seshat workers 1 and 2, with progress enabled and disabled.
Each condition has one warmup and three paired measured samples. Binary order
alternates between pairs and progress order alternates within each pair; all
processes run sequentially. The wall boundary includes child exit and stdout /
stderr report serialization. Each run checks complete `check --json` output,
source and config hashes, expected CRAP values, mutant definitions and verdicts,
job counts and semantic parity before retaining its timing. Fresh captured copies
isolate each invocation, while host filesystem, npm, runner and OS caches remain
warm.

The refreshed run retained 24 candidate diagnostics snapshots, including runner
versions, declared and lockfile comparisons, concurrency states, mutation
throughput, worker time and unresolved breakdowns, under `runs[].diagnostics`.
Jest reported actual `29.7.0` and `jest-expo` `57.0.5`, with matching declared
and locked versions. Vitest reported actual `5.0.0`, but its fixture did not
provide declared or lockfile versions. Node reported `24.20.0`; engine
declarations were unavailable in all three fixtures. Node test concurrency was
known from `--test-concurrency`, while its coverage collector remained
explicitly `unavailable`. Vitest test and coverage both reported the resolved
worker limit from project configuration, and Jest/Expo test and coverage both
reported the explicit `--runInBand` limit. The report has no separate
version-acquisition phase, so these values do not support a separate
acquisition-cost claim.

Median candidate-versus-baseline wall-time deltas were:

| Fixture | Workers | Progress on | Progress off |
| --- | ---: | ---: | ---: |
| Node workspace | 1 | +0.12% | −7.51% |
| Node workspace | 2 | +3.41% | −0.67% |
| Vitest | 1 | +4.98% | +10.26% |
| Vitest | 2 | −2.25% | +2.39% |
| Jest/Expo | 1 | +4.85% | +1.84% |
| Jest/Expo | 2 | +8.97% | −0.44% |

Progress-on versus progress-off medians ranged from −3.09% to +7.01% for the
candidate and from −3.95% to +5.68% for the baseline. Raw samples, ranges,
fixture/config hashes, artifact hashes and full retained semantic snapshots are
in [`outputs/diagnostics-overhead.json`](../../outputs/diagnostics-overhead.json).
These small fixed-fixture samples are noisy and fixture-specific; they do not
establish a production overhead bound or a general claim about diagnostics cost.

The matched Stryker Node workspace comparison is recorded in the [measured
report](../../outputs/stryker-node-comparison.md), with its [protocol](stryker-node-comparison.md)
and [JSON evidence](../../outputs/stryker-node-comparison.json).

### Installed Linux x64 release benchmark

The candidate-only [release benchmark protocol](release-benchmark.md) ran the
installed `seshat check --json` command 24 times across the same three fixtures
at workers 1 and 2, with replacement, normal progress and serial runner
commands. On the two-logical-CPU host, median harness wall time was 1,874.602
ms / 1,960.178 ms for Node, 9,215.511 ms / 9,646.675 ms for Vitest, and
19,426.972 ms / 25,464.283 ms for Jest/Expo at workers 1 / 2. The result is
fixture-specific evidence, not a production overhead bound. Raw runs, phase
timings, semantic hashes, artifact sizes and provenance are in the
[release benchmark report](../../outputs/release-benchmark.md) and
[JSON evidence](../../outputs/release-benchmark.json).

The separate [installed switching comparison protocol](installed-switching-comparison.md)
now records the matched candidate-only Node workspace matrix for replacement
and `--experimental-switching`, with its [measured report](../../outputs/installed-switching-comparison.md)
and [JSON evidence](../../outputs/installed-switching-comparison.json). The
measured switching median was 6.42% higher at workers 1 and 8.07% higher at
workers 2 on this fixed host and fixture; these results remain descriptive and
do not establish a production performance bound. The release report above
predates this separate comparison, so its earlier pending wording is historical.

The separate [installed Vitest switching comparison protocol](installed-vitest-switching-comparison.md)
records the same installed candidate through the existing Vitest React/Fastify
TSX fixture. Its [measured report](../../outputs/installed-vitest-switching-comparison.md)
and [JSON evidence](../../outputs/installed-vitest-switching-comparison.json)
retain the 24-run replacement/switching matrix. Switching medians were 10.17%
higher at workers 1 and 24.75% higher at workers 2 on this fixed fixture and
host. The build timing is reused from an earlier candidate measurement, and
phase timings overlap or nest under worker parallelism, so they are not additive.
These results are descriptive and do not establish a production performance
bound or a general claim about Vitest projects.

The separate [installed Jest/Expo switching comparison protocol](installed-jest-expo-switching-comparison.md)
records the same installed candidate through the existing Jest/Expo React TSX
fixture. Its [measured report](../../outputs/installed-jest-expo-switching-comparison.md)
and [JSON evidence](../../outputs/installed-jest-expo-switching-comparison.json)
retain the 24-run replacement/switching matrix with three killed mutants, one
survived mutant and a 75% mutation score. Switching’s worker-1 median was 5.56%
lower, while its worker-2 median was 2.33% higher; wall ranges were
20,221.173–36,334.171 ms for switching at worker 1 and
30,117.430–39,700.116 ms at worker 2, with replacement ranges of
20,302.937–26,634.058 ms and 27,246.927–49,863.655 ms. The build timing is
reused from an earlier candidate measurement, and phase timings overlap or nest
under worker parallelism, so they are not additive. The direction change and
broad ranges provide no dependable speedup claim.

Exit 0 means complete execution with no failed applicable threshold. Without
configured thresholds, surviving mutants and high CRAP do not fail the command.
Exit 1 means a complete run exceeded `thresholds.maxCrap` for a measured function
or fell below `thresholds.minMutationScore`; equality passes and valid scores
remain available. Thresholds never change which tests or sources are assessed.
Exit 2 means invalid input, execution failure, incomplete assurance or output
write failure. Handled cancellation exits 130 for SIGINT or 143 for SIGTERM,
retains available evidence and withholds the mutation score. Zero planned mutants
means a complete run with a null, not-applicable score, not 100%. That threshold
is not evaluated and does not fail CI. `crap` and `mutate` do not evaluate limits
for the other assessment. See the configuration guide for [threshold configuration and
JSON states](../../docs/configuration.md#quality-thresholds) and
[score interpretation](../../README.md#understanding-the-results).

The existing trusted-input, Linux and verified-runner restrictions still apply.
This is not a security sandbox. No cross-platform packaging, baseline reuse, cross-run caching,
automatic tuning or new runner compatibility claims are implied. The legacy
`seshat-proofs` commands still report measurements without enforcing thresholds.

## Local npm packaging proof

From the repository root, with the local Rust environment configured:

```sh
node packaging/pack.mjs work/debian11-inputs
SESHAT_PROOF_BINARY=/absolute/path/to/the/reported/proofBinary node benchmarks/proofs/npm-package.mjs /absolute/path/to/the/reported/package.tgz
```

Prepare `work/debian11-inputs` with the three pinned library archives using the
[package build instructions](../../packaging/README.md#build-and-verify-from-the-source-checkout).

Packing stages only an explicit file list in a fresh ignored directory. It does
not publish, modify either consuming application, install globally or add a
package-install hook. Cargo applies the release symbol-stripping and Linux
build-ID settings during linking; the resulting native binary is copied without
post-build rewriting, and the installed hash must match its recorded build
hash. The private package has no npm dependency tree beyond itself. Cargo
dependencies remain compiled into the native executable; see `BUILD.json` and
the bundled notices.

The regression installs the tarball offline into disposable single-package and
npm-workspace consumers, using a fresh npm cache. Its PATH contains only Node,
npm and a shell, and it checks that `cargo` and `rustc` cannot be found. It checks
the executable link, archive contents, binary hash, package-script/`npm exec`
invocation, exit-code propagation, offline `npm ci`, and npm's platform rejection.
Disposable control packages invert one OS/CPU/libc requirement at a time, because
npm 11's platform overrides do not apply to this required dependency. These
controls test metadata enforcement, not execution on those other platforms.

The standalone proof consumes the same npm `.tgz` bytes. It requires npm's
`package/` archive prefix, strips that prefix into a disposable consumer and
runs the binary without npm, preserving the same archive and `BUILD.json`
checks.

It then reruns all 42 CLI scenarios through the installed command by setting
`SESHAT_CLI_BINARY`, including real coverage/mutation work, thresholds, progress,
timeouts, SIGINT/SIGTERM, source preservation and cleanup. This reuses the fixture
compiler and coverage collector from the source checkout; it does not claim the
package installs or configures those consuming-project tools. Whole-command
timing samples in that suite now include the installed command path. npm's own
`exec`/script startup is checked separately and is not included in those samples.

See [packaging instructions and remaining limits](../../packaging/README.md).

The initial host-linked verification passed 16 packaging checks, including all 42 installed CLI
scenarios, on Node 24.20.0/npm 11.19.0/Linux x64/glibc 2.41. Two packs from the
same checkout and toolchain produced identical tarball bytes. The archive is
919,369 bytes; installed payload is 2,817,788 bytes, including a 2,319,936-byte
native executable and notices for 65 locked Cargo dependencies. That historical
candidate predates the current link-time stripping settings; the packer copied
its executable without post-build rewriting.
There are zero npm runtime dependencies. This does not establish reproducible
builds across hosts or compatible execution on older glibc.

Evidence: `work/npm-pack-gU8xqX/result.json`, `work/npm-pack-lQj27K/result.json`
and `work/assurance-proofs/npm-package-1K0W7M/result.json`. The installed CLI proof
retains its assessment reports under `work/assurance-proofs/cli-MB7XhE`.

## Linux library compatibility experiment

The host-linked candidate cannot start with Debian's glibc 2.31: the loader
rejects its newer version requirements, including 2.39. Weak references to
optional newer functions do not remove that loader requirement.

`linux-glibc.mjs` checks whether linking against older libraries is sufficient,
without changing Seshat's Rust code, adding Rust/npm dependencies or bundling libc.
It uses three fixed Debian archives, verifies their SHA-256 hashes, and extracts
them into a fresh ignored directory. Nothing is installed on the host.

With the existing local Rust environment and proof dependencies ready, obtain
the archives once, then run the offline experiment from the repository root:

```sh
SESHAT_GLIBC_ARCHIVES=$(mktemp -d "$PWD/work/glibc-archives-XXXXXX")
curl --max-time 60 -fSL https://deb.debian.org/debian/pool/main/g/glibc/libc6_2.31-13+deb11u11_amd64.deb -o "$SESHAT_GLIBC_ARCHIVES/libc6.deb"
curl --max-time 60 -fSL https://deb.debian.org/debian/pool/main/g/glibc/libc6-dev_2.31-13+deb11u11_amd64.deb -o "$SESHAT_GLIBC_ARCHIVES/libc6-dev.deb"
curl --max-time 60 -fSL https://deb.debian.org/debian/pool/main/g/gcc-10/libgcc-s1_10.2.1-6_amd64.deb -o "$SESHAT_GLIBC_ARCHIVES/libgcc-s1.deb"
node benchmarks/proofs/linux-glibc.mjs "$SESHAT_GLIBC_ARCHIVES"
```

Requires Linux x64, GCC, `dpkg-deb`, `readelf`, the locked Rust dependencies and
the original host-linked candidate as a negative control. The explicit Cargo
target confines the old-library link arguments to target code. Absolute links
inside the extracted development package are rewritten to stay inside it;
otherwise they can silently select host libraries. Build products use a separate
target directory, leaving the normal candidate and npm packaging unchanged.

The checks reject any GLIBC requirement newer than 2.31 and verify that the
older loader resolves every linked library inside the extracted directory.
They run all 42 CLI scenarios with the rebuilt binary on both old and host
libraries, plus the eleven parallel-worker scenarios on old libraries. A
proof-only `exec` wrapper selects the old loader while preserving the process
ID and signals; it is not an npm launcher or part of Seshat. The parallel proof
accepts `SESHAT_CLI_BINARY` when `SESHAT_PARALLEL_CLI=1`, just like the CLI proof.

This tests Seshat against older libraries on the **current host kernel**. Node,
the typechecker and test runners still use host libraries. It does not establish
an older-distribution/kernel support floor, glibc 2.30 execution, other CPU/OS
support or a performance improvement. A complete older Linux environment and
installed-package regression remain necessary before claiming release support.
The downloaded libraries are test inputs, not redistributable package contents.

Recorded verification: all 42 CLI scenarios passed with extracted glibc 2.31
and again with host glibc 2.41; all eleven older-library parallel scenarios
passed, including cancellation, deadlines and source-integrity failures. The
rebuilt executable's highest GLIBC requirement is 2.30, but execution on 2.30
has not been tested. Its size is 2,321,040 bytes, 1,104 bytes larger than the
host-linked candidate. Two fresh builds produced identical bytes on this host:
SHA-256 `92e5173443e787726b6843c729754bc1e95f499ae736bb2e894e251b87dea6c0`.
No Rust implementation or Cargo dependency change was needed. This experiment
left the default package build unchanged; the complete userspace verification
below subsequently established the package baseline. These are compatibility
results, not performance measurements.

Final evidence: `work/glibc-proof-7xQqmK/result.json`; the CLI reports are in
`work/assurance-proofs/cli-qK7Ukt` and `work/assurance-proofs/cli-AWzrWD`.
An earlier run under `work/glibc-proof-VFrJJZ/checks.json` passed the assessments
but failed the wrapper's final assertion because it expected the wrong parallel
completion message. That harness check was corrected before the final full run.

## Debian 11 installed-package verification

`linux-debian.mjs` verifies the npm package in a complete Debian 11 userspace.
Unlike the extracted-library experiment, Node, npm, TypeScript, the coverage
collector, test processes and Seshat all run with Debian's libraries. The
consumer has no Rust toolchain and no network access.

Prepare the three build archives and locked dependencies using the
[package build instructions](../../packaging/README.md#build-and-verify-from-the-source-checkout).
Also install Bubblewrap on the Linux x64 test host. Obtain these two runtime
archives once; the proof verifies their pinned SHA-256 hashes before extraction:

```sh
curl --max-time 120 -fSL https://raw.githubusercontent.com/debuerreotype/docker-debian-artifacts/bae6d64d90b4068b09ff9d8b564c2773ef5d8d83/bullseye/oci/blobs/rootfs.tar.gz -o work/debian11-inputs/rootfs.tar.gz
curl --max-time 120 -fSL https://nodejs.org/dist/v24.20.0/node-v24.20.0-linux-x64.tar.xz -o work/debian11-inputs/node.tar.xz
SESHAT_PACK_RESULT=work/debian11-inputs/package-result.json node packaging/pack.mjs work/debian11-inputs
cp "$(node --input-type=module -e 'import {readFileSync} from "node:fs"; console.log(JSON.parse(readFileSync("work/debian11-inputs/package-result.json")).standalone.path);')" \
  work/debian11-standalone.tar.gz
node benchmarks/proofs/linux-debian.mjs work/debian11-inputs work/debian11-inputs/package-result.json work/debian11-standalone.tar.gz
```

The standalone filename is retained for the existing proof interface; its
contents are the npm `.tgz` with the `package/` prefix. The proof strips that
prefix during extraction and checks that its bytes and hash equal the npm
payload.

The filesystem is the pinned [official Debian image artifact](https://github.com/debuerreotype/docker-debian-artifacts/tree/bae6d64d90b4068b09ff9d8b564c2773ef5d8d83/bullseye).
Node's archive hash comes from its [release checksums](https://nodejs.org/dist/v24.20.0/SHASUMS256.txt).
Downloads are separate from the offline build and verification commands.

The proof creates a fresh ignored directory, extracts Debian and Node, then
starts Bubblewrap with separate user, process and network namespaces. Its root
filesystem is Debian's, with read-only mounts for Node, the package and fixture
tools. Writable mounts contain only disposable home, temporary and proof files.
No host `/usr`, `/lib`, Node executable or Rust toolchain is mounted. The
separate legacy proof executable is built against the same Debian libraries
and mounted only for the existing CLI parity comparison.

The checks verify Debian 11, glibc 2.31, Node 24.20.0, npm, linked libraries and
the absence of `cargo` and `rustc`, then run:

- All 16 package checks, including offline install and `npm ci`, workspace
  installation, executable hashes, invocation and platform rejection.
- All 43 installed CLI scenarios plus legacy parity, including real typechecks,
  fresh coverage, mutation outcomes, thresholds, incomplete results, timeouts,
  SIGINT/SIGTERM, source preservation and cleanup.
- All 11 parallel-worker scenarios through that same installed executable,
  including one, two and four workers, worker capping, repeated outcomes,
  baseline/receipt/source failures, deadlines and cancellation. The controls
  check worker isolation, score withholding and termination of descendants.
- The generated standalone archive repeats the 43 CLI scenarios and all 11
  parallel-worker controls inside the same Debian 11 userspace.

The verified userspace baseline is **Linux x64 with glibc 2.31**, tested with
Debian's `libc6 2.31-13+deb11u14`, `libgcc-s1 10.2.1-6` and
`libstdc++6 10.2.1-6`. Build inputs use glibc `2.31-13+deb11u11` and GCC runtime
`10.2.1-6`. Both the compiler and coverage collector use TypeScript 6.0.3; the
test runner is Node 24.20.0's built-in runner. The proof records all these
versions, artifact hashes, raw CLI reports and parallel-worker evidence.

Only after this complete proof passed did the default packer adopt the pinned
older-library build. It rejects GLIBC symbol requirements above 2.31. The
executable's highest requirement is 2.30; that does not establish support for
glibc 2.30. There are no new Rust or npm runtime dependencies.

This is a userspace compatibility result on kernel
`6.12.107+deb13-cloud-amd64`. It does not verify Debian 11's original kernel or
establish a minimum kernel version. Other architectures and musl remain separate
release work. The bounded Jest/Expo and Vitest integrations are verified only
through the version-pinned fixtures described below. Timings are diagnostic
evidence, not performance claims.

Portable recorded evidence: [`outputs/linux-debian11.json`](../../outputs/linux-debian11.json).
Each run also retains its raw reports under the printed `work/debian11-*`
directory. Paths beginning `/seshat` belong to the isolated fixture environment.

The recorded archive is 920,507 bytes; its installed payload is 2,820,795 bytes,
including the 2,321,040-byte executable. Two packs of the same staged binary and
documentation produced identical tarballs. Two fresh native builds during this
historical work produced different executable hashes, although both passed the
Debian controls. That observation prompted the current link-time controls and
the bounded x64 reproducibility evidence in [the Linux x64 package protocol](../../docs/linux-x64-package.md).

## Coverage experiment

`coverage-subject.tsx` has hand-checked complexity and statement counts, including
nested functions, same-line arrows, default parameters, optional chaining, class
initialisers, an uncalled function and an empty function. TSX uses a local JSX
function, not React. Rust unit tests check UTF-16 columns against UTF-8 offsets.

Node/c8 and Jest execute TypeScript-transpiled CommonJS with inline source maps.
Jest uses Babel coverage instrumentation. Vitest loads the TSX source through its
normal loader and uses its V8 coverage provider. Each produces full Istanbul JSON
mapped to the original source. Collection includes a real passing test run.

Rust validates locations and statement ownership before computing the
statement-based CRAP variant. The script checks the expected Jest counts and
scores, compatible-report merging without double counting, and rejection of
missing, invalid or conflicting coverage. It deliberately records c8 and Vitest
as unsupported by this proof's attribution rules. These negative expectations
are assertions, so a changed provider needs review rather than silent acceptance.

## Mutation experiment

Rust generates 20 comparison mutants from `mutation-subject.tsx`. For each of
Node, Jest and Vitest, it compares isolated operator replacement with one prepared
switching build. Every mutant gets a fresh test process with its ID set before
imports. Both strategies first build and test the original source. Switching
also builds and tests its prepared source with no active mutant.

Replacement builds 21 times per sample; switching builds twice. Both use the
same TypeScript `transpileModule` command and test inputs. This build command
does not type-check. A separate strict check records that the original passes
and switched code fails because wrapping a comparison in a helper loses
TypeScript narrowing. The experiment does not work around that incompatibility.

Expected outcomes are fixed, not learned from whichever strategy runs first.
Mutants 12 and 17 survive. The other 18 are killed. Checks exercise all eight
comparison operators, equality boundaries, nested comparisons, import-time
initialisation, operand evaluation count and NaN. Controlled Node setup failures
and timeouts must return incomplete results without a final mutation percentage.

Timings include native process startup, preparation, all builds, baselines and
fresh runner processes. Strategies alternate order between samples; runners run
sequentially with one worker. Dependencies and the Rust release binary are built
before sampling. OS caches are not flushed. This measures one tiny fixture, not
language performance in isolation or a real application's speedup. Direct
TypeScript-loading replacement is measured separately in the follow-up below.

## Direct TypeScript-loading follow-up

After building the same Rust proof binary, run:

```sh
node benchmarks/proofs/direct-load.mjs
```

Use `SESHAT_PROOF_SAMPLES=1` for a short check. The default is three sequential
samples per runner and strategy. Results go to `outputs/direct-load-proofs.json`,
leaving the earlier explicit-build measurements intact. The script rotates runner
order and alternates strategy order. It uses the same 20 mutants and assertions.

For regression checks, set `SESHAT_PROOF_OUTPUT` to a new JSON path in an existing
scratch directory. This redirects the final report without overwriting the
recorded benchmark. The coverage-route follow-up accepts the same variable.

Each execution strictly type-checks its original source before either strategy
starts. Invalid original types stop execution. Mutants are then executed through
the runner's loader without a separate build or a mutant type-check. Switching
still has both original and prepared-code baselines. This does not repair its
TypeScript narrowing problem; it verifies separating original-source checking
from mutation execution on this fixture.

Node imports a `.ts` ESM copy using its built-in loader. Vitest imports the
`.tsx` source through its normal loader. Jest uses a small transformer calling
the already-installed TypeScript compiler on cache misses, with its transform
cache inside the disposable session. The compiler is imported only when that
callback runs. There are no additional dependencies or fake no-op build commands.
Zero builds means zero separate build processes, not zero loader transformations.

The mutation fixture contains no JSX or non-erasable TypeScript syntax. Node's
route therefore does not establish TSX or tsconfig-path support, and the Jest
transformer is not an Expo/Babel integration proof.
Every process still gets a fresh test runtime. Jest may reuse transformed code
within a session; no session cache is seeded from an earlier sample, and no test
results are reused.

The script checks identical outcomes, passing baselines, zero separate builds,
type-check rejection, controlled Node setup failures and timeouts for both
strategies, source hashes and session cleanup. Timings include the strict check;
the earlier explicit-build timings did not include that check. Neither experiment
includes coverage collection in its mutation timings.

See [the direct-loading findings](../../outputs/direct-load-proofs.md).

## Coverage-route follow-up

After the dependency installation and Rust build above, run:

```sh
node benchmarks/proofs/coverage-routes.mjs
```

This checks Node statement instrumentation, Jest/Babel and both Vitest providers.
Node, Jest and Vitest/Istanbul must match the hand-checked counts. Vitest/V8 must
remain incomplete because one mapped same-line arrow extends into the next
`export` declaration. The importer accepts explicit null end columns as line-end
bounds, not missing start coordinates, and permits only trailing semicolons,
spaces or tabs outside a function's range. It never trims over other code.

The script reuses the coverage fixture and adds a same-line Unicode statement
and a completely unloaded file inside its disposable project. The Node route
uses TypeScript source maps with existing Istanbul instrumentation and remapping
libraries. Its initial zero records come from actually instrumented files, not
assumed coverage for absent reports. Test completion is checked before consuming
runtime counters. The Node collector is limited to this one test file/process.

Checks cover expected complexity, statements, CRAP, empty and implicit scopes,
unloaded code, invalid locations/counters, ambiguous ends and report merging.
Results are written to `outputs/coverage-routes.json`; earlier benchmark results
are untouched. Generated sources and reports remain under ignored
`work/assurance-proofs/coverage-*` directories for inspection.

See the [coverage findings](../../outputs/coverage-routes.md) and the root
[coverage setup guidance](../../docs/configuration.md#coverage).

## Project capture and configuration

After building the native proof executable, run:

```sh
node benchmarks/proofs/capture.mjs
```

This creates a small workspace fixture, invokes the native `capture` command and
checks source scope, workspace links, unchanged original files, deterministic
analysis output, parse-error reporting and cleanup. It does not run configured
commands. Evidence stays under ignored `work/assurance-proofs/capture-check-*`;
earlier benchmark measurements are not overwritten.

The native command is:

```sh
benchmarks/rust/target/release/seshat-proofs capture /path/to/project/seshat.json /path/to/existing/scratch
```

The configuration file's directory is the project root. Scratch must exist outside
that project. The command creates its own private subdirectory and removes it
after inspection, including when a source file fails to parse. The JSON output
contains project-relative source paths, analysis facts, setup identities and
capture counts. `complete` here means capture/inspection completed, not that tests
passed or that assurance was established. Failed inspection exits with status 2.

This is the experimental capture/collection configuration for the installed CLI.
A single-package fixture uses:

```json
{
  "source": {
    "include": ["src/**/*.ts", "src/**/*.tsx"],
    "exclude": ["**/*.test.ts"]
  },
  "capture": ["package.json", "src", "tests"],
  "setups": [
    {
      "name": "unit",
      "runner": "node",
      "cwd": ".",
      "timeoutMs": 30000,
      "test": ["node", "--test", "--test-reporter={seshatReporter}", "tests/check.mjs"],
      "coverage": {
        "command": ["node", "coverage.mjs"],
        "report": "coverage/coverage-final.json"
      }
    }
  ]
}
```

The commands above illustrate argument arrays. Capture checks their shape but
does not check whether the executable, script or coverage provider is installed.
It neither runs them nor synthesizes a coverage collector. The existing coverage
proofs document the verified collection routes. The `collect` command
below runs these settings. `check` adds original type-checking and replacement
mutation testing by default. Pass `--experimental-switching` to `check` or
`mutate` for the helper-based experiment; original checks still run first.
Parallel mutation workers are opt-in below.

- `source.include` and `source.exclude` choose assessment source, not the files
  needed by tests. Patterns are case-sensitive and relative to the project root.
  `*` stays within a path component; `**` spans directories. `?` and character
  classes are also supported. Use separate entries instead of brace expansion or
  leading `!`. See the [glob pattern syntax](https://docs.rs/glob/0.3.3/glob/struct.Pattern.html).
  Hidden source files can match. `.git` and `node_modules` are never traversed for
  assessment source, and directory symlinks are not followed.
- Every include must match a file, and exclusions must leave at least one source.
  Selected files must be regular UTF-8 `.ts`, `.tsx`, `.mts` or `.cts` files. Exclude
  declaration files and tests explicitly. Selected file symlinks are rejected.
- `capture` contains literal files/directories, not glob patterns. Directories
  include all descendants except `.git`. List everything the configured tests
  need: source, tests, package/configuration files, generated data and installed
  dependencies. Tests excluded from assessment still belong in capture. Missing,
  duplicate and overlapping capture entries are errors. Selected source omitted
  from capture is an error rather than a smaller successful assessment.
- For a workspace, add its package directories to capture, add the relevant
  package source patterns, and capture both root and workspace-local dependencies
  where needed. The runnable fixture uses `packages` and `node_modules`, with an
  installed workspace link targeting `packages/rules`. Targets must also be
  captured. Internal links are rewritten into the copy; external, dangling or
  cyclic links are rejected. Hard-linked inputs become independent copied files.
- Setups have unique names and identify `node`, `jest` or `vitest`. `cwd` is
  project-relative and must exist as a directory in the copy. Coverage report
  paths are relative to that directory and must differ between setups. Commands
  are arrays, not shell strings; no shell interpolation is supplied.
- `timeoutMs` is a positive integer, default 30,000, applied separately to each
  typecheck, baseline, coverage and mutant job, not the entire assessment.
- Top-level `workers` is a positive integer, default `1`. It limits simultaneous
  mutant executions in `check`; it does not parallelise `collect` or the original
  typecheck/coverage jobs. See the parallel-worker instructions below.
- `typecheck` is an optional argument array for `collect`, required in every setup
  for `check`. When present, it runs against original source before that setup's
  baseline and coverage. It is never run against mutants by Seshat.

Unknown fields, duplicate JSON fields, wrong value types, parent traversal and
absolute paths in path settings are rejected. Paths use `/` separators. No
inheritance or executable config is accepted.

This Linux implementation uses trusted, quiescent input files. It is not an atomic
filesystem snapshot or protection against hostile concurrent edits. It does not
sandbox test access to external files, networks or databases. Copies retain
existing reports and caches as ordinary captured files; `collect` removes its
configured coverage output before collection. See the lifecycle proof below for
cancellation support and forced-termination limits. The fixture is self-contained;
other workspace layouts require their own integration checks.

Serde was already in the dependency tree and is now a direct dependency for typed
configuration. `glob` adds one package for pattern matching, without a custom
matcher or another Rust crate in this project.

## Captured-project collection

After the existing dependency/build steps, run the synthetic integration check:

```sh
node benchmarks/proofs/collection.mjs
```

To use a trusted project's configuration and existing scratch outside that project:

```sh
benchmarks/rust/target/release/seshat-proofs collect /path/to/project/seshat.json /path/to/existing/scratch
```

This Linux proof supports **Node 24.20.0**, with its built-in runner,
**Jest 29.7.0 / jest-expo 57.0.5**, or **Vitest 5.0.0** with Istanbul coverage.
Unsupported versions in receipts prevent assessment. Each setup
runs its baseline, then coverage, sequentially in the
copy. A configured typecheck runs before the setup's baseline. After a failed job,
later jobs remain `not-run`. Mutation execution and score thresholds are not part
of `collect`; use the experimental `check` below for combined assessment.

Use `{seshatReporter}` in baseline arguments as above. The coverage command must
run the same intended tests using the private reporter, preserve its environment,
then write full original-source-mapped Istanbul JSON. These variables are supplied:

| Variable | Meaning |
| --- | --- |
| `SESHAT_NODE_REPORTER` | Reporter path for the coverage subprocess's `--test-reporter` argument |
| `SESHAT_VITEST_RUNNER` | Private runner path for Vitest's `test.runner` configuration |
| `SESHAT_RECEIPT` | Fresh receipt destination, written by the reporter |
| `SESHAT_EXECUTION_ID` | Current job identity, recorded by the reporter |
| `SESHAT_SOURCES` | JSON file listing absolute assessment-source paths in the copy |
| `SESHAT_COVERAGE_REPORT` | Absolute output destination; coverage jobs only |

Inherited `NODE_OPTIONS`, `NODE_PATH` and `SESHAT_MUTANT_ID` are cleared. Node test
and coverage jobs receive Seshat's own `NODE_OPTIONS` preload for load-failure
observation. Other environment variables are inherited. Test identities are not
compared between commands.
The supplied `collect-node.mjs` is a fixture collector using already-installed
TypeScript/Istanbul libraries, not a distributed adapter. It instruments all
selected sources, including unloaded files, then merges actual test counters.

The configured report is removed inside the copy before collection. A fresh
regular report and a current runner receipt are required; exit 0 alone is not
enough. Links, linked parent directories and hard-linked outputs are rejected.
Coverage paths must identify regular files in the copy. Selected source bytes
are checked before and after each job. These checks detect accidental rewrites,
not malicious commands or concurrent changes.

Compatible statement maps merge across setups. A file missing from one setup may
be covered by another; missing from all reports means unknown. JSON includes
per-file scores, per-setup job states, `jobsAttempted` and per-job `ms`. Attempts
include preflight failures, not just spawned processes. `executionMs` covers
analysis, jobs and attribution, excluding capture and cleanup. Paths, job identities
and timing vary; source ordering and scoring are deterministic for the same evidence.

`complete: true` means required jobs passed and coverage attribution completed,
not that scores are good or code is defect-free. The fixture's complexity-2 function
scores 2 with full statement coverage, about 2.148 with 2/3 coverage; its untested
complexity-1 function scores 2. See the root README for interpretation. Failed runs
can retain earlier measurements, but stay incomplete and exit 2.

Output is capped at 2 MiB per stream, with at most 2,000 diagnostic characters;
each receipt/report is limited to 32 MiB. Timeout or overflow stops the owned Linux
process group, not children that deliberately detach. Normal and checked failure
paths remove the copy and receipts; cleanup errors make the run incomplete.
SIGINT/SIGTERM cancellation is covered by the lifecycle proof below; SIGKILL
cannot run cleanup.

The checks cover real coverage, merged setups, CRAP, missing/stale/malformed/unsafe
reports, replayed receipts, changed sources, failed tests, timeout, overflow and
cleanup. Evidence stays under ignored `work/assurance-proofs/collection-check-*`.
No consuming-project checkout is used and this step adds no dependencies.

## Captured-project check

The combined proof uses the same configuration and isolation rules as `collect`:

```sh
node benchmarks/proofs/check.mjs
node benchmarks/proofs/switching.mjs
benchmarks/rust/target/release/seshat-proofs check /path/to/project/seshat.json /path/to/existing/scratch
```

Add a `typecheck` command to **each** setup. For a package whose captured dependencies
include TypeScript and whose captured `tsconfig.json` selects its production source:

```json
"typecheck": ["node", "node_modules/typescript/bin/tsc", "--noEmit", "--project", "tsconfig.json"]
```

Paths in the command are relative to that setup's `cwd`. In a workspace, use the
correct relative path to its installed compiler. Capture the compiler, configuration
and referenced workspace inputs. Commands must finish rather than start a watcher;
configure the compiler to check all intended original source. The runnable fixture
uses the proof's installed TypeScript toolchain with explicit selected file arguments.
Seshat validates command shape and completion, not the contents of a compiler's scope.

All configured original checks, baselines and coverage collection must pass, and
CRAP attribution must be complete, before any mutant starts. The proof uses source
replacement by default, one worker by default, and fresh test processes. Every
setup runs for each mutant even when another setup has already detected it. A
setup timeout or execution
error leaves that mutant unresolved and stops scheduling new mutants. Already
running mutants finish their required setups unless cancelled. A test failure is a
kill only when all required setup executions resolve without infrastructure errors.

Pass `--experimental-switching` to prepare every selected source after those
original checks. The primary copy and each additional worker run an inactive
prepared baseline before mutant scheduling. Each mutant then selects its global
ID through `SESHAT_MUTANT_ID` while all prepared sources remain in place. The
report records prepared baseline rows and job counts separately from mutant jobs.
The helper transformation is a bounded experiment: it can lose TypeScript
narrowing and change reflection or source-text observations, and transformed
helpers are not typechecked.

Tests must load the copied source directly or transpile/rebuild it in their test
command without type-checking mutants. Running tests against stale build outputs
cannot assess source replacements. There is no separate build command or automatic
build-cache invalidation here. The fixture verifies module-initialisation comparisons
and a mutation that breaks TypeScript narrowing after the original passes validation.

Original source stays immutable in memory. Replacement execution allows exactly
one intended file edit, checks all selected source before/after jobs, and restores
it before the next mutant. Switching keeps all selected sources in a prepared
state, checks them before/after jobs, and clears the active mutant before the next
one. A rewritten source link is rejected during restoration, never followed. This
is still trusted-command isolation, not a sandbox for tests or external services.

The `mutation` JSON section includes each mutant's project-relative `path`, operator
offset, original/replacement operators, `localId` within its file and a run-wide `id`.
IDs follow source-path and operator order; the same source scope yields the same
definitions. Changing scope can change run-wide IDs. Each row retains every setup's
state, evidence and timing. Unstarted work remains `not-run` or `unassessed` when
baselines failed. Parse errors retain definitions from successfully parsed files;
they do not imply that the full mutant set was discovered.

The fixture has five mutants: three killed and two surviving, a 60% mutation score.
Two setups run for every mutant. A complete zero-mutant run has `score: null`, meaning
not applicable, not 100%. Any incomplete run withholds the final mutation percentage,
including restoration or cleanup failures, and exits 2. Earlier valid CRAP results
and resolved mutant counts remain visible. This legacy proof command does not
enforce quality thresholds.

`jobsAttempted` includes original setup jobs, mutant jobs and any worker or
prepared-baseline jobs. The mutation section reports its mutant job count and
extra baseline counts separately. This is a verified synthetic Node workflow, not
a whole-application integration. The checks preserve original
fixture files and write evidence under ignored `work/assurance-proofs/check-*`.
The focused switching fixture writes evidence under the corresponding
`switching-*` directory.

## Node load-failure evidence

Run the fast regression with:

```sh
node benchmarks/proofs/node-load-failure.mjs
```

Node's process-isolated test report replaces a crashed test file's exception with
a generic failure containing its exit code. That loses the distinction between
an application guard throwing during import and a broken test environment.

The bounded Node 24.20.0 adapter now observes the child process's built-in
`module.import` diagnostic and `uncaughtExceptionMonitor` event. It requires the
same exception object from the failed test entry import and the fatal event.
The error's first structured V8 call site must fall within a parser-identified
`throw new ...` expression in the active mutated source file, outside a `try`
statement. The thrown object must be an Error. This also handles custom Error
classes and application functions called while the test file loads.

The observer delegates to Node's original stack formatter and does not catch the
application exception, suppress termination, reload modules or rewrite source.
It is present during original baselines, coverage and mutant tests. Native code
creates per-job observation files without overwriting existing paths. The reporter
matches each fresh record to the current job, source location and exact crashed
test file before counting a failure. Mixed files with any unresolved crash still
make the mutant an execution error. `moduleFailures` retains the matched records.

Thirteen controls cover guards, called guards/custom errors, Unicode/CRLF and
paths with spaces, alongside setup throws, direct exits, missing imports, reused
or caught errors, background failures, custom stacks, primitive throws and mixed
files. The original failure is locked down through the native executor, not just
a fabricated reporter event.

This is deliberately narrower than general exception attribution. Implicit
runtime errors during import, errors from other files, preformatted/custom stacks,
throws inside `try`, primitive throws, CommonJS startup and unverified Node versions
remain unresolved. Bare-CR and Unicode line-separator source positions are not
accepted by this observation path. The verified route uses Node's default process
isolation; alternate runner isolation/loader configurations are not certified.
Do not replace missing evidence with stack-text matching or a generic exit-1 kill.

## Jest/Expo combined workflow

The checked-in fixture at `fixtures/jest-expo` is a small Expo TSX project with
no application checkout or private input. It was tested with Node 24.20.0; its
lockfile pins Jest 29.7.0, jest-expo 57.0.5, Expo 57.0.20, React Native 0.86.3,
`@react-native/jest-preset` 0.86.3, `babel-preset-expo` 57.0.10, React 19.2.3
and TypeScript 6.0.3. Jest runs with its `jest-expo` preset and `--runInBand`;
coverage uses Babel instrumentation and writes full Istanbul JSON.

Run the reusable installed-command driver from the repository root after building
or obtaining a local Seshat package:

```sh
node benchmarks/proofs/jest-expo-check.mjs \
  --tarball /absolute/path/to/binary-balance-seshat-0.0.0.tgz
```

The driver installs the fixture's pinned lockfile into a fresh ignored proof
directory when `--deps` is omitted. To reuse a prepared dependency directory,
install the fixture once and pass it explicitly:

```sh
mkdir -p work/jest-expo-fixture
cp benchmarks/proofs/fixtures/jest-expo/package.json \
  benchmarks/proofs/fixtures/jest-expo/package-lock.json work/jest-expo-fixture/
npm ci --prefix work/jest-expo-fixture --ignore-scripts --no-audit --no-fund
node benchmarks/proofs/jest-expo-check.mjs \
  --tarball /absolute/path/to/binary-balance-seshat-0.0.0.tgz \
  --deps work/jest-expo-fixture
```

`--cli /absolute/path/to/node_modules/.bin/seshat` runs the same checks against
an installed executable. The driver records the candidate version and SHA-256
hashes, checks each expected exit status and verdict, compares a repeated run,
and checks both one and two Seshat workers. A focused invocation accepts a comma
separated `--cases` list; `normal-repeat` and `normal-2` automatically include
their `normal-1` prerequisite.

The normal fixture has three tests and three fully covered functions. Its hand
count is `classify` CRAP 2, `isPositive` CRAP 1 and `statusCard` CRAP 1. Four
comparison mutants produce three kills and one intentional boundary survivor,
for a 75% score, with the same result for one and two workers and on repeat.
The assertion-kill and survivor controls produce 100% and 0% respectively.
Setup and cleanup failures (`beforeAll`, `beforeEach`, `afterEach` and mixed
assertion plus cleanup), import failure, test and hook timeouts, missing event
observations, missing receipts and retry controls all produce the expected
unresolved verdict or baseline failure. Those runs exit 2 and withhold the
mutation score. The eventually-passing retry is retained as an execution error
because its receipt does not prove the complete retry sequence.

Every case snapshots the checked-in fixture and generated control inputs before
execution, verifies their bytes afterward and requires an empty Seshat scratch
directory. Full JSON evidence remains under ignored
`work/assurance-proofs/jest-expo-check-*`; paths in the recorded result are
portable relative paths. Dependency copies may be removed after preserving the
result and generated config/source evidence.

This verifies one Jest project using Jest Circus, the default `jest-expo`
environment, `{seshatReporter}`, `{seshatEnvironment}` and `--runInBand`.
Custom Jest runners, environments, projects and Jest-internal concurrency are
outside this claim. Seshat worker isolation is covered at limits one and two;
other worker counts, browser mode and other Jest/Expo versions require separate
evidence. The [configuration guide](../../docs/configuration.md#jestexpo-example)
contains the matching setup.

The compatibility evidence is summarized here; each linked JSON is portable and
contains the exact runner reports and configuration scope used for that route.

| Route | Tested versions | Configuration exercised | Evidence |
| --- | --- | --- | --- |
| Node | Node 24.20.0 | Built-in test runner with the verified Istanbul statement collector | [`linux-debian11.json`](../../outputs/linux-debian11.json) (installed candidate); [`bounded-proofs.json`](../../outputs/bounded-proofs.json) (fixture) |
| Jest/Expo | Node 24.20.0, Jest 29.7.0, jest-expo 57.0.5, Expo 57.0.20 | Jest Circus, `jest-expo` preset, Babel coverage, `--runInBand`, Seshat workers 1 and 2 | [`jest-expo-check.json`](../../outputs/jest-expo-check.json) |
| Vitest | Node 24.20.0, Vitest 5.0.0, `@vitest/coverage-istanbul` 5.0.0 | Private `TestRunner` and reporter, Node environment, fork pool, Istanbul coverage and sequential runner tests | [`vitest-check.json`](../../outputs/vitest-check.json) (worker 1); [`vitest-installed-check.json`](../../outputs/vitest-installed-check.json) (installed CLI, worker 2) |

## Vitest combined workflow

Build the native executable and run the checked-in fixture through `check`:

```sh
node benchmarks/proofs/vitest-check.mjs
```

The driver reads `fixtures/vitest`, copies its installed proof dependencies and
compares results with hand-counted expectations. It needs no external application
checkout or retained output from an earlier run. Rust captures its own execution
copy; the driver checks unchanged fixture bytes and empty scratch directories.

To exercise an installed native candidate, supply its package or executable and
reuse a prepared dependency directory. The package path is installed offline;
the dependency directory is never resolved or downloaded during the proof:

```sh
node benchmarks/proofs/vitest-check.mjs \
  --tarball /absolute/path/to/binary-balance-seshat-0.0.0.tgz \
  --deps /absolute/path/to/vitest-dependencies
```

Use `--cli /absolute/path/to/node_modules/.bin/seshat` for an already installed
candidate. Both installed and legacy modes accept `--cases` (or
`SESHAT_VITEST_CHECK_CASES`) for a focused run. The installed result records the
candidate version and hashes, each report/check count, source preservation and
the empty scratch-directory check.

CRAP and mutation testing select `tempo.ts`, `view.tsx` and `server.ts` and run the
same three tests. This covers strict TypeScript, ESM, React server rendering,
Fastify request injection and TypeBox validation. All ten measured function
statements run, the four function scores match their expected values, and all
four comparison mutants are killed. No browser, database or cloud service is used.

Use `runner: "vitest"` in `seshat.json`. Merge this setting into the project's
existing Vitest `test` configuration:

```js
runner: process.env.SESHAT_VITEST_RUNNER,
```

Without Seshat's environment variable, ordinary Vitest runs use the default runner.
This integration extends Vitest 5's `TestRunner`; it does not compose with another
custom runner. Use both private runner and reporter for baseline, coverage and
mutation execution. The fixture's `test` argument array is:

```json
["node", "node_modules/vitest/vitest.mjs", "run", "--config", "vitest.config.mjs",
 "--maxWorkers=1", "--no-file-parallelism", "--maxConcurrency=1",
 "--reporter=default", "--reporter={seshatReporter}"]
```

Use the actual captured executable location. Add `--coverage` for
`coverage.command`. The verified pair is `vitest@5.0.0` and
`@vitest/coverage-istanbul@5.0.0`, with these coverage settings merged into `test`:

```js
coverage: {
  provider: 'istanbul',
  include: ['tempo.ts', 'view.tsx', 'server.ts'],
  reporter: ['json'],
  reportsDirectory: 'coverage',
},
```

Set `coverage.report` to `coverage/coverage-final.json`, provide original
TypeScript validation, and capture configuration, tests, source, workspace inputs
and required dependencies. Do not change to V8 coverage to improve timings; its
known mapping limitations still apply.

The runner invokes Vitest's existing wrapped callback, preserving fixture and
timeout handling, and records error identity fields before cleanup. The reporter
compares that evidence with the final result. Hook failures before the callback,
additional cleanup failures, import failures and unhandled errors cannot become
kills. Tests of returned cleanup callbacks, around-hook cleanup, mixed failures
and assertion-count checks cover this distinction. Internal test/hook timeouts
use the verified version's diagnostic and remain unresolved timeouts.

This proof verifies the default Node environment and fork pool with sequential
tests. Retries, repeats, expected-failure tests and concurrent test declarations
are rejected through observation rather than used to produce a preferred result.
Skipped or unfinished tests leave incomplete evidence. Other pools, custom runners,
browser mode and broader versions still need verification.

For hosts with short command limits, run the same cases in batches:

```sh
SESHAT_VITEST_CHECK_CASES=stack,assertion,survived node benchmarks/proofs/vitest-check.mjs
SESHAT_VITEST_CHECK_CASES=before-all,before-each,after-each,cleanup,mixed,clean-hooks,assertion-count node benchmarks/proofs/vitest-check.mjs
SESHAT_VITEST_CHECK_CASES=timeout,hook-timeout,import-error,unhandled,around-each,missing-runner node benchmarks/proofs/vitest-check.mjs
SESHAT_VITEST_CHECK_CASES=retry,repeat,expected-failure,concurrent node benchmarks/proofs/vitest-check.mjs
```

Results remain under ignored `work/assurance-proofs/vitest-check-*`. Wall times
include native capture, validation, baseline, coverage, mutations and cleanup,
but exclude preliminary fixture staging. These correctness runs are not repeated
performance benchmarks.

## Parallel mutation workers

Set a top-level limit in the experimental `seshat.json`:

```json
"workers": 2
```

The default remains one. The effective limit cannot exceed the planned mutant
count; a no-mutant run creates no mutation workers. Each worker runs one mutant
at a time and all of its setups sequentially, with fresh test processes. A free
worker takes the next planned mutant without waiting for slower workers. Results
are returned in planned order, not completion order. Error/cancellation timing
can change which later mutants started, but every planned row remains visible.

Each additional worker gets an independent copy of the checked original-source
execution directory, including generated files, with internal links rewritten
into that copy. No source or writable dependency/cache file is hard-linked across
workers. Analysis facts are shared in memory. Copying reuses the existing capture
validation; links escaping the copy are rejected. Seshat does not reread the
developer's checkout to create workers.

Before any mutants start, every additional copy must pass all configured test
baselines. Their receipts are independent and included in the result. Original
typechecking and coverage still run once per setup. Failed worker preparation or
baselines prevent mutation execution; failed restoration or cleanup withholds the
score. SIGINT/SIGTERM stop active owned job groups across workers and retain
partial results. A worker error stops new scheduling while other active mutants
finish; an assertion failure alone does not stop scheduling.

With `--experimental-switching`, each additional copy receives every prepared
source before its baseline. The primary copy runs the same inactive prepared
baseline, and all of these rows remain separate from the original baselines and
mutant jobs. A failed or incomplete prepared baseline prevents mutant execution
and withholds the score.

Parallelism is safe only when the tests isolate their external resources. Use
temporary paths within each copy, dynamically allocated ports, and separate test
databases where needed. Copies do not isolate fixed ports, absolute filenames,
services or credentials. Keep runner concurrency explicit: Node tests can use
`--test-concurrency=1`, Jest `--runInBand`, and the verified Vitest configuration
above uses one worker and disables file parallelism. Seshat does not rewrite
runner commands or silently choose concurrency settings for a project.

The mutation JSON adds `workersRequested`, `workersUsed`, `workerBaselines`,
`workerBaselineJobs`, `workerPreparationMs` and `mutationWallMs`. Switching adds
`preparedBaselines`, `preparedBaselineJobs`, `switchPreparationMs` and
`preparedBaselineMs`. Preparation covers additional copies, receipts and
baseline jobs; mutation wall time covers the scheduler through joining workers,
not that preparation or final cleanup.
`mutation.executionMs` includes both and additional-worker cleanup. Per-job `ms`
values overlap under parallelism and must not be added to estimate wall time.
Top-level `jobsAttempted` includes additional baselines; mutation `jobsAttempted`
continues to count only mutant test jobs. Copy/baseline overhead can outweigh the
saving on a small workload. Benchmark the complete command, not just its mutants.

The implementation uses scoped standard-library threads and a bounded work
index, without a thread-pool dependency or persistent JavaScript test workers.
Additional copies/baselines are prepared sequentially before mutation scheduling;
parallelising that preparation needs its own measured benefit.

Run the correctness cases after the existing build/dependency steps:

```sh
SESHAT_PARALLEL_CASES=serial,parallel,repeat,four,capped node benchmarks/proofs/parallel.mjs
SESHAT_PARALLEL_CASES=worker-baseline-error,receipt-error,source-error,timeout,SIGINT,SIGTERM node benchmarks/proofs/parallel.mjs
```

Eleven scenarios check identical CRAP/verdicts at one, two and four workers,
repeatability, clamping a limit of twenty to four mutants, overlapping execution,
independent writable files/receipts, failed baselines, missing receipts, changed
source, timeouts and cancellation of two active job groups with descendants.
The overlap fixture deliberately waits 400 ms in each mutant job; its timings
are not a consuming-project performance claim. Rust tests also check independent
worker files and rewritten workspace links.

For a parallel Vitest regression, run the checked-in fixture with two workers:

```sh
SESHAT_CHECK_WORKERS=2 SESHAT_VITEST_CHECK_CASES=stack,assertion,before-all node benchmarks/proofs/vitest-check.mjs
```

Each run checks the same hand-counted function results and mutant verdicts.
The Jest/Expo fixture above uses the same installed-command and source-preservation
proof pattern with its runner-specific environment and coverage configuration.

## Cancellation and process cleanup

After building the native proof and installing its existing Node dependencies:

```sh
node benchmarks/proofs/lifecycle.mjs
# Also demonstrate the limits of an uncatchable kill:
SESHAT_LIFECYCLE_SIGNALS=SIGKILL node benchmarks/proofs/lifecycle.mjs
```

The Linux regression sends SIGINT and SIGTERM during original typechecking,
baseline tests, coverage collection and mutation execution. Each hanging job has
a descendant, both deliberately ignoring those signals. Seshat stops their owned
process group with SIGKILL, waits for its direct child, and removes the captured
copy and receipts. An unrelated process and the original source remain unchanged.
Three further controls exercise deadline expiry, output overflow and a leader
that exits while its descendant still holds the output pipe open.

Cancellation returns JSON with `complete: false`, `cancelled: true` and the signal
number, then exits 130 for SIGINT or 143 for SIGTERM. The interrupted job is
`cancelled`; unstarted setups and mutants remain `not-run`. Earlier measurements
remain visible, but no complete mutation score is returned. The regression
cancels the second setup of the second mutant: the earlier survivor remains,
the first setup's assertion failure stays visible, cancellation prevents a kill
verdict, and the third setup and later mutants never run. Before all baselines
pass, mutant verdicts remain `unassessed` as before.

The original failure was default signal termination bypassing Rust cleanup.
`signal-hook` now records the signal in an atomic flag; the existing executor
checks it and handles scheduling, cleanup and reporting outside the signal
handler. This adds `signal-hook` and an explicit `libc` dependency for checked
process-group signalling, not a separate supervisor or a cancellation framework.

These guarantees cover the captured `capture`/`collect`/`check` path, not the
earlier single-fixture `execute` experiment. Capture checks cancellation between
filesystem entries; an in-progress file copy, source analysis or filesystem
cleanup can delay its response. The process regression exercises running jobs,
not worst-case copy latency. Children that deliberately leave their process group
are outside this proof; it does not establish Windows/macOS supervision or sandbox
hostile tests. Run it where ordinary Node child processes are permitted.

SIGKILL, host failure and power loss cannot execute a signal handler or cleanup.
The explicit SIGKILL control confirms that the owned test processes and temporary
copy can remain. The harness then kills only its recorded fixture group; the
abandoned copy and results stay in its unique, ignored
`work/assurance-proofs/lifecycle-*` directory for inspection. No automatic sweep
of a shared scratch directory is attempted. The original checkout never needs
restoration. Recorded stop times include a 100 ms observation pause and are
correctness evidence, not performance benchmarks.

## Deliberate limits

The original mutation proof uses one fixture file and one setup. The captured
project checks cover multiple Node setups, and the checked-in Vitest fixture adds
React TSX, Fastify and TypeBox. The Jest/Expo fixture covers an Expo TSX route
with the pinned versions above. These checks do not establish Windows/macOS
supervision, isolation of external resources or general JavaScript transformation
equivalence.

The original `execute` proof and the captured-project CLI have different execution
contracts. Only the latter supplies the configured multi-setup workflow, bounded
parallel workers and cancellation checks described above. Keep results tied to
the command, fixture and runner versions that produced them.

The [release scope](../../docs/release-scope.md) and
[GitHub Issues](https://github.com/Binary-Balance/seshat/issues) track remaining work.
