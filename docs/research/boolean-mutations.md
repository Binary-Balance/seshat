# Boolean mutation evidence

The [retained JSON](boolean-mutations.json) records the semantic checks, fixture
and binary hashes, execution outcomes, operator counts and matched timings for
[#163](https://github.com/Binary-Balance/seshat/issues/163).

## Rules

The `boolean` family has three replacements:

| Source | Replacement |
| --- | --- |
| Runtime `true` | `false` |
| Runtime `false` | `true` |
| Prefix `!expression` | `(expression)` |

Removing `!` also removes its boolean conversion. For example, `!7` becomes
`(7)`. Nested negations have one candidate per prefix. Each replacement changes
source, though distinct candidates can have the same effect. Type-level literals,
TypeScript postfix non-null assertions, non-runtime keys, comments and strings
are excluded. JSX expression values are eligible; a bare JSX attribute has no
explicit boolean literal to change.

These rules follow JavaScript's [logical-not evaluation](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-logical-not-operator).
Boolean conversion does not call an object's `valueOf` method.

## Semantic and execution checks

The proof compares 33 fixed cases and 38 active boolean mutants with source
replacement and inactive/active switching. It covers literals, primitive and
object truthiness, nested negation, conditions, conditional grouping, evaluation
count and order, nested functions, parameter defaults, class fields, getters,
receiver binding, direct `eval`, `await`, `yield`, short-circuit effects,
Unicode/comments, type literals, non-null assertions and TSX. Serialization
keeps undefined, NaN, negative zero, BigInt and Symbol distinct. Semicolon-free
statements, nested arms, directives, switch cases and single-statement control
bodies check that generated parentheses preserve statement boundaries.

Real CLI assessments use two selected source files, five covered functions and
one Node setup. Default selection adds four boolean mutants to two comparisons.
Three boolean mutants are killed. Removing the discarded negation in
`ignored(value) { void !value; return 7; }` survives and is hand-checked as
equivalent within this closed fixture, which does not reflect on function source.
It still reads `value` once and returns 7; boolean conversion has no extra
coercion effects. Survival alone is not evidence of equivalence.

| Original | Planned | Killed | Hand-checked equivalent |
| --- | ---: | ---: | ---: |
| `true` | 1 | 1 | 0 |
| `false` | 1 | 1 | 0 |
| `!` | 2 | 1 | 1 |

These selected examples do not estimate equivalent-mutant rates in other
projects. Both comparison mutants are killed. Extreme mutation remains a
separate phase with five candidates when the boolean family or all operator
families are disabled.

The assessments compare replacement and switching identities/outcomes, including
two workers, and check input bytes and empty scratch directories after each run.
A separate job-timeout case leaves one timed-out boolean mutant, completes the
other three mutants after safe cleanup and withholds the score. A
switching-rejection case also remains incomplete with a null score and preserved
source.

## Switching boundary

Source replacement can expose an operand reference in a way an inline
conditional cannot. The [conditional-expression rules](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-conditional-operator)
return a value, which can lose receiver binding or direct-eval behavior.

Experimental switching therefore rejects selected negations used as call,
optional-call or tagged-template targets, or under `typeof` or `delete`, when
removal exposes references, including through erased TypeScript wrappers. The
proof checks six representative contexts with fixed source-replacement results and verifies that
rejected preparation leaves its output untouched. Use source replacement for
these forms; no mutants are silently omitted or treated as kills.

Ordinary `!object.method()` and `!eval(...)` remain supported because the call
stays inside the operand. Inline arms retain the evaluation scope of `await` and
`yield` and execute the operand once. Existing experimental limits for reflected
function source, transformed TypeScript narrowing and the 8 MiB rendered-source
bound still apply.

## Matched cost

Build the release binaries, then run:

```sh
SESHAT_OPERATOR_SAMPLES=3 SESHAT_PROOF_OUTPUT=work/boolean-operators.json node benchmarks/proofs/boolean-operators.mjs
```

The comparison uses the same installed dependencies, source, tests, coverage,
five extreme candidates and one worker. Each sample runs the original three
families and then all four, reversing order on alternate samples. Replacement
and switching order also alternates. The added family requires four more mutant
test jobs per setup under both strategies. Each mutant uses a fresh process.

The recorded host is Linux x64 with Node 24.22.0 and TypeScript 6.0.3.
Three sequential samples ran without another proof suite or build running.
OS caches were not flushed and unrelated host load was not controlled.

| Selection | Mutant test jobs per setup | Replacement, ms | Switching, ms |
| --- | ---: | ---: | ---: |
| Original three families | 2 | 1316.9 [908.4 to 1408.6] | 2042.8 [1742.2 to 2875.1] |
| Four-family default | 6 | 3460.0 [2772.7 to 3792.0] | 4496.0 [4004.7 to 4636.2] |

The median paired increase is 2051.4 ms for replacement and 2453.2 ms for
switching. Both strategies add exactly four test jobs in every matched pair.

Values are median operator-phase `executionMs`, with minimum and maximum in
brackets. This phase includes preparation, the inactive prepared baseline for
switching, scheduling and cleanup. It excludes original checks, coverage and
the preceding extreme-mutation phase. The retained per-operator times sum
returned attempts and exclude shared preparation.

The measurements describe this fixture and host. They establish no production
runtime bound or general switching speed advantage.
