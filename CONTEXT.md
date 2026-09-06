# Seshat

Seshat assesses code through CRAP analysis and mutation testing.

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
