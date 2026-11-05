# Rust self-assessment baseline

The [findings follow-up](rust-self-assessment-follow-up.md) validates the pilot
survivors, strengthens confirmed test gaps and records architecture decisions.

Issue [#270](https://github.com/Binary-Balance/seshat/issues/270) establishes
an advisory baseline for Seshat's own Rust code before
[#186](https://github.com/Binary-Balance/seshat/issues/186). This is a Linux x64
measurement, not a release-platform proof or an overall quality score.

## Measurement rules

- Rust 1.98.1 stays unchanged. `cargo-llvm-cov` 0.9.1 instruments the existing
  tests and CLI binaries. Both native tests and the explicitly selected external
  proofs contribute to the combined report.
- `cargo-crap` 0.9.0 uses **line coverage**, not Seshat's branch coverage with
  statement fallback. Its scores are not directly comparable with Seshat's
  TypeScript scores. Nightly Rust is not required for this baseline.
- The scorer starts complexity at one, counts every match arm and each `?`,
  and does not fold closure bodies into the enclosing function. These are the
  [tool's conventions](https://github.com/minikin/cargo-crap/blob/v0.9.0/docs/reference/complexity.md),
  not a language-independent measure. Closure-heavy and macro-generated code
  still needs review.
- Test functions and exact `#[cfg(test)]` modules are excluded by the scorer.
  LLVM's file totals can include inline tests, so no repository-wide coverage
  percentage is presented as production coverage.
- Missing coverage is retained in `summary.json` with each function's identity
  and complexity. Those functions have no measured CRAP score. They are omitted
  from the measured-only `*-crap.json` files; the scorer's pessimistic estimates
  for unknown coverage are not presented as measurements. This includes Windows
  implementation and helper code that this host cannot measure.
- Thirty is a reporting reference, not a new CI threshold. Collection fails
  when a test/proof fails, coverage/report generation fails, or the mutation
  pilot times out or lacks a passing baseline. Findings do not fail this
  advisory collection.

## Results

At source `5397633675ca3f715053b0500c7d053995e7080b`, all 194 Rust tests and
the bounded external proofs passed. Of 318 functions found by the scorer,
288 have measured line coverage and 30 remain unmeasured. Eleven measured
functions exceed the reference CRAP value of 30.

| Function | Complexity | Combined line coverage | CRAP |
| --- | ---: | ---: | ---: |
| `Analysis::enter_node` | 200 | 98.95% | 200.05 |
| `cli::readable` | 77 | 98.22% | 77.03 |
| proof-command `run` | 35 | 73.91% | 56.75 |
| `CapturedProject::run_job` | 44 | 93.43% | 44.55 |
| coverage `attribute` | 38 | 95.98% | 38.09 |

The exploratory batch and the subsequent scripted batch produced identical
combined coverage values for every measured function. These two samples do not
establish that coverage or timings are invariant across all executions.

## Repeat collection

Install the pinned tools, ensure Cargo is on `PATH`, and fetch the existing
locked dependencies from the repository root:

```sh
cargo install --locked --version 0.9.1 cargo-llvm-cov
cargo install --locked --version 0.9.0 cargo-crap
cargo install --locked --version 27.1.0 cargo-mutants
rustup component add llvm-tools-preview --toolchain 1.98.1
cargo fetch --locked --manifest-path crates/seshat/Cargo.toml
npm ci --prefix benchmarks --ignore-scripts --no-audit --no-fund
npm ci --prefix benchmarks/proofs --ignore-scripts --no-audit --no-fund
npm ci --prefix benchmarks/proofs/fixtures/jest-expo --ignore-scripts --no-audit --no-fund
bash benchmarks/proofs/rust-self-assessment.sh
```

The collector requires Rust 1.98.1 and the supported Node 24 runtime. It prints
the evidence directory. An optional argument selects a new output directory;
an existing directory is rejected. Profiles and builds stay beneath that run's
directory, so stale LLVM profiles cannot inflate the result. Budget several
GiB for compilation, runner copies and profiles. No dependencies are added to
the Seshat crate.

The initial run used checksum-verified prebuilt Linux x64 tools instead of
building the tools from source:

| Tool | Release | Archive SHA-256 |
| --- | --- | --- |
| cargo-llvm-cov | 0.9.1 | `b3f68e625481fed9b16444174f3fa5ebcdbde4a1878803a35eabe2dcefcdc41a` |
| cargo-crap | 0.9.0 | `5355bfa78ba5bf57e52e125f9dfe3573155796267d3b54660ae1c0225916d603` |
| cargo-mutants | 27.1.0 | `dfe6dc37d0342c891d2829b5a695aa57c2d0edecef7e7d0399a30cc6e206411e` |

Coverage export follows
[cargo-llvm-cov's external-test procedure](https://github.com/taiki-e/cargo-llvm-cov#get-coverage-of-external-tests).
The existing binaries run under `LLVM_PROFILE_FILE`; JavaScript assertions
themselves are not Rust coverage. Abruptly terminated processes may not flush
their profiles. Missing observations must not be interpreted as covered code.

## Scope and retained evidence

The collector runs all existing Rust tests, all 85 CLI scenarios plus legacy
parity, and these bounded external cases:

- Vitest: `stack,assertion,survived,cleanup,concurrent,import-error,timeout,hook-timeout`.
- Jest/Expo: `normal-1,assertion-kill,survivor,after-each,automatic-cleanup,import-failure,test-timeout,hook-timeout`.
- Test selection: `normal,module,hooks,missing,filter,cleanup`.

These selections supplement the native tests; they are not the full release
proof matrix. A proof expecting an incomplete Seshat assessment still passes
only when its existing assertions confirm the intended conservative result.

The retained [summary](../../outputs/rust-self-assessment/summary.json) records
the source revision and hashes, actual tool/runtime versions, measured and
unmeasured scope, test counts and pilot outcome counts. The two LCOV files and
measured-only CRAP reports preserve native-test and combined evidence
separately. Paths are portable. Logs retain the proof results.

To regenerate the measured combined scores from the retained LCOV at the
recorded source revision:

```sh
cargo crap --path crates/seshat \
  --lcov outputs/rust-self-assessment/combined.lcov \
  --missing skip --no-cache --format json --sort file
```

The collector checks every measured score against the CRAP formula and checks
the hand-counted `assessment::score` reference: complexity four, full line
coverage, CRAP four. It retains every excluded function's identity separately.

## Mutation pilot

The collector copies `assessment.rs` byte for byte into a disposable,
dependency-free library and runs all mutants generated by `cargo-mutants`
27.1.0 against that file's own tests. It verifies the source-copy hash and
retains the passing baseline and individual
[outcomes](../../outputs/rust-self-assessment/mutation-outcomes.json).

This is deliberately a policy-test pilot: caller tests, runner proofs and the
rest of Seshat are excluded. A survivor establishes only that these local tests
miss the change. It does not establish a whole-crate test gap or an equivalent
mutant. No repository mutation percentage is reported. `Unviable` means the
mutation could not compile and is separate from a detected mutation.

The pilot generated 76 mutants: 73 were caught, two survived and one was
unviable. Both survivors replace `TestState::label` with a constant string.
The pilot excludes caller tests, so confirm them against the full crate before
filing either as a test gap.

## Architecture findings

The independent survey used recent changes, the baseline, #186 and the existing
ADRs. The existing `Analysis` and `SetupEvidence` modules hide substantial
behaviour behind small interfaces. File length, especially inline test length,
does not establish that either should be split.

**Selected attempt and fallback — worth exploring.**
`collection.rs` currently coordinates selection, execution, receipt
confirmation, full-command retry, diagnostic retention and job counting inside
`run_mutant`. A private module could own that complete protocol while mutation
preparation, restoration and setup ordering remain with their current owner.
This earns a seam only if callers need fewer facts and protocol tests become
simpler; moving the retry block into a pass-through helper would not help.
There is one production caller today. Consider this alongside #186, not as a
prerequisite rewrite. Preserve the real-process timeout and runner proofs.

**Istanbul counter observation — speculative.**
The Vitest runner contains substantial counter-integrity rules but imports
Vitest even for tests that need only those rules. If the Jest attribution proof
needs the same observation behaviour, place it behind a runner-neutral
interface. Keep lifecycle timing and receipt delivery in each actual runner
adapter, and source attribution in Rust. Do not force Node into the same shape
or introduce a generic instrumentation framework before reuse is demonstrated.

ADR-0004 predates the whole-file selection shipped under #181. Its original
full-command wording describes that earlier stage; preserve its fresh-process
decision and do not confuse #186 with persistent workers or individual-test
selection.

The high-complexity AST visitor is not an additional refactoring recommendation.
Much of its complexity is grammar dispatch behind `Analysis::inspect`; dividing
it into helpers could merely move complexity without improving depth or
locality. Its line coverage also does not establish branch coverage or mutation
resistance.

**Recommendation:** proceed with #186 through the existing selection module and
concrete verified runner adapters. Choose any refactor after reviewing its
specific testing benefit. Before adding CI quality gates, agree scope and
thresholds, resolve missing coverage and scorer limitations, and check how the
proposed gate handles new functions as well as existing regressions.
