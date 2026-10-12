# Unreleased changes

The coverage-import fix for #145 was released in [Seshat 0.3.1](0.3.1.md).

- `check` and `mutate` now detect pseudo-tested functions by replacing eligible
  function bodies once and running every configured test setup. Per-function
  flags and counts are separate from comparison mutation scores. Unresolved
  executions and unknown coverage remain unknown.
- `mutate` now collects fresh coverage to skip zero-covered functions. It still
  does not evaluate CRAP thresholds. Extreme mutation uses source replacement
  even when comparison switching is requested.

Type-safety findings now count explicit `any`, type assertions, double assertions,
non-null assertions and TypeScript suppression comments in selected source.
Function signatures and nested functions have separate counts. Module-level
escapes and file-level `@ts-nocheck` comments remain visible in source findings.

Each setup reports effective compiler strictness through its installed
TypeScript, including inherited configuration, command-line overrides and
compiler defaults. Unsupported commands, missing configuration or unavailable
compiler metadata report `unknown` with an error. These findings do not change
assessment completeness or add quality thresholds. Inferred `any` remains
planned separately. See the [report contract](../report-format.md#type-safety-findings)
and [configuration limits](../configuration.md#type-safety-findings).
