# Consumer examples

These directories are independent projects. Each has its own `package.json`
and lockfile and runs Seshat through an executable supplied by the caller. The
examples use Node 24.20.0. `source.include` and `source.exclude` choose the
files to assess. The resolved list is recorded in `scope.files`; selected
source files must also be included in `capture`.

## Run an example

Install the dependencies from the project directory, then run a native Seshat
executable directly:

```sh
npm ci
SESHAT=/absolute/path/to/seshat
"$SESHAT" check --config ./seshat.json --json --no-progress > seshat-report.json
```

The final `@binary-balance/seshat` package also has a Node launcher at
`packages/seshat/bin/seshat.mjs`. When that launcher is available, invoke it
through Node and pass its path to the focused verifier:

```sh
LAUNCHER=/absolute/path/to/packages/seshat/bin/seshat.mjs
node "$LAUNCHER" check --config ./seshat.json --json --no-progress > seshat-report.json
node /absolute/path/to/repo/examples/verify.mjs --cli "$LAUNCHER"
```

The launcher is not built in this preparatory tree. An installed package uses
the same entry under `node_modules/@binary-balance/seshat/bin/seshat.mjs` to
select its platform's native optional payload.
The verifier records a Node launcher hash as `cli.kind: "node-launcher"`; it
does not treat that hash as the identity of the native payload. A real native
executable is recorded as `cli.kind: "native-executable"` and can be checked
with `SESHAT_EXPECTED_BINARY_SHA256`. The Windows npm generated
`node_modules\.bin\seshat.cmd` route needs a separate release integration
proof.

PowerShell equivalents are:

```powershell
npm ci
$env:SESHAT = 'C:\path\to\seshat.exe'
& $env:SESHAT check --config .\seshat.json --json --no-progress |
  Tee-Object -FilePath .\seshat-report.json

$env:SESHAT = 'C:\path\to\packages\seshat\bin\seshat.mjs'
node $env:SESHAT check --config .\seshat.json --json --no-progress |
  Tee-Object -FilePath .\seshat-report.json
node .\examples\verify.mjs --cli $env:SESHAT --output .\work\public-consumer-examples.json
```

`examples/verify.mjs` accepts a native executable or a Node launcher. It passes
arguments as an argv array and does not evaluate caller supplied shell text.
The verifier installs every example in disposable copies, runs the normal
check, checks the expected scope, function coverage and mutation results,
compares one and two Seshat workers, checks link preservation, and exercises
threshold and incomplete-run exits for the Node example.

## Workers and resources

`workers` is a top-level Seshat setting and defaults to one. For example:

```json
{
  "workers": 2,
  "thresholds": {
    "maxCrap": 3,
    "minMutationScore": 75
  }
}
```

Each Seshat worker gets its own source copy and baseline. Tests still share
ports, files, databases and other external resources, so use more than one
worker only when those resources are isolated. Keep the test runner itself
sequential as the examples do with Node `--test-concurrency=1`, Jest
`--runInBand`, and the Vitest worker flags. Compare complete runs with the
same source, dependencies and test scope before keeping a faster setting. The
[configuration guide](../docs/configuration.md#parallel-execution) describes
the full worker and setup rules.

## Reports and exits

Use the JSON report to inspect `complete` and `quality.state` separately.
`scope.files` is the resolved source scope, `result.sources` contains function
coverage and CRAP values, and `result.mutation` contains `planned`, `killed`,
`survived`, `unresolved`, `score`, `workersRequested` and `workersUsed`.

```sh
node -e "const r=require('./seshat-report.json'); console.log({complete:r.complete, quality:r.quality.state, scope:r.scope.files, mutation:r.result.mutation});"
```

In PowerShell:

```powershell
$report = Get-Content .\seshat-report.json -Raw | ConvertFrom-Json
$report.complete
$report.quality.state
$report.scope.files
$report.result.mutation | Select-Object planned,killed,survived,unresolved,score,workersRequested,workersUsed
```

Exit 0 means complete execution with no failed applicable threshold. Exit 1
means complete execution with an unmet threshold. Exit 2 means invalid input,
a failed baseline, incomplete execution or output failure. Unix signal
cancellation uses 130 or 143. An incomplete run takes precedence over a
threshold failure. Without thresholds, a complete run reports its measurements
with `quality.state: "not-configured"`.

The Node example includes a small Istanbul collector. It supports the listed
UTF-8 TypeScript ESM files on Node 24.20.0 and the built-in test runner. It is
an example adapter, not a general V8 coverage converter.

Run the focused verifier from the repository root with a native executable:

```sh
SESHAT=/absolute/path/to/seshat
node examples/verify.mjs --cli "$SESHAT" --output /absolute/path/to/public-consumer-examples.json
```
