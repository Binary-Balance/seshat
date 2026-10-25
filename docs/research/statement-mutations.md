# Statement mutation evidence

The [retained JSON](statement-mutations.json) records the fixed semantic checks,
fixture and binary hashes, execution outcomes, operator counts and matched
timings for [#164](https://github.com/Binary-Balance/seshat/issues/164).

## Rules

The `statement` family replaces a complete expression statement or bare
`return` statement with `;`. For example, `log.push(value);` becomes `;`, and
`if (stop) return;` becomes `if (stop) ;`. The expression is no longer evaluated,
or the return no longer exits the function. Each candidate removes one AST
statement, including its operand and internal comments, while retaining all
source outside that statement.

An empty statement preserves required control-flow bodies, labels and
statement boundaries. It also keeps a later string expression from becoming a
directive after an earlier statement is removed. These choices follow the
ECMAScript rules for [statements and completion records](https://tc39.es/ecma262/multipage/ecmascript-language-statements-and-declarations.html)
and [automatic semicolon insertion](https://tc39.es/ecma262/multipage/ecmascript-language-lexical-grammar.html#sec-automatic-semicolon-insertion).

Candidates must belong directly to an explicit synchronous, non-generator
function. Module-level statements, static blocks and constructors are excluded.
Nested functions qualify independently, including synchronous functions inside
async functions. Declarations, blocks, labels, breaks, continues, throws,
directives and value-bearing returns are not removal candidates. In particular,
`return void work()` is excluded along with other value-bearing returns.

Any candidate containing a `super()` call is excluded, including calls through
nested arrows. A [super call initializes the derived instance](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-super-keyword).
Ordinary `super.method()` calls in eligible methods remain candidates. Removing
an ordinary call can remove asynchronous work it starts; async and generator
function bodies themselves are outside this release's statement family.

## Semantic and execution checks

The proof compares 34 fixed cases and 36 active statement mutations under
source replacement and switching, alongside original and inactive execution.
Fixed examples cover side-effect order,
bare guards, unbraced `if`/`else`, every loop form, labels and labelled
`continue`, switch fall-through, returns in switch cases, `finally`, semicolon
insertion, Unicode/comments, strict directives, later string expressions,
direct `eval`, nested functions and expression candidates, and TSX.
Negative cases cover value-bearing returns, async/generator ownership,
constructors, `super()` and static blocks.

Removing a terminal return is not always equivalent. In
`try { throw error; } finally { return; }`, removing the return exposes the
pending throw. The proof requires that result under replacement and switching.

Real CLI assessments select two files and five covered functions with one Node
setup. The statement family adds five mutants to two comparison mutants. Three
statement mutants are killed: the observed `log.push(7)`, the bare guard return
and the observed `log.push(1)`. Two survive and are hand-checked as equivalent
within this closed fixture: discarding the literal `123` and dropping a final
bare return in an otherwise empty function. Neither function reflects on its
source. Survival alone does not establish equivalence, and these counts do not
estimate equivalent-mutant rates elsewhere.

Family selection, replacement and switching, two workers, repeatable IDs,
source bytes and empty scratch directories are checked. The five extreme
candidates remain a separate phase when statement mutations or all operator
mutations are disabled. A job deadline leaves the first statement mutant timed
out, completes the remaining four after safe cleanup and withholds the mutation
score.

The Vitest stack and public consumer examples additionally require the Fastify
route-registration statement to be killed, alongside the existing expression
mutants. The Vitest timeout-continuation control removes `done()`, requires a
bounded runner-reported statement timeout, and still runs the later comparison.
Both the extreme and statement timeout remain unresolved and withhold the score.

## Switching

Experimental switching wraps each eligible statement in a block containing
`if (__seshat_active !== id) { originalStatement; }`. The block prevents a
generated `if` from capturing an existing `else`. Evaluation stays in the
existing function and nested candidates keep their own IDs, including when a
statement and its expression occupy the same source span.

Function bodies discard ordinary statement completion values, which supports
this [function-only boundary](https://tc39.es/ecma262/multipage/ecmascript-language-functions-and-classes.html#sec-runtime-semantics-evaluatefunctionbody).
The proof also compares every nested expression mutant with its source
replacement while the surrounding statement guard is inactive. Existing
experimental restrictions on reflected source, transformed TypeScript narrowing
and the 8 MiB rendered-source bound still apply.

## Matched cost

Build the release binaries, then run:

```sh
SESHAT_OPERATOR_SAMPLES=3 SESHAT_PROOF_OUTPUT=work/statement-operators.json node benchmarks/proofs/statement-operators.mjs
```

The comparison uses the same installed dependencies, source, tests, coverage,
five extreme candidates and one worker. Both strategies are warmed first.
Each sample compares the four-family selection from 0.7.0 with the five-family
default, reversing selection and strategy order on alternate samples. The new
family adds exactly five fresh mutant test jobs per setup under both strategies.

The recorded host is Linux x64 with Node 24.22.0 and TypeScript 6.0.3.
Three sequential samples ran without another proof suite or build running.
OS caches were not flushed and unrelated host load was not controlled.

| Selection | Mutant test jobs per setup | Replacement, ms | Switching, ms |
| --- | ---: | ---: | ---: |
| Four families | 2 | 541.6 [512.0 to 770.8] | 785.6 [776.1 to 811.6] |
| Five-family default | 7 | 1810.3 [1757.2 to 1959.0] | 2187.9 [2102.0 to 2236.7] |

The median paired increase is 1268.7 ms for replacement and 1402.3 ms for
switching. Both strategies add exactly five test jobs in every matched pair.

Values are median operator-phase `executionMs`, with minimum and maximum in
brackets. This phase includes preparation, the inactive prepared baseline for
switching, scheduling and cleanup. It excludes original checks, coverage and
the preceding extreme-mutation phase. Per-operator times sum returned attempts
and exclude shared preparation. These measurements describe this fixture and
host; they establish no production runtime bound or general speed advantage.
