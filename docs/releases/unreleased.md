# Unreleased changes

The coverage-import fix for #145 was released in [Seshat 0.3.1](0.3.1.md).

- `check` and `mutate` now detect pseudo-tested functions by replacing eligible
  function bodies once and running every configured test setup. Per-function
  flags and counts are separate from comparison mutation scores. Unresolved
  executions and unknown coverage remain unknown.
- `mutate` now collects fresh coverage to skip zero-covered functions. It still
  does not evaluate CRAP thresholds. Extreme mutation uses source replacement
  even when comparison switching is requested.
