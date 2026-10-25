# Unreleased changes

Changes after [Seshat 0.9.0](0.9.0.md).

## Continue after unresolved runner crashes

Mutation testing now continues through later setups, extreme mutants and
operator mutants after a runner crash or invalid receipt when the managed
command ended, cleanup succeeded and captured inputs are unchanged. The failed
attempt remains `execution-error`, the run remains incomplete and the mutation
score stays withheld.

Cancellation, job deadlines, supervision/output failures and unsafe cleanup or
source changes still stop later mutants. Test-selection retry rules are
unchanged. This resolves
[#168](https://github.com/Binary-Balance/seshat/issues/168).

## Opt-in timeout scoring

Set `"countTimeoutsAsKilled": true` to count clean, complete runner-reported
mutant test timeouts as detected. The default remains `false`. Reports keep
`timed-out` verdicts and timeout evidence, add `countedAsKilled` per outcome and
report `countedTimeouts` separately from ordinary kills. Counted timeouts allow
complete scores and threshold evaluation. The same policy marks qualifying
extreme mutants as checked.

Job deadlines, failed baselines, cancellation, receipt errors and unsafe cleanup
never qualify. Scheduling is unchanged. Prefer tests that fail explicitly when
awaited work never settles. Resolves
[#169](https://github.com/Binary-Balance/seshat/issues/169).
