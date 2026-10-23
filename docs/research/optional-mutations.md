# Optional and nullish mutations

Issue [#165](https://github.com/Binary-Balance/seshat/issues/165) adds the
`optional` family, enabled by default through `mutationOperators`.

## Transformation contract

Each eligible runtime token produces exactly one mutant:

| Form | Replacement |
| --- | --- |
| `object?.property` | `object.property` |
| `object?.[key]` | `object[key]` |
| `fn?.(arguments)` | `fn(arguments)` |
| `object.method?.(arguments)` | `object.method(arguments)` |
| `object?.method(arguments)` | `object.method(arguments)` |
| `left ?? right` | `(left) \|\| (right)`, with the whole expression grouped |

Static member removal adds a space before `.` to separate numeric literals.
Computed member and call removal leave two spaces. This keeps token widths
stable in prepared alternatives. Comments and all other source bytes remain
unchanged. Nullish replacement retains trivia around the operator and groups
both operands. It treats falsy non-nullish values as missing, returns operand
values and evaluates the right operand only when the left is falsy.

Each `?.` in a continuous chain qualifies independently, including mixed
optional and ordinary segments. Removing one segment retains the short-circuit
behavior of every remaining segment. Parenthesized chains keep their existing
boundary. Nested chains in computed keys and arguments qualify independently.
Runtime default parameter/initializer expressions, class fields, async and
generator bodies, and TSX expression containers qualify. Optional type members,
type syntax, declaration-only code, `??=`, optional private fields, and ordinary
default initializers without `??` are excluded. TypeScript rejects optional
private fields with diagnostic 18030, so that JavaScript form is outside this
TypeScript family. No transformation introduces repeated runtime evaluation,
a temporary, a wrapper function or a changed method receiver.
Removing `eval?.()` makes it a direct `eval()` call, exactly as token removal
specifies; this can change its scope. Replacements may throw when a previously
optional receiver or callee is nullish.

## Experimental switching

Select between complete continuous chains, with each active arm removing only
one token. This retains the chain's short-circuit boundary, evaluation order,
getters, computed keys, arguments and method receiver. Nullish switching uses
the existing inline logical arms. Only one arm executes, including with `await`,
`yield` and direct `eval`.

Reject preparation when a selected chain is the direct operand of `delete` or
the target of an outer call or tagged template, including erased TypeScript
wrappers. Conditional arms return values and cannot preserve a member reference
for these operations. The conservative exclusion also includes such chains
ending in calls. Replacement remains supported. Fail before writing prepared
source; do not omit candidates or report a complete score. Existing switching
limits for source reflection, strict transformed typechecking, helper collisions
and 8 MiB generated bodies still apply.

## Evidence

The [retained JSON](optional-mutations.json) records 41 semantic cases,
55 active optional replacement/switching pairs and 39 CLI assessments. The
[proof script](../../benchmarks/proofs/optional-operators.mjs) compares
original execution with inactive switching, then each source replacement with
its active switching alternative. Expected results are written by hand,
including errors and effect logs. JSON encoding distinguishes undefined, NaN,
negative zero and BigInt. Other operators inside these chains also retain
replacement/switching parity. Repeated inspection checks token offsets and IDs.

The fixed cases cover static/computed members, optional free and method calls,
getter/receiver/key/argument order, retained short-circuit segments, continuous
and parenthesized chains, nested keys and arguments, nullish and falsy values,
side effects, nested defaults and logical operators, default parameters, class
fields, `super` methods, generic calls, non-null assertions, `await`, `yield`,
direct and optional `eval`, numeric receivers, Unicode/comments, semicolon
insertion, nested functions and TSX. Five further reference-sensitive examples
verify replacement and explicit switching rejection without overwriting a
prepared destination.

The CLI fixture selects two files, seven covered functions and one Node setup.
It adds seven optional mutants to two comparison mutants. Five optional mutants
are meaningful and killed: removing a nullish member guard, removing an absent
callee guard, changing the default for zero, and removing either guard from a
two-segment chain. Two survive and are hand-checked as equivalent in these
closed functions:

```ts
function equivalent() {
  const value = {field:7};
  return value?.field;
}
function equivalentDefault() {
  const value = 7 as number | null;
  return value ?? 9;
}
```

The first receiver is always a fresh non-nullish object; the second left operand
is always seven. Neither token change alters returned values or effects, and
neither function reflects on its source. These counts do not estimate equivalent
mutant rates elsewhere. Survival alone does not establish equivalence.

The CLI proof checks default selection, optional-only selection, disabling all
operators, two workers, replacement/switching verdict and identity parity,
per-operator counts and timing totals, original source bytes and empty scratch
directories. Seven extreme candidates remain when optional operators are off.
A deadline leaves the first optional mutant timed out and later mutants not run
under both strategies. A successful process without a runner receipt also
remains unresolved. Both failures withhold the score. A selected `delete` chain
makes switching preparation fail after passing original baselines, with no
operator attempts and no mutation score.

The separate `switching-syntax.mjs` regression exercises inactive and active
nullish/member/call mutations and method receiver binding through Node, Jest
and Vitest. These use fixed transpiled snippets, not an arbitrary consumer suite.

## Matched cost

Build the release binaries, then run:

```sh
SESHAT_OPERATOR_SAMPLES=3 SESHAT_PROOF_OUTPUT=work/optional-operators.json node benchmarks/proofs/optional-operators.mjs
```

The proof accepts `SESHAT_CLI_BINARY` and `SESHAT_PROOF_BINARY` for binaries in
another build directory. It measures both the native executable and the
unchanged npm launcher in an installed package layout using the same native
binary. The layout has minimal fixture manifests using the current crate
version. It does not install from npm, pack a release or measure registry work.

Each pair retains identical source, tests, coverage, seven extreme candidates
and one worker. It compares the five-family 0.8.x selection with the six-family
default. Each route and strategy is warmed, then strategy and selection order
reverse on alternate samples. Exactly seven fresh mutant test jobs per setup
are added in every pair. Samples run sequentially within this proof; other
proofs and unrelated projects used the host concurrently. External host load
was uncontrolled and OS caches were not flushed.

The recorded host was Linux x64, Node 24.22.0 and TypeScript 6.0.3.
The five-family selection ran two operator jobs per setup; the default ran nine.
The optional family had five killed mutants and two hand-checked equivalent
survivors under both strategies. Comparisons added two kills.

| Route and strategy | Optional off, ms | Optional on, ms | Median paired increase, ms |
| --- | ---: | ---: | ---: |
| Native, replace | 1055.4 [818.9 to 1404.5] | 3885.3 [3633.7 to 6157.5] | 3066.4 |
| Native, switch | 1274.0 [1226.1 to 2643.9] | 4963.0 [4311.6 to 5168.9] | 3037.7 |
| Launcher, replace | 814.9 [764.0 to 1131.9] | 3817.7 [3461.5 to 4320.9] | 3053.7 |
| Launcher, switch | 1484.7 [1289.1 to 1487.0] | 4168.2 [3040.4 to 4299.7] | 2681.2 |

Values are median operator-phase execution time with minimum and maximum in
brackets, over three samples. The observed increases are not isolated estimates
of operator overhead under controlled host load.

The retained JSON records environment, binary/launcher and fixture hashes,
expected semantic outcomes, mutant identities, complete reports and raw timing
samples. Operator-phase `executionMs` includes preparation, the inactive
prepared baseline for switching, scheduling and cleanup. It excludes original
checks, coverage and the preceding extreme phase. Invocation wall time includes
the launcher when used. Per-operator timings sum returned test attempts and
exclude shared preparation.

These measurements establish fixture counts, verdicts and observed timings.
They establish no production runtime bound, general speed advantage, complete
language conformance or equivalence rate for other code. Strict checking applies
to the original CLI fixture; semantic cases and switching alternatives use
transpile-only execution. Optional private fields, source reflection and the
explicit switching exclusions remain outside this evidence.


## Local regression checks

The Linux x64 release build passed 144 Rust unit tests and 13 integration tests.
The existing operator matrix passed 20 semantic cases and 41 active pairs;
boolean passed 33 cases and 38 pairs; statement passed 34 cases and 36 pairs.
Their CLI fixtures also passed family selection, parallel execution, source
restoration, cleanup and timeout checks with the new default family list.
The regression driver reused the completed optional proof rather than repeating
its cost samples. The committed `operators.mjs` harness runs all four component
proofs. Node, Jest and Vitest switching-syntax checks passed. Other operating
systems were not checked locally.
