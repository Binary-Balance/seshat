# Unreleased changes

Changes below follow the published
[0.4.0 release](https://github.com/Binary-Balance/seshat/releases/tag/v0.4.0).

## Broader mutation operators

`check` and `mutate` now enable logical `&&`/`||` and binary arithmetic
`+`/`-`, `*`/`/` swaps alongside comparison mutants. The optional
`mutationOperators` array selects families; `["comparison"]` retains the
0.4.0 operator scope. New mutants participate in the mutation score and can
increase execution cost. Extreme mutation remains separate.

Reports add outcome `kind`, `enabledOperators` and `perOperator` counts and
timings under schema version 1. Logical replacements preserve operand grouping;
experimental switching preserves lazy evaluation and fails explicitly if
a rendered body exceeds 8 MiB.

This implements the logical and arithmetic portion of
[#133](https://github.com/Binary-Balance/seshat/issues/133). Boolean/negation,
statement removal and optional/nullish operators remain future work. See
[configuration](../configuration.md#mutation-operators) and
[fixture evidence](../research/mutation-operators.md).
