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

Cancellation, job deadlines, supervision/output failures and unsafe cleanup or
source changes still stop later mutants. Test-selection retries and timeout
scoring rules are unchanged. This resolves
[#168](https://github.com/Binary-Balance/seshat/issues/168).

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
