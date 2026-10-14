# Logical and arithmetic mutation evidence

The [retained JSON](mutation-operators.json) records the exact fixture and binary
hashes, outcomes, operator counts and timings for the logical/arithmetic part of
[#133](https://github.com/Binary-Balance/seshat/issues/133).

## Reproduce

Build the release binaries, then run:

```sh
SESHAT_OPERATOR_SAMPLES=3 SESHAT_PROOF_OUTPUT=work/operators.json node benchmarks/proofs/operators.mjs
```

The recorded host is Linux x64 with Node 24.21.0 and TypeScript 6.0.3. The script
creates a disposable two-source project and runs real Node tests and fresh
Istanbul coverage. It preserves input bytes and checks scratch cleanup.
No dependency installation or separate build job is included in the measured phase.

## Counts and equivalent mutants

Default selection produces ten operator mutants: two comparisons, three logical
and five arithmetic. Eight are killed and two survive, giving a score of 80%.
Nine functions also receive extreme mutations in a separate phase. Selecting
no operator families leaves those nine extreme mutations intact.

| Original operator | Planned | Hand-checked equivalent | Fixture rate |
| --- | ---: | ---: | ---: |
| `&&` | 2 | 1 | 50% |
| `||` | 1 | 0 | 0% |
| `+` | 2 | 1 | 50% |
| `-` | 1 | 0 | 0% |
| `*` | 1 | 0 | 0% |
| `/` | 1 | 0 | 0% |

The equivalent expressions are the constants `false && false` and `4 + 0`.
Their replacements have the same value and no side effects. The other fixture
mutants demonstrably change results. These deliberately chosen rates are not
population estimates. Seshat does not infer equivalence from survival.

## Measured execution cost

Three sequential samples per family and strategy use one worker and one setup.
Strategy order alternates by sample. Dependencies are installed beforehand;
OS caches are not flushed. No other proof suite ran during these samples.

Values are median `mutation.executionMs`, with minimum and maximum in brackets,
in milliseconds. This phase includes mutation preparation, prepared baselines,
scheduling and worker cleanup. It excludes original checks, fresh coverage and
the preceding extreme-mutation phase. Raw `perOperator.executionMs` sums each
operator's returned attempts and excludes shared preparation.

| Family | Mutant test jobs per setup | Replacement, ms | Switching, ms |
| --- | ---: | ---: | ---: |
| logical | 3 | 774.7 (761.5 to 800.8) | 1103.2 (1000.5 to 1232.1) |
| arithmetic | 5 | 1310.5 (1304.5 to 1420.8) | 1541.0 (1539.7 to 1974.2) |

Switching also runs one inactive prepared baseline. Every mutant starts a fresh
test process. These measurements cover this small fixture only; they establish
neither a production runtime bound nor a general switching speed advantage.

## Semantic checks and limits

Seventeen syntax/behaviour cases compare 31 active switching results with source
replacement and fixed expected results where specified. They cover short-circuit
side effects, operand values, logical-chain grouping, mixed operators, BigInt,
coercion, Unicode trivia, adjacent unary signs, comments and regex literals,
`await`, `yield` and direct `eval`. Separate runner
checks exercise active logical/arithmetic switching in Node, Jest and Vitest.
Real CLI runs also check operator selection, global IDs across two files and
parallel workers using both strategies.

Logical replacements parenthesise both operands and the changed expression.
Logical switching uses inline conditional arms. This preserves evaluation scope
but duplicates nested source text; rendered bodies above 8 MiB fail preparation
without a complete score. A Rust regression verifies this bound and replacement
availability. Reflection and transformed TypeScript narrowing retain the
[documented experimental limits](../configuration.md#mutation-execution).
