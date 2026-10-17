# Unreleased changes

Changes after the published [0.6.0 release](0.6.0.md).

## Planned for 0.7.0

- [#163](https://github.com/Binary-Balance/seshat/issues/163): default-on boolean
  literal flips and prefix-negation removal. The existing `mutationOperators`
  setting selects the new `boolean` family. Replacement and experimental
  switching preserve operand evaluation; switching explicitly rejects contexts
  where removing `!` exposes a reference it cannot preserve. See the
  [semantic checks and matched cost](../research/boolean-mutations.md).
- [#174](https://github.com/Binary-Balance/seshat/issues/174): optional
  `maxInferredAny` and `maxTypeEscapes` thresholds in all three commands.
  Inferred limits apply separately to each setup; syntax escapes count once
  across selected source. Missing required evidence makes the report incomplete
  and exits 2. Existing findings remain non-blocking when these limits are off.

The [release plan](https://github.com/Binary-Balance/seshat/issues/136) tracks
release preparation. These changes do not publish packages to npm.
