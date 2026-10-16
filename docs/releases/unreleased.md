# Unreleased changes

Changes after the published [0.5.1 release](0.5.1.md).

## Inferred `any`

Report any-typed runtime expression sites per function and setup using the
project's installed TypeScript `>=5.0 <7.0`. The existing compiler metadata
helper creates one checker per setup, retains source locations and reports its
cost. Unknown, out-of-program and zero findings remain distinct. Compiler
errors, recovery types and enabled `noCheck` produce unknown findings without
blocking an otherwise complete CRAP or mutation assessment.

This completes step 3 of [#134](https://github.com/Binary-Balance/seshat/issues/134).
See the [configuration guide](../configuration.md#type-safety-findings) and
[report fields](../report-format.md#type-safety-findings).
