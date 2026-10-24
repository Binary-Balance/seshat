# Unreleased changes

Changes after [Seshat 0.9.0](0.9.0.md).

## Continue after unresolved runner crashes

Mutation testing now continues through later setups, extreme mutants and
operator mutants after a runner crash or invalid receipt when the managed
command ended, cleanup succeeded and captured inputs are unchanged. The failed
attempt remains `execution-error`, the run remains incomplete and the mutation
score stays withheld.

Cancellation, job deadlines, supervision/pipe failures and unsafe cleanup or
source changes still stop later mutants. Test-selection retries and timeout
scoring rules are unchanged. This resolves
[#168](https://github.com/Binary-Balance/seshat/issues/168).

## Continue after truncated test output

Commands that print more than 2 MiB to stdout or stderr now keep running while
Seshat drains and discards the excess. Jobs expose `outputTruncated: true`
instead of `overflow`. A valid failing test receipt still kills the mutant and
later mutants continue. Retained output stays bounded at 2 MiB per stream and
diagnostics at 1,000 characters per stream, 2,000 total. Deadlines, cancellation,
pipe errors and unsafe cleanup still stop jobs. This resolves
[#214](https://github.com/Binary-Balance/seshat/issues/214).
