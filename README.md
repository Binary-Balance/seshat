# Seshat

A native code-assurance tool for TypeScript and TSX, written in Rust.
Seshat combines function-level [CRAP](https://testing.googleblog.com/2011/02/this-code-is-crap.html) analysis with comparison-operator mutation
testing to help you find complex, insufficiently tested code.

The name comes from [Seshat](https://www.metmuseum.org/art/collection/search/548465),
the ancient Egyptian goddess of writing and record keeping. It reflects the
project's purpose: measuring code and recording evidence about its tests.

## What it does

- Calculates function complexity and CRAP scores from real statement coverage.
- Changes comparison operators one at a time and checks whether tests detect them.
- Runs tests in isolated source copies, preserving your working files.
- Produces terminal reports and versioned JSON, with optional CI thresholds.
- Supports explicit source selection, multiple test setups and parallel mutation workers.

## Status

Seshat is experimental. The current candidate runs on Linux x64 with glibc and
can be installed from a locally built npm package. It has not been published to
npm. The package has been verified in Debian 11/glibc 2.31 with Node 24.20.0.
Other platforms and a minimum supported kernel still need verification.

Node's test runner, Jest/Expo and Vitest have self-contained regression fixtures.
The verified Jest/Expo route is pinned to Jest 29.7.0, jest-expo 57.0.5 and
Expo 57.0.20; see the [Jest/Expo configuration example](docs/configuration.md#jestexpo-example)
and [installed-command proof](benchmarks/proofs/README.md#jestexpo-combined-workflow).
See the [release scope](docs/release-scope.md) and
[open issues](https://github.com/Binary-Balance/seshat/issues) for remaining work.

## Build and install

Building requires Rust 1.98.1, Node 24, npm, GCC, binutils and `dpkg-deb`.
Prepare the locked dependencies and Debian library archives using the
[package build instructions](packaging/README.md#build-and-verify-from-the-source-checkout),
then run from this checkout:

```sh
node packaging/pack.mjs work/debian11-inputs
```

The packaging command prints a tarball path. Install that file in the project
you want to assess:

```sh
npm install --save-dev --save-exact --ignore-scripts /absolute/path/to/package.tgz
./node_modules/.bin/seshat --help
```

The installed package runs the native executable directly and needs no Rust
toolchain or npm runtime dependencies. Your project supplies its test runner,
TypeScript checks and coverage tools. See [package details](packaging/README.md).

## Usage

Create a `seshat.json` file using the [configuration guide](docs/configuration.md),
then run:

```sh
./node_modules/.bin/seshat check --config ./seshat.json
./node_modules/.bin/seshat crap --config ./seshat.json
./node_modules/.bin/seshat mutate --config ./seshat.json
```

`check` runs both assessments. `crap` runs coverage and CRAP analysis.
`mutate` runs mutation testing after original typechecks and passing test baselines.

`check` and `mutate` accept `--experimental-switching` to compare mutants through
prepared helper code. Replacement remains the default strategy. Switching runs
only after the original typecheck, baseline and (for `check`) fresh coverage have
passed, and `crap` rejects the option. Helper wrapping can affect TypeScript
narrowing and runtime reflection, so treat this strategy as experimental.

For automation, use `--json` to write a report to stdout. Progress goes to stderr;
`--no-progress` suppresses it.

```sh
./node_modules/.bin/seshat check --config ./seshat.json --json > seshat-report.json
```

Run only trusted test commands. Source copies protect your checkout; tests still
have access to external files, services and databases.

## Understanding the results

**CRAP** combines a function's complexity and statement coverage:
`complexity² × (1 − coverage)³ + complexity`, where coverage is between 0 and 1.
Higher scores flag functions to investigate. A function with complexity 10 scores
110 at zero coverage, 22.5 at 50% coverage and 10 at full coverage.

**Mutation testing** checks whether tests detect deliberate comparison changes,
such as `>` becoming `>=`. The score is `killed / (killed + survived) × 100`.
Survivors can reveal missing boundary cases or assertions, but some changes may
be equivalent for valid inputs. Neither metric proves correctness.

Missing coverage, unresolved timeouts and execution errors make an assessment
incomplete. Seshat withholds the affected score instead of treating missing
evidence as success. [Optional thresholds](docs/configuration.md#quality-thresholds)
let a project decide which complete results should fail CI.

## Development

See the [build and regression guide](benchmarks/proofs/README.md),
[architecture](docs/architecture.md) and [benchmark guide](benchmarks/README.md).
Task status and acceptance criteria live in
[GitHub Issues](https://github.com/Binary-Balance/seshat/issues).

## License

[MIT](LICENSE).
