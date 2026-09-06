# Seshat

A native code-assurance tool for TypeScript and TSX, written in Rust.
Seshat combines function-level CRAP analysis with comparison-operator mutation
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
npm. The package has been verified on glibc 2.41 with Node 24.20.0; other platforms
and older Linux distributions still need verification.

Node's test runner and Vitest have self-contained regression fixtures. Jest/Expo
support is experimental and still needs a standalone public integration fixture.
See the [release scope](docs/release-scope.md) and
[open issues](https://github.com/Binary-Balance/seshat/issues) for remaining work.

## Build and install

Building requires Rust 1.98.1, Node 24 and npm. From this checkout:

```sh
export CARGO_TARGET_DIR="$PWD/benchmarks/rust/target"
cargo build --release --locked --manifest-path benchmarks/proofs/Cargo.toml --bins
node packaging/pack.mjs
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
