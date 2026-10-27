# Unreleased changes

Changes after [Seshat 0.10.0](0.10.0.md).

## Skip zero-coverage jobs per setup

A setup whose complete coverage proves it never executes a mutant's source now
skips that mutant's job and records `no-coverage`, while other setups still
run. Previously every setup had to prove zero coverage, so a project with unit
and integration setups often ran both jobs for each mutant. Verdicts are
unchanged. Module-level mutants and setups without complete attribution still
run their commands. This resolves
[#227](https://github.com/Binary-Balance/seshat/issues/227).

## Share worker copies across mutation phases

With `workers` above one, Seshat now copies the project and runs each worker's
baselines once, before the extreme phase, and both mutation phases reuse those
copies. Previously each phase made its own copies and baselines. Verdicts are
unchanged; `jobsAttempted` no longer includes a second set of worker baselines.
`result.mutation` reports the shared `workerBaselineJobs`, `workerBaselines`,
`workerPreparationMs` and `workerCleanupMs`; `result.pseudoTesting` reports no
worker baselines. A failed worker copy or baseline now stops both phases. With
switching, each worker still runs a prepared baseline before the operator
phase. This resolves
[#221](https://github.com/Binary-Balance/seshat/issues/221).
