# Cognitive complexity

`cognitiveComplexity` estimates how difficult a function's control flow is to
follow. It starts at zero and is independent of coverage. CRAP continues to use
cyclomatic `complexity`.

The calculation follows G. Ann Campbell's
[SonarSource white paper, version 1.7](https://www.sonarsource.com/docs/CognitiveComplexity.pdf),
with the TypeScript and TSX choices below. Seshat implements the rules itself.

- `if`, loops, `catch`, ternaries and `switch` add one plus their enclosing
  control-flow depth. Their bodies or outcomes increase that depth.
- `else if` and `else` add one without a nesting penalty. Their bodies still
  increase depth. A braced `else { if (...) ... }` is a nested `if`.
- A `switch` adds one structural increment for the entire statement. Its cases
  do not add separate increments.
- Each consecutive sequence of the same binary logical operator adds one.
  Changing from `&&` to `||`, or back, starts another sequence. Parentheses
  preserve a sequence; an intervening expression such as negation separates it.
- Labelled `break` and `continue` add one. Unlabelled jumps, returns, throws,
  `try` and `finally` add nothing themselves.
- A function in an established direct or indirect recursion cycle adds one,
  regardless of how many recursive calls it contains.

## TypeScript and TSX choices

Nested functions and callbacks have separate scores and start at depth zero,
as with Seshat's cyclomatic scores. Their bodies do not increase the enclosing
function's score. This deliberately differs from the paper's nested-method
aggregation and nesting penalty; its declarative-wrapper exception is therefore
unnecessary here. A callback containing one `if` scores one even when declared
inside another function's loop.

Recursion is limited to same-file identifier calls to named functions or
functions directly assigned to `const` identifiers. A target must have exactly
one binding with that name in the file, remain unwritten, and be visible at the
call site. Shadowed names are excluded conservatively even when the shadowing
occurs in an unrelated scope. Identifiers appearing in assignment targets also
exclude their names conservatively. Direct `eval` calls or `with` disable this
calculation for the file. Aliases, imports, member calls such as `this.method()`,
mutable function variables and cross-file cycles are not resolved. Consequently,
a zero recursion increment does not establish the absence of recursion.

Optional chaining, `??`, `??=`, parameter defaults and destructuring defaults
add nothing themselves. Flow-breaking expressions inside them still count.
`&&=` and `||=` each add one, treating the assignment as one logical sequence.
Ordinary `||` defaults still count as a logical sequence.

JSX markup adds nothing. Expressions inside JSX use the same rules, so
`{visible && <Panel />}` adds one and a ternary adds its structural and nesting
increments. Type annotations add nothing.

Implicit class field initialisers and static blocks retain scores in their
function rows but are excluded from the function threshold. Module-level flow
does not increase function scores.

## Threshold

`thresholds.maxCognitiveComplexity` accepts a finite number greater than or equal
to zero. It applies to the maximum ordinary-function score in `check`, `crap`
and `mutate`, including empty functions, independently of coverage status.
Equality passes. Omission or `null` disables it. No ordinary functions produces
`not-applicable`. Incomplete execution still takes precedence and withholds the
quality check's `actual`, while parsed function scores remain in source rows.
