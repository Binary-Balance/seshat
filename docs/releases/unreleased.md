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
unchanged. Without switching, `jobsAttempted` no longer includes a second set
of worker baselines. `result.mutation` reports the shared `workerBaselineJobs`,
`workerBaselines`, `workerPreparationMs` and `workerCleanupMs`;
`result.pseudoTesting` reports no worker baselines. A failed worker copy or
baseline now stops both phases. With switching, each worker still runs a
prepared baseline before the operator phase, so switching saves the copies but
not those baselines. This resolves
[#221](https://github.com/Binary-Balance/seshat/issues/221).

## Set mutant time limits from baseline duration

Mutant jobs in both mutation phases now stop at
`min(timeoutMs, max(slowest baseline × mutantTimeoutFactor, mutantTimeoutMinMs))`.
The slowest baseline is the longest of each setup's original and worker
baselines. The two new optional per-setup settings default to 5 and 30,000,
so with the default `timeoutMs` every limit is unchanged. A setup that raised
`timeoutMs` now waits less for each hanging mutant. Typecheck, baseline and
coverage jobs keep `timeoutMs`. Each `result.setups` row reports the limit its
mutant jobs used as `mutantTimeoutMs`, or `null` when none ran, and the
terminal report prints it next to each mutant that reached it. See
[mutant time limits](../configuration.md#mutant-time-limits). This resolves
[#202](https://github.com/Binary-Balance/seshat/issues/202).
