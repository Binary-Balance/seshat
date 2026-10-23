# Unreleased changes

Changes after [Seshat 0.9.0](0.9.0.md).

## Continue after unresolved runner crashes

Mutation testing now continues through later setups, extreme mutants and
operator mutants after a runner crash or invalid receipt when the managed
command ended, cleanup succeeded and captured inputs are unchanged. The failed
attempt remains `execution-error`, the run remains incomplete and the mutation
score stays withheld.

Cancellation, job deadlines, supervision/output failures and unsafe cleanup or
source changes still stop new jobs. Test-selection retries and timeout scoring
rules are unchanged. This resolves [#168](https://github.com/Binary-Balance/seshat/issues/168).
