# Typecheck mutants

Issue [#217](https://github.com/Binary-Balance/seshat/issues/217) asked for
the cost of typechecking each mutant to be measured before settling the
design of the opt-in `typecheckMutants` setting.

## Method

Measured on 2026-11-10 on one Linux x64 host with Node 24.22.2 and
TypeScript 6.0.3, using the public examples' own `tsc --project
tsconfig.json` commands. Each typecheck ran three times cold, then three
times with `--incremental` and a build-info file outside the project. Mutant
test times are the median `executionMs` from one default `seshat mutate` run
of each example, before this setting existed.

| Example | Planned operator mutants | Typecheck | Typecheck with `--incremental` | Median mutant test |
| --- | ---: | ---: | ---: | ---: |
| Node | 4 | 0.59–0.62 s | 0.59–0.64 s | 0.17 s |
| Vitest | 6 | 1.74–1.98 s | 1.55–1.92 s | 0.83 s |
| Jest/Expo | 4 | 1.08–1.14 s | 1.01–1.12 s | 1.70 s |

## Findings

- A type-valid mutant takes about typecheck plus test time: roughly 4.6 times
  as long for Node, 3.2 times for Vitest and 1.65 times for Jest/Expo. A
  rejected mutant skips its tests, so it costs only the typecheck.
- `--incremental` saved no measurable time. Compiler startup and loading the
  program dominate these small projects, and a mutant changes a source file
  each time anyway.
- The cost is a fixed per-mutant compiler run, so it matters most where tests
  are fast.

## Decision

`typecheckMutants` runs the setup's existing `typecheck` command once per
operator mutant, unchanged. It stays opt-in, and the default mode and score are
unchanged. A cheaper design would keep one compiler program alive per worker
and recheck only the mutated file, as the compiler findings helper already
builds a program. That needs a long-lived checker process; it is worth
revisiting if projects with slow typechecks adopt the setting.

The acceptance proof `benchmarks/proofs/typecheck-mutants.mjs` runs the four
cases from the issue (`?.` to `.`, `+` to `-` on strings, `&&` to `||` with
narrowing, `true` to `false` against a literal type) and a type-valid control
through the real compiler, with the setting off and on.
