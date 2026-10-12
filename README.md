# Seshat

> Seshat was the ancient Egyptian goddess of writing, wisdom, and knowledge. Seen as a scribe and record keeper, she became identified as the goddess of measurement, accounting, architecture, science, astronomy, mathematics, geometry, history and surveying.

A native code-assurance tool for TypeScript and TSX, written in Rust. Seshat
combines function-level [CRAP](https://testing.googleblog.com/2011/02/this-code-is-crap.html)
analysis with [comparison-operator mutation testing](https://en.wikipedia.org/wiki/Mutation_testing) to find complex and/or
insufficiently tested code.

## What Seshat does

- Calculates function complexity and CRAP scores from branch coverage.
- Changes comparison operators one at a time and checks whether tests detect them.
- Replaces function bodies to find covered functions whose removal tests miss.
- Runs tests in isolated copies of the captured project.
- Produces readable terminal output and versioned JSON, with optional CI thresholds.
- Supports explicit source selection, multiple test setups and parallel mutation workers.

## Install

```sh
npm install --save-dev @binary-balance/seshat
```

Seshat needs Node `>=24.20.0 <25`. npm installs a prebuilt binary for Linux
x64/ARM64 (glibc), macOS x64/ARM64 or Windows x64, so Rust is not required.
Alpine Linux, which uses musl instead of glibc, is not supported. See the
[platform support matrix](docs/platform-support.md) for details.

The project being assessed must already have its own dependencies installed,
including TypeScript, its test runner and a coverage tool.

## Supported test runners

| Runner | Supported versions |
| --- | --- |
| Node's built-in test runner | Node `>=24.20.0 <25` |
| Vitest | `>=5.0.0 <6` |
| Jest with Expo | Jest `29.7.0` with jest-expo `57.0.5` |

Seshat checks the runner version on every run and stops if it is not
supported. See the [runner compatibility guide](docs/runner-compatibility.md).

## Configure

Add a `seshat.json` to the project root. This one is for Node's built-in test
runner:

```json
{
  "source": {
    "include": ["src/**/*.ts"]
  },
  "capture": [
    "package.json", "package-lock.json", "tsconfig.json", "collect-node.mjs",
    "src", "tests", "node_modules"
  ],
  "setups": [{
    "name": "node",
    "runner": "node",
    "cwd": ".",
    "typecheck": ["node", "node_modules/typescript/bin/tsc", "--project", "tsconfig.json"],
    "test": [
      "node", "--test", "--test-concurrency=1",
      "--test-reporter={seshatReporter}", "tests/rules.test.mjs"
    ],
    "coverage": {
      "command": ["node", "collect-node.mjs", "tests/rules.test.mjs"],
      "report": "coverage/coverage-final.json"
    }
  }]
}
```

- `source` selects the files to assess, using glob patterns.
- `capture` lists the files and directories copied into each isolated run. It
  must include the selected source and everything the commands need.
- `setups` gives the typecheck, test and coverage commands. The coverage
  command must write an Istanbul JSON report; `collect-node.mjs` is a small
  adapter from the [Node example](examples/node).

The [examples](examples/README.md) include complete Node, npm workspace, Vitest
and Jest/Expo projects. The [configuration guide](docs/configuration.md) covers
every field, including `workers` for parallel mutation runs.

## Use

```sh
npx @binary-balance/seshat check    # CRAP and mutation testing
npx @binary-balance/seshat crap     # coverage and CRAP only
npx @binary-balance/seshat mutate   # mutation testing only
```

Use the full package name with `npx`. A bare `npx seshat` can fetch an
unrelated package of that name.

Each command reads `./seshat.json`; use `--config PATH` for another file. Add
`--json` to write a report to stdout, as described in the
[report format](docs/report-format.md). `--help` lists all options.

Run only trusted test commands. Seshat's copies protect the project checkout,
but tests can still access external files, services, databases and credentials.

## Understand the results

CRAP uses complexity and branch coverage, a fraction from 0 to 1. Functions
with no recorded branches use statement coverage instead:

```text
complexity^2 * (1 - coverage)^3 + complexity
```

For complexity 10, zero coverage gives `110`, 50% coverage gives `22.5` and
full coverage gives `10`.

Statement coverage counts code that ran; branch coverage counts the recorded
outcomes of decisions. For example, testing only the member price in
`if (member) total *= 0.9; return total;` can run every statement while
leaving the non-member outcome untested. Its statement coverage is 100%,
but its branch coverage is 50%. Both measurements appear in the report.

The mutation score is the percentage of mutants that made a test fail. A mutant
is one changed comparison, such as `>` to `>=`. If tests catch two of three
mutants, the score is `66.67%`. A timeout or execution error leaves the run
incomplete and withholds the score. Neither score proves correctness.

`check` and `mutate` also replace eligible function bodies to detect pseudo-tested
functions, those whose body replacement tests miss despite positive coverage.
These flags and counts are separate from the comparison mutation score. `mutate`
collects fresh coverage to skip unexecuted functions; it does not apply CRAP
thresholds. Extreme mutation uses replacement even with experimental switching.

## Use in CI

Add optional thresholds to `seshat.json`:

```json
"thresholds": {
  "maxCrap": 30,
  "minMutationScore": 80
}
```

| Exit status | Meaning |
| ---: | --- |
| `0` | Complete run, thresholds met. |
| `1` | Complete run, a threshold was not met. |
| `2` | Invalid input, failed baseline or incomplete run. |
| `130` / `143` | Cancelled by `SIGINT` / `SIGTERM` on Unix. |

See [quality thresholds](docs/configuration.md#quality-thresholds) for the full
rules.

## Development

See the [architecture](docs/architecture.md), the
[build and regression guide](benchmarks/proofs/README.md) and the
[packaging guide](packaging/README.md).

## License

[MIT](LICENSE).
