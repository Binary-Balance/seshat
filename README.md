# Seshat

A native code-assurance tool for TypeScript and TSX, written in Rust. Seshat
combines function-level [CRAP](https://testing.googleblog.com/2011/02/this-code-is-crap.html)
analysis with comparison-operator mutation testing to find complex,
insufficiently tested code.

## What it does

- Calculates function complexity and CRAP scores from statement coverage.
- Changes comparison operators one at a time and checks whether tests detect them.
- Runs tests in isolated copies of the captured project.
- Produces readable terminal output and versioned JSON, with optional CI thresholds.
- Supports explicit source selection, multiple test setups and parallel mutation workers.

## Candidate status

Version `0.1.0-rc.1` is an unpublished release candidate. Its npm layout is an
entry package, `@binary-balance/seshat@0.1.0-rc.1`, with these exact-version
optional native packages:

- `@binary-balance/seshat-linux-x64@0.1.0-rc.1`
- `@binary-balance/seshat-linux-arm64@0.1.0-rc.1`
- `@binary-balance/seshat-darwin-x64@0.1.0-rc.1`
- `@binary-balance/seshat-darwin-arm64@0.1.0-rc.1`
- `@binary-balance/seshat-win32-x64@0.1.0-rc.1`

The entry package owns the npm `seshat` command. Its Node launcher selects the
matching native package and forwards arguments, output and status. The native
archives also work as standalone installations. The target boundaries are in
the [historical platform support matrix](docs/platform-support.md); the final
rc.1 artifact, hash and support summary are still pending release integration.
There is no published npm package or public download for this candidate.

The verified consumer runtime is Node 24.20.0. Install the test runner,
TypeScript and coverage packages required by the project before running Seshat.
Consuming projects do not need Rust. Rust is only needed to build a native
archive, as described in the [packaging guide](packaging/README.md).

## Install an unpublished local candidate

Install the entry archive and the native archive for the host together. This
Linux x64 example uses local files, because the candidate is not in the npm
registry:

```sh
npm ci
ENTRY_TGZ=/absolute/path/to/binary-balance-seshat-0.1.0-rc.1.tgz
NATIVE_TGZ=/absolute/path/to/binary-balance-seshat-linux-x64-0.1.0-rc.1.tgz

npm install --save-dev --save-exact --ignore-scripts "$ENTRY_TGZ" "$NATIVE_TGZ"
./node_modules/.bin/seshat --version
```

Use the matching `linux-arm64`, `darwin-x64`, `darwin-arm64` or `win32-x64`
archive on another supported host. `./node_modules/.bin/seshat` is the Node
launcher. It selects the exact native optional package installed for the host.
The native package itself has no npm command. To invoke that executable
directly on Linux, use:

```sh
./node_modules/@binary-balance/seshat-linux-x64/bin/seshat --version
```

PowerShell uses the same local archives and the npm-generated command shim:

```powershell
npm ci
$entryTgz = 'C:\path\to\binary-balance-seshat-0.1.0-rc.1.tgz'
$nativeTgz = 'C:\path\to\binary-balance-seshat-win32-x64-0.1.0-rc.1.tgz'
npm install --save-dev --save-exact --ignore-scripts $entryTgz $nativeTgz
& .\node_modules\.bin\seshat.cmd --version
```

The Windows command shim is part of the remaining hosted release integration
proof. The command above is the intended consumer route.

The native archive is also the standalone route. Extract it into a disposable
directory and run its binary directly:

```sh
STANDALONE_DIR="$PWD/seshat-standalone"
mkdir -p "$STANDALONE_DIR"
tar -xzf "$NATIVE_TGZ" --strip-components=1 -C "$STANDALONE_DIR"
"$STANDALONE_DIR/bin/seshat" --version
```

Standalone execution does not install npm packages or need Rust. The commands
in your `seshat.json` still run with the project's Node, test runner and
coverage dependencies.

Maintainers can check npm's platform selection with the prepared local
archives:

```sh
node benchmarks/proofs/npm-package.mjs "$ENTRY_TGZ" "$NATIVE_TGZ"
```

That proof uses a disposable loopback registry because the exact optional
packages are unpublished. Its offline `npm ci` step reuses metadata and package
bytes cached by the earlier registry install. It proves populated-cache replay,
not fresh-cache offline installation or a public registry release.

## Run an assessment

After installing the consuming project's dependencies and candidate, run from
the project that contains `seshat.json`:

```sh
./node_modules/.bin/seshat check --config ./seshat.json
./node_modules/.bin/seshat crap --config ./seshat.json
./node_modules/.bin/seshat mutate --config ./seshat.json
```

`check` runs CRAP and mutation testing. `crap` runs fresh coverage and CRAP
only. `mutate` runs original typechecks and test baselines, then mutation
testing without collecting coverage or calculating CRAP. Every command uses
the same source, capture and setup configuration. The [configuration guide](docs/configuration.md)
contains runnable Node, npm workspace, Vitest and Jest/Expo setups.

The default mutation strategy replaces one comparison in an isolated copy.
`check` and `mutate` also accept `--experimental-switching`, which prepares
helper code and selects one comparison through the experimental switching
route. It runs only after original checks and, for `check`, fresh coverage have
passed. `crap` rejects this option. Switching does not typecheck transformed
helpers and can affect TypeScript narrowing, reflection or source-text
observations. Compare it with replacement before relying on it.

For automation, `--json` writes one report to stdout and progress to stderr.
`--no-progress` suppresses progress messages without removing final measurements:

```sh
./node_modules/.bin/seshat check --config ./seshat.json --json --no-progress > seshat-report.json
```

Run only trusted test commands. Seshat's copies protect the project checkout,
but tests can still access external files, services, databases and credentials.

## Select source and capture

The full runnable setups are in the [Node example](examples/node/seshat.json)
and [workspace example](examples/workspaces/seshat.json). Their source and
capture sections show the difference between selecting files to assess and
copying the inputs that setup commands need.
These excerpts show only those two top-level sections; keep the setup block from
the linked file.

For a single package:

```json
{
  "source": {
    "include": ["src/**/*.ts"],
    "exclude": ["src/ignored.ts"]
  },
  "capture": [
    "package.json", "package-lock.json", "tsconfig.json", "collect-node.mjs",
    "src", "tests", "node_modules"
  ]
}
```

For an npm workspace:

```json
{
  "source": {
    "include": ["src/**/*.ts", "packages/**/*.ts"]
  },
  "capture": [
    "package.json", "package-lock.json", "tsconfig.json", "collect-node.mjs",
    "src", "packages", "tests", "node_modules"
  ]
}
```

`source.include` and `source.exclude` use project-relative `/` patterns. `*`
matches within a directory and `**` across directories. `capture` entries are
literal files or directories, not globs. Selected source must be captured;
workspace links must resolve to captured internal packages. Inspect the resolved
scope before interpreting a score:

```sh
./node_modules/.bin/seshat check --config ./seshat.json \
  --json --no-progress > seshat-report.json
node -e "const r=require('./seshat-report.json'); console.log(r.scope.files)"
```

The [configuration guide](docs/configuration.md) covers the full source rules,
workspace link boundaries and runner setup fields.

## Parallel execution

`workers` is a top-level setting and defaults to one. Each Seshat worker gets an
independent source copy and baseline, but test processes still share external
ports, files and databases. Use more workers only when those resources are
isolated, and keep runner concurrency bounded with Node
`--test-concurrency=1`, Jest `--runInBand` or the Vitest worker flags. Compare
complete runs with workers set to one and two before keeping a faster setting;
copying and extra baselines can make more workers slower.

## Understand the results

CRAP uses statement coverage as a fraction from 0 to 1:

```text
complexity^2 * (1 - coverage)^3 + complexity
```

For complexity 10, zero coverage gives `110`, 50% coverage gives `22.5`, and
full coverage gives `10`. A missing or unreliable counter is `unknown`, not a
measured zero. An empty function is `not-applicable`; it has no executable
statements to score. Class field initialisers and static blocks keep their
complexity as `complexity-only` rows and have no CRAP score.

Mutation testing changes comparisons such as `>` to `>=`. If three mutants
produce two test failures and one passing test run, the score is
`2 / (2 + 1) * 100 = 66.666...`. A timeout, execution error or unstarted job is
unresolved and does not count as killed. An incomplete run withholds the final
score. A complete run with no mutants reports `score: null`, meaning not
applicable. Neither score proves correctness.

The stable machine-readable fields are documented in the [report format](docs/report-format.md).
In particular, `complete` describes execution evidence while
`quality.state` describes threshold evaluation. Keep both when inspecting a
result.

## CI exits and reports

Capture the report and preserve the process status. A threshold failure is a
complete run with exit 1, so CI should not replace that status with the status
of a later report-inspection command:

```sh
set +e
./node_modules/.bin/seshat check --config ./seshat.json --json --no-progress > seshat-report.json
status=$?
set -e
node -e "const r=JSON.parse(require('node:fs').readFileSync('seshat-report.json','utf8')); console.log({complete:r.complete, quality:r.quality?.state});"
exit "$status"
```

PowerShell equivalent:

```powershell
& .\node_modules\.bin\seshat.cmd check --config .\seshat.json --json --no-progress > .\seshat-report.json
$status = $LASTEXITCODE
$report = Get-Content .\seshat-report.json -Raw | ConvertFrom-Json
"complete=$($report.complete) quality=$($report.quality.state)"
exit $status
```

Add optional thresholds at the top level of `seshat.json`:

```json
"thresholds": {
  "maxCrap": 30,
  "minMutationScore": 80
}
```

`maxCrap` applies to each measured function and `minMutationScore` applies to a
complete mutation run. Equality passes using unrounded values. Omit a field or
set it to `null` to disable it; incomplete execution takes precedence over a
threshold failure.

| Exit status | Meaning |
| ---: | --- |
| `0` | Complete execution with no failed applicable threshold. |
| `1` | Complete execution with an unmet applicable threshold. |
| `2` | Invalid input, failed baseline, incomplete execution, output failure, or handled Windows console cancellation. |
| `130` / `143` | Handled Unix `SIGINT` / `SIGTERM` cancellation. |

On Windows, handled `CTRL_C_EVENT` and `CTRL_BREAK_EVENT` return `2` and set
`cancelled: true` and `signal: 2` in the report. That `2` is a Windows
cancellation marker, not a POSIX signal number. Seshat cannot promise a JSON
report when its executable or interpreter cannot start, stdout cannot be
written, or the operating system forcibly kills the process. A child command
that fails after Seshat starts can still leave an execution-error in the JSON.

Use `seshat --help`, `seshat --version` and `seshat <command> --help` as text
commands. They do not read configuration. If an invalid argument combination
includes `--json`, the native CLI emits the argument-error JSON envelope with
`command: null`.

## Development

See the [build and regression guide](benchmarks/proofs/README.md),
[architecture](docs/architecture.md), [release scope](docs/release-scope.md)
and [platform support matrix](docs/platform-support.md). The checked consumer
projects are documented in the [examples guide](examples/README.md).

## License

[MIT](LICENSE).
