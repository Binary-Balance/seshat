# Unreleased changes

Changes after the published [0.6.0 release](0.6.0.md).

## Planned for 0.7.0

- [#174](https://github.com/Binary-Balance/seshat/issues/174): optional
  `maxInferredAny` and `maxTypeEscapes` thresholds in all three commands.
  Inferred limits apply separately to each setup; syntax escapes count once
  across selected source. Missing required evidence makes the report incomplete
  and exits 2. Existing findings remain non-blocking when these limits are off.

The [release plan](https://github.com/Binary-Balance/seshat/issues/136) also
includes boolean literal and negation mutations in #163. This change does not
implement that mutation family or prepare npm publication.
