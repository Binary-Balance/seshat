# Branch coverage for CRAP

Issue [#130](https://github.com/Binary-Balance/seshat/issues/130) changes CRAP
to use the branch counters already supplied by full Istanbul reports. Existing
statement fields remain available. No additional test execution is needed by
the assessment.

The [provider proof](../../benchmarks/proofs/coverage-branches.mjs) runs the same
fixture through Node with Istanbul instrumentation and TypeScript source maps,
Vitest's Istanbul provider, and the pinned Jest/Expo preset with Babel coverage.
The recorded run used Node 24.21.0, TypeScript 6.0.3, Vitest 5.0.0, Jest 29.7.0
and jest-expo 57.0.5, with istanbul-lib-instrument 6.0.3 and
istanbul-lib-source-maps 5.0.6.
The fixture uses classic JSX and a local `createElement` function so all three
routes evaluate the same JSX expression without a React dependency.

| Function | Statement coverage | Recorded branch coverage | Complexity | CRAP |
| --- | ---: | ---: | ---: | ---: |
| `price`, an `if` without `else` | 100% | 1/2 | 2 | 2.5 |
| `conditional`, a ternary | 100% | 1/2 | 2 | 2.5 |
| `parenthesized`, a ternary with parentheses | 100% | 1/2 | 2 | 2.5 |
| `logical`, `&&` | 100% | 1/2 | 2 | 2.5 |
| `logicalWrapped`, `&&` with parenthesized `||` | 100% | 1/3 | 3 | 5.667 |
| `nullish`, `??` | 100% | 1/2 | 2 | 2.5 |
| `view`, a ternary inside JSX | 100% | 1/2 | 2 | 2.5 |
| `fragment`, a parenthesized ternary inside a JSX fragment | 100% | 1/2 | 2 | 2.5 |
| Multiline JSX, following children, comments and conditional attributes | 100% | 1/2 | 2 | 2.5 |
| Nested conditional/logical branches, including JSX | 100% | 2/4 | 3 | 4.125 |
| `computed`, default followed by a computed parameter key | 100% | 1/1 | 2 | 2 |
| `defaults`, a parameter default | 100% | 0/1 | 2 | 6 |
| `destructured`, a destructuring default | 100% | 0/1 | 2 | 6 |
| `optional`, `?.` | 100% | No recorded branches | 2 | 2 |
| `nested`, enclosing an arrow | 100% | No recorded branches | 1 | 1 |
| Nested arrow with a ternary | 100% | 1/2 | 2 | 2.5 |
| `choice`, a three-arm switch | 50% | 1/3 | 3 | 5.667 |
| `straight`, a return without decisions | 100% | No recorded branches | 1 | 1 |

These counts and scores agree across the three routes. The empty function
remains not applicable. A default argument has one recorded outcome, execution
of its initializer. Passing an explicit value does not exercise that outcome.

An absent `else` has a real counter but no source span. Istanbul represents its
location as empty `start` and `end` objects. Seshat accepts that placeholder only
for the missing alternate of a matching source `if`.

Node and Jest/Expo produce the same branch positions for this fixture. Vitest
often extends an expression range into following punctuation or uses a null
end column for the rest of the line. Default-value ranges can include the
parameter's type annotation. Seshat validates branch kinds and outcome starts
against the source syntax before accepting these bounded range differences.
Vitest also includes enclosing branch separators, closing parentheses, JSX
container braces and final attribute opening-tag punctuation. A final JSX expression can extend through
its element or fragment's closing tag. The syntax tree must identify these
as punctuation or empty JSX comment containers. Seshat rejects ranges that
include another executable expression, attribute or JSX child. Default ranges
stop before later parameter initializers, computed keys or decorators.
Branch hits combine across setups only when the validated outcome identities
agree, alongside the existing statement-mapping checks.

Optional chaining has no separate Istanbul branch counter in these three
fixtures. It still contributes to complexity, but the score uses statement
coverage when the function has no other recorded branches. Loops and other
decisions can likewise contribute to complexity without a provider counter.
This measures recorded outcomes, not every possible path. Different transforms
or providers can produce different branch maps and prevent combining reports.

Missing or malformed counters and partial branch entries remain unknown.
This includes partially suppressed outcomes such as `istanbul ignore else`.
Executable parameters without any mapped statements remain unknown too; branch
counters alone do not change that existing policy.

Run from the repository root after the documented Rust build and dependency
installation:

```sh
node benchmarks/proofs/coverage-branches.mjs
```

The proof checks the expected counts and scores and writes the raw branch
locations, counters and function rows to its JSON evidence. Its paths and
dependency setup are described in the [proof guide](../../benchmarks/proofs/README.md#branch-coverage-for-crap).
