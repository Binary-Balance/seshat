# Unreleased changes

Changes after [Seshat 0.9.0](0.9.0.md).

## Report import-failure observer availability

Each setup's `diagnostics.runnerVersions` row now reports
`importFailureObserver.state` and `reason`. Readable output explains when the
observer is inactive because of the Node version or runner. Its activation pin
remains Node 24.20.0/24.21.0; other supported Node versions still leave ambiguous
import crashes unresolved. This resolves
[#216](https://github.com/Binary-Balance/seshat/issues/216).

## Continue after unresolved runner crashes

Mutation testing now continues through later setups, extreme mutants and
operator mutants after a runner crash or invalid receipt when the managed
command ended, cleanup succeeded and captured inputs are unchanged. The failed
attempt remains `execution-error`, the run remains incomplete and the mutation
score stays withheld.

Cancellation, supervision/pipe failures and unsafe cleanup or
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

## Continue after cleaned-up job deadlines

Mutation testing now continues through later setups, extreme mutants and
operator mutants after a job exceeds `timeoutMs`, once process-tree termination,
cleanup and captured-source integrity are confirmed. The mutant remains
`timed-out`, the run remains incomplete and the mutation score stays withheld.
Original and worker baselines must still pass. Cancellation, supervision/pipe
failures and unsafe cleanup still stop scheduling. This resolves
[#213](https://github.com/Binary-Balance/seshat/issues/213).

## Document execution limits

The README and configuration guide now explain scratch-space estimates,
memory-backed temporary directories and platform-specific copy costs, resolving
[#223](https://github.com/Binary-Balance/seshat/issues/223).
They also explain that Seshat assumes deterministic tests and does not check
for flakiness by repeating baselines or killed mutants, resolving the
documentation scope of [#225](https://github.com/Binary-Balance/seshat/issues/225).
The README and report guide clarify that mutants are not typechecked and
type-invalid operator mutants remain in the mutation score, addressing the
documentation part of [#217](https://github.com/Binary-Balance/seshat/issues/217).
