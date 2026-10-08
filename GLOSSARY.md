# Seshat

Seshat provides deterministic checks that help ensure AI-generated code is good
code. Today it assesses TypeScript and TSX through CRAP analysis and mutation
testing.

## Purpose

Coding agents produce code faster than people can review it. Seshat shows where
that code is risky, so review effort goes where it matters.

- **Deterministic.** The same code and tests give the same result. Seshat
  measures; it does not ask a model for an opinion.
- **Practical.** A check belongs in Seshat when its findings lead to a concrete
  improvement. Measurement for its own sake does not.
- **Type safety.** TypeScript's checking can be switched off locally or weakened
  by configuration. Showing where that has happened is part of Seshat's job.
- **Built on the project's own tools.** Seshat uses the project's test runner,
  coverage and TypeScript. It does not reimplement them.

Planned assessments are tracked in
[issue 136](https://github.com/Binary-Balance/seshat/issues/136).

## Language

**CRAP score**:
A function-level metric combining cyclomatic complexity and test coverage to
identify complex, insufficiently tested code. It is not proof of correctness.
_Avoid_: overall quality score

**Statement coverage**:
The fraction of measured executable statements that ran at least once, attributed
separately to each function. Calling a function does not imply that all of its
statements ran.
_Avoid_: function invocation coverage

**Branch coverage**:
The fraction of recorded Istanbul branch outcomes that ran at least once,
attributed separately to each function. CRAP uses this fraction, falling back
to statement coverage when the provider records no branches for a function.
Providers can record different branch kinds; this does not measure every
possible execution path.
_Avoid_: path coverage

**Mutant**:
A version of the code containing one deliberate change whose detection by the
tests is being assessed.
_Avoid_: discovered bug

**Baseline**:
A test execution without an active mutant that establishes whether the tests
pass before mutation results can be interpreted.

**Killed mutant**:
A mutant under which the test runner reports a test failure after a passing
baseline. An infrastructure failure or timeout alone is not a kill.
_Avoid_: failing process

**Surviving mutant**:
A mutant under which the selected tests complete successfully.
_Avoid_: proven equivalent mutant

**Mutation score**:
The percentage of resolved mutants killed in a complete run, calculated as
`killed / (killed + survived) * 100`. It is not applicable when there are no
mutants, and no final percentage is reported for an incomplete run.
_Avoid_: percentage of bugs found

**Comparison mutant**:
A mutant that replaces a comparison operator in an executable expression.

**Extreme mutant**:
A mutant that removes one function's body behaviour.

**Pseudo-tested function**:
A function with reliable positive statement coverage whose extreme mutant
survives all configured test setups. This does not prove that the function has
no useful tests.

**Boundary shift**:
A comparison change that includes or excludes the equality case, such as
`a < b` becoming `a <= b`.

**Logical inversion**:
A comparison change to its paired opposite operator, such as `<` becoming `>=`
or `===` becoming `!==`. This names the operator change, not a guarantee that
every JavaScript value produces the boolean negation of the original result.

**Mutation testing**:
An assessment of whether the tests detect deliberate changes to the code.
_Avoid_: code coverage
