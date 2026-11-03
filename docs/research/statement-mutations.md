# Statement mutation evidence

The [original retained JSON](statement-mutations.json) records the synchronous
fixture and matched timings for
[#164](https://github.com/Binary-Balance/seshat/issues/164). The
[extended evidence summary](statement-async.json) records async and generator
checks, fixture and binary hashes, verdicts, site counts and timings for
[#218](https://github.com/Binary-Balance/seshat/issues/218).

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

Candidates must belong directly to an explicit function, including async
functions, generators, async generators, arrows and methods. Module-level
statements, static blocks and constructors are excluded. Nested functions
qualify independently. Declarations, blocks, labels, breaks, continues, throws,
directives and value-bearing returns are not removal candidates. In particular,
`return void work()` is excluded along with other value-bearing returns.

Any candidate containing a `super()` call is excluded, including calls through
nested arrows. A [super call initializes the derived instance](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-super-keyword).
Ordinary `super.method()` calls in eligible methods remain candidates. Removing
an ordinary call can remove asynchronous work it starts. Complete `await`,
`yield` and `yield*` expression statements qualify. Removing them skips the
work, suspension or delegated iteration and can change execution order or
generator cleanup. Bare returns qualify in these functions too. Value-bearing
returns, such as `return await work()`, remain excluded.

`perOperator.eligibleSites` and `excludedSites` count discovered sites before
replacement expansion, including rows with only exclusions. For the statement
family, these sites are expression statements and bare returns. Declarations
and other unsupported statement forms do not count as excluded sites. Disabled
families have no rows. These counts describe static eligibility, independent of
coverage or whether execution reached a mutant.

## Semantic and execution checks

The extended proof compares 50 fixed cases and 66 active statement mutations
under source replacement and switching, alongside original and inactive execution.
Fixed examples cover side-effect order,
bare guards, unbraced `if`/`else`, every loop form, labels and labelled
`continue`, switch fall-through, returns in switch cases, `finally`, semicolon
insertion, Unicode/comments, strict directives, later string expressions,
direct `eval`, nested functions and expression candidates, and TSX.
Async and generator examples cover awaited side effects, microtask ordering,
rejected promises, early returns, `for await`, `yield`, `yield*`, resumption,
`.throw()` and `.return()` cleanup, and async generator iteration. Arrows,
methods and nested functions are included. Negative cases cover value-bearing
returns, constructors, `super()` and static blocks.

Removing a terminal return is not always equivalent. In
`try { throw error; } finally { return; }`, removing the return exposes the
pending throw. The proof requires that result under replacement and switching.

Real CLI assessments select two files with one Node setup. The statement family
adds eleven mutants to two comparison mutants. Eight statement mutants are
killed, including an ordinary call and an awaited call in an async function,
yielded values and delegated iteration in a generator, and an awaited yield in
an async generator. Three survive and are hand-checked as equivalent within
this closed fixture: discarding the literal `123` and dropping terminal bare
returns in an empty function and a generator. These functions do not reflect
on their source. Survival alone does not establish equivalence, and these
counts do not estimate equivalent-mutant rates elsewhere.

Family selection, replacement and switching, two workers, repeatable IDs,
source bytes and empty scratch directories are checked. The six extreme
candidates remain a separate phase when statement mutations or all operator
mutations are disabled. Generators remain excluded from extreme mutation.
A job deadline leaves the first statement mutant timed out, completes the
remaining ten after safe cleanup and withholds the mutation score.

The retained summary keeps source and binary hashes, mutant definitions,
per-run verdicts, site and job counts, worker baseline jobs and phase timings.
It omits repeated setup receipts from the full proof output. To repeat the
debug-build check after building both binaries:

```sh
SESHAT_CLI_BINARY=crates/seshat/target/debug/seshat SESHAT_PROOF_BINARY=crates/seshat/target/debug/seshat-proofs SESHAT_PROOF_OUTPUT=work/statement-async.json node benchmarks/proofs/statement-operators.mjs
```

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

## Historical matched cost

Build the release binaries, then run:

```sh
SESHAT_OPERATOR_SAMPLES=3 SESHAT_PROOF_OUTPUT=work/statement-operators.json node benchmarks/proofs/statement-operators.mjs
```

The original comparison used the synchronous fixture retained in
`statement-mutations.json`. It used the same installed dependencies, source,
tests, coverage, five extreme candidates and one worker. Both strategies were
warmed first. Each sample compared the four-family selection from 0.7.0 with
the five-family default, reversing selection and strategy order on alternate
samples. The new family added exactly five fresh mutant test jobs per setup
under both strategies.
The current expanded fixture adds eleven and cannot be compared directly with
these historical timings. The extended evidence records one debug-build sample
to check job counts, not to claim release performance.

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
