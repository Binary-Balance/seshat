# Unreleased changes

Changes after the prepared [0.5.0 release](0.5.0.md).

## Runner-reported test timeouts

A test timeout reported by the runner no longer prevents later mutants from
running when the command finishes within its job deadline with complete
evidence, no execution errors and successful cleanup. This includes continuing
from extreme mutation to operator mutation. Timeouts remain unresolved, the
overall mutation score stays withheld and the command exits `2`. Job deadline
timeouts and execution errors still stop scheduling.

JSON retains the existing timeout state and verdict, adds `testTimedOut: true`
to affected setup evidence and reports a separate diagnostic count. This fixes
[#156](https://github.com/Binary-Balance/seshat/issues/156).
