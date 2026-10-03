# Seshat

> Seshat was the ancient Egyptian goddess of writing, wisdom, and knowledge. Seen as a scribe and record keeper, she became identified as the goddess of measurement, accounting, architecture, science, astronomy, mathematics, geometry, history and surveying.

A native code-assurance tool for TypeScript and TSX, written in Rust. Seshat
combines function-level [CRAP](https://testing.googleblog.com/2011/02/this-code-is-crap.html)
analysis with [comparison-operator mutation testing](https://en.wikipedia.org/wiki/Mutation_testing) to find complex and/or
insufficiently tested code.

## What Seshat does

- Calculates function complexity and CRAP scores from statement coverage.
- Changes comparison operators one at a time and checks whether tests detect them.
- Runs tests in isolated copies of the captured project.
- Produces readable terminal output and versioned JSON, with optional CI thresholds.
- Supports explicit source selection, multiple test setups and parallel mutation workers.

## Install

```sh
npm install --save-dev @binary-balance/seshat
```

Seshat needs Node `>=24.20.0 <25`. npm installs a prebuilt binary for Linux
x64/ARM64, macOS x64/ARM64 or Windows x64, so Rust is not required. See the
[platform support matrix](docs/platform-support.md) for details.

The project being assessed must already have its own dependencies installed,
including TypeScript, its test runner and a coverage tool.

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
npx seshat check    # CRAP and mutation testing
npx seshat crap     # coverage and CRAP only
npx seshat mutate   # mutation testing only
```

Each command reads `./seshat.json`; use `--config PATH` for another file. Add
`--json` to write a report to stdout, as described in the
[report format](docs/report-format.md). `seshat --help` lists all options.

Run only trusted test commands. Seshat's copies protect the project checkout,
but tests can still access external files, services, databases and credentials.

## Understand the results

CRAP uses complexity and statement coverage (a fraction from 0 to 1):

```text
complexity^2 * (1 - coverage)^3 + complexity
```

For complexity 10, zero coverage gives `110`, 50% coverage gives `22.5` and
full coverage gives `10`.

The mutation score is the percentage of mutants that made a test fail. A mutant
is one changed comparison, such as `>` to `>=`. If tests catch two of three
mutants, the score is `66.67%`. A timeout or execution error leaves the run
incomplete and withholds the score. Neither score proves correctness.

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

## Development

See the [architecture](docs/architecture.md), the
[build and regression guide](benchmarks/proofs/README.md) and the
[packaging guide](packaging/README.md).

## License

[MIT](LICENSE).
