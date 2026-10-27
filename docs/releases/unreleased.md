# Unreleased changes

Changes after [Seshat 0.10.0](0.10.0.md).

## Skip zero-coverage jobs per setup

A setup whose complete coverage proves it never executes a mutant's source now
skips that mutant's job and records `no-coverage`, while other setups still
run. Previously every setup had to prove zero coverage, so a project with unit
and integration setups often ran both jobs for each mutant. Verdicts are
unchanged. Module-level mutants and setups without complete attribution still
run their commands. This resolves
[#227](https://github.com/Binary-Balance/seshat/issues/227).
