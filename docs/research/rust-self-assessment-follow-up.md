# Self-assessment findings: validation and disposition

This follows [#272](https://github.com/Binary-Balance/seshat/issues/272) and the
[baseline](rust-self-assessment.md), merged in
`4081ba2d25b1065a300b10caa292a0d3aa3c0a66`. Production behaviour is unchanged.
The changes strengthen tests and record which findings justify further work.

## The isolated survivors are already detected by the crate

Both `TestState::label` constant replacements are caught by existing callers'
tests. A full-crate `cargo-mutants` run passed its unmodified baseline and
reported two caught mutants. Among the failing assertions are the collection
original-job failure, cleanup, worker-baseline and unconfirmed-selection tests.
No additional label test is justified merely to make the isolated pilot green.

This run uses all 194 existing Rust tests. The external JavaScript proof suites
are not needed to establish that these two changes are already detected.
The [individual outcomes](../../outputs/rust-self-assessment-follow-up/full-crate-mutants.json)
and their logs are retained, including the passing baseline. This remains a
bounded verification of two mutants, not a repository mutation score.

## Confirmed test improvements

- Original typecheck, build and test failures, and prepared build/test failures,
  now have explicit phase, incomplete-result and stopping assertions. A command
  trace checks all eight applicable replacement/switching cases and proves no
  mutant command starts after a failed prerequisite.
- A selected attempt whose test identities cannot be confirmed must preserve
  `requestedFiles` and `selectedAttempt`, then count exactly two attempted jobs.
  The native retry-deadline test checks the successful selected attempt's
  evidence alongside the full retry's timeout. The real Vitest substring-filter
  proof checks retained expanded-workload identities and the two-job count;
  Linux x64 CI now includes that filter case.
- A non-empty function cannot gain coverage from an empty or reversed statement
  span. The new test checks a valid mapping as a control, then requires both bad
  mappings to leave coverage and CRAP unknown.

These assertions detect controlled regressions that the corresponding original
test selections missed:

| Deliberate regression | Original test selection | Strengthened test selection |
| --- | --- | --- |
| Return `complete: true` after a failed original typecheck | Passes | Fails |
| Omit the full retry from the attempted-job count | Passes | Fails |
| Remove rejection of empty/reversed statement spans | Passes | Fails |

The [summary](../../outputs/rust-self-assessment-follow-up/summary.json),
[commands and exits](../../outputs/rust-self-assessment-follow-up/controlled-regressions.json),
source patches and individual logs preserve these checks. Exit 101 is expected
only for the deliberately regressed, strengthened test selections; their logs
show assertion failures, not compilation failures. The clean full suite passes
196 tests: 181 native tests, three CLI-output tests and 12 proof-input tests.
The focused Vitest filter, runner-timeout, job-deadline and cleanup proofs pass.

The retained follow-up coverage is **native-test coverage only**. Compare it
with baseline `unit-crap.json`, not the baseline's expanded combined report.
The runtime source is unchanged; additional tests expand the measured workload.
All measured scores reproduce from the portable LCOV. Unknown functions remain
explicit. There is no new CRAP threshold or performance claim.

## Original hotspot dispositions

The reference value of 30 identified these eleven functions in the combined
baseline. Complexity alone already exceeds 30 for nine of them; full coverage
cannot make those nine fall below that value under this scorer's convention.

| Function | Disposition |
| --- | --- |
| `analysis.rs`: `Analysis::enter_node` | Retain. Much of its complexity is grammar dispatch behind an existing small interface. Uncovered syntax alternatives and defensive paths remain visible; splitting shared visitor state merely to change the number is not justified. |
| `analysis.rs`: `Analysis::inspect_with_operators` | Retain. Parsing, ownership, suppression and stable mutation ordering belong together. Remaining recovery/comment guards need targeted cases when those behaviours change. |
| `cli.rs`: `readable` | Retain; focus future tests on missing/cancelled diagnostic shapes when formatting changes. The combined baseline already includes 85 CLI scenarios; high complexity does not establish a current display defect. |
| `coverage.rs`: `attribute` | Add the malformed statement-span contract test above. Keep existing source-location and incompatible-report checks; remaining defensive branch combinations are not declared covered. |
| `execution.rs`: `Session::capture` | Retain. Remaining path/source-validation and filesystem-error paths are proof-session checks. No capture defect was demonstrated; these remain candidates for focused invalid-input tests, not a structural extraction. |
| `execution.rs`: `Session::command` | The new prerequisite-failure cases exercise failed test/build evidence. Keep cancellation, source-observer and artifact-I/O guards; their remaining combinations are not a reason to weaken validation. |
| `execution.rs`: `Session::execute` | Add explicit original/prepared failure-phase and stopping tests. Keep the existing session interface. Remaining cancellation/build-error combinations stay visible. |
| `execution/project.rs`: `Config::parse` | Retain validation at capture entry. Remaining literal-capture and mutant-limit rejection cases are validation-test opportunities; no demonstrated parsing defect warrants refactoring. |
| `execution/project/collection.rs`: `CapturedProject::run_job` | Retain the existing execution owner. Cancellation, source-integrity and I/O failure guards remain explicit. Their absence from this bounded coverage sample does not establish that runner policy should move. |
| `execution/project/selection.rs`: `SetupEvidence::collect` | Preserve the existing evidence module. Revisit workload/attribution rejection combinations with the actual Jest/Node proofs in #186. |
| `lib.rs`: proof-command `run` | Retain the facade. Several legacy capture/collect and transform dispatch paths are outside the bounded baseline workload. This is a known coverage gap, not evidence that the main CLI requires a rewrite. |

The priority here is evidence acceptance and fail-closed behaviour. Other
uncovered paths above are recorded opportunities, not claims of complete
coverage or demonstrated production bugs.

## The thirty unmeasured functions

All thirty original identities remain in the retained summary; none receives
a measured passing score.

- **21 functions in `execution/windows_spawn.rs`:** Windows-only production
  implementation. This Linux run cannot measure them. Existing Windows runtime
  and package tests are separate evidence, not Windows coverage measurements.
  A future quality gate needs a Windows coverage run or an explicit host scope.
- **Nine functions in `bin/windows_console_helper/tests.rs`:** Windows test
  harness helpers. The syntax scorer scans the file independently of the parent
  test module, so these enter its inventory despite being test implementation.
  Treat this as a scorer scope limitation. A future production-only gate should
  distinguish these helpers from the 21 production functions without hiding
  either group or rewriting the historical baseline.

## Selected execution and fallback: defer extraction

The assessment found a coherent possible responsibility, but no sufficient
benefit from extracting it today:

- `SetupEvidence` already owns attribution integrity, command narrowing and
  exact executed-test matching.
- `run_job` already owns fresh execution, receipt validation and cleanup.
- `CommandEvidence` already owns continuation and timeout assessment.
- One production caller, `run_mutant`, coordinates the remaining protocol.

A small helper could hide command choice, confirmation, retry, retained evidence
and counts. It would still require captured projects and real processes for the
current tests. Substantially smaller protocol tests would also require an
injected command executor and a new request/result interface. The assertion
gaps above can be closed directly with the existing fixtures instead.

**Decision:** defer extraction until #186's concrete runner proofs demonstrate
repeated protocol knowledge, or required safety cases cannot be tested clearly
through the existing interface. This preserves the candidate rather than
dismissing it. Source preparation/restoration, setup ordering and worker
stopping remain with their current owner. ADR-0001 and ADR-0004 still apply.

Preserve the exact retry distinction: a job deadline must not trigger retry;
a clean runner-reported test timeout can currently retry if its executed tests
cannot be confirmed. Replacing this with a blanket `state != TimedOut` guard
would change behaviour. Keep the same per-attempt limit and actual 0/1/2 job
accounting.

Direct selection/fallback combinations involving cancellation and process or
artifact cleanup failures remain further-proof work for #186. Existing common
continuation tests, selected hook-cleanup proofs and job-deadline proofs cover
parts of that policy; they do not prove every combination. Shared Istanbul
counter observation also remains conditional on actual reuse in the Jest proof.

## Reproduce the verification

Use the tool versions and dependencies from the baseline guide. Run the new
contracts directly:

```sh
cargo test --locked --offline --manifest-path crates/seshat/Cargo.toml \
  failed_original_and_prepared_checks_never_start_mutants
cargo test --locked --offline --manifest-path crates/seshat/Cargo.toml \
  unconfirmed_selection_retries_stop_at_the_mutant_limit
cargo test --locked --offline --manifest-path crates/seshat/Cargo.toml \
  empty_and_reversed_statement_spans_cannot_supply_coverage
node benchmarks/proofs/test-selection.mjs --cli crates/seshat/target/debug/seshat \
  --cases filter,timeout,job-deadline,cleanup,assertion-cleanup
```

For the original two mutants, make a disposable snapshot from the base revision:

```sh
snapshot=work/self-assessment-reproduction
mkdir -p "$snapshot"
git archive 4081ba2d25b1065a300b10caa292a0d3aa3c0a66 \
  crates/seshat benchmarks/proofs | tar -x -C "$snapshot"
printf '[workspace]\nmembers = ["crates/seshat"]\nresolver = "3"\n' > "$snapshot/Cargo.toml"
cp "$snapshot/crates/seshat/Cargo.lock" "$snapshot/Cargo.lock"
cargo mutants --dir "$snapshot" --file crates/seshat/src/assessment.rs \
  --re 'TestState::label' --no-config --jobs 1 --jobserver-tasks 2 \
  --timeout 120 --build-timeout 180 \
  --cargo-arg=--locked --cargo-arg=--offline
```

The workspace wrapper preserves the embedded reporter files at their original
relative paths when cargo-mutants copies the tree. It uses the original lockfile
and dev test profile; it is not a release-package measurement.

For each controlled regression, start with a fresh base snapshot. Apply its
retained `*-control.patch` using `patch -d "$snapshot" -p1`. Run the selection
recorded in `controlled-regressions.json` against that snapshot. Repeat in a
fresh snapshot after copying this checkout's changed `coverage.rs`,
`execution/project/collection.rs` and `tests/proof_inputs.rs` into their matching
crate locations. The original test selection must pass and the strengthened
selection must fail on its new assertion. Keep variants out of the real checkout.

To reproduce the measured native report at the retained test-file hashes:

```sh
cargo crap --path crates/seshat \
  --lcov outputs/rust-self-assessment-follow-up/native.lcov \
  --missing skip --no-cache --format json --sort file
```
