# Unreleased changes

Changes after the published [0.8.0 release](0.8.0.md).

- Clarify that `coverage.report` resolves from each setup's `cwd`, with distinct
  resolved destinations and no `..` traversal. This corrects the documentation
  without changing path resolution. Resolves
  [#167](https://github.com/Binary-Balance/seshat/issues/167).
