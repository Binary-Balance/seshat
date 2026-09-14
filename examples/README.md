# Consumer examples

These directories are independent projects. Each has its own `package.json`
and lockfile and runs Seshat through an executable supplied by the caller. The
examples use Node 24.20.0 and carry the test, typecheck and coverage
dependencies needed by their setup commands. `source.include` and
`source.exclude` choose the files to assess. The resolved list is recorded in
`scope.files`; selected source files must also be included in `capture`.

The complete configurations are [the Node single-package example](node),
[the workspace example](workspaces), [the Vitest example](vitest), and
[the Jest and Expo example](jest-expo). The shared rules are in the
[configuration guide](../docs/configuration.md), and the stable report fields
are in the [report format](../docs/report-format.md).

## Install and run a local candidate

The rc.1 candidate is unpublished. Follow the same six-archive recipe as the
[root README](../README.md#install-an-unpublished-local-candidate), from the
example project's root. For `workspaces`, that is `examples/workspaces`, not
`packages/rules`. The root `package.json` and `package-lock.json` must receive
the candidate dependencies. Keep all six archives under the example root's
`vendor/seshat` directory.

On POSIX, from an example project root:

```sh
npm ci
mkdir -p vendor/seshat
cp /path/to/seshat-entry.tgz vendor/seshat/entry.tgz
cp /path/to/seshat-linux-x64-release.tgz vendor/seshat/linux-x64.tgz
cp /path/to/seshat-linux-arm64-release.tgz vendor/seshat/linux-arm64.tgz
cp /path/to/seshat-darwin-x64-release.tgz vendor/seshat/darwin-x64.tgz
cp /path/to/seshat-darwin-arm64-release.tgz vendor/seshat/darwin-arm64.tgz
cp /path/to/seshat-win32-x64-release.tgz vendor/seshat/win32-x64.tgz

npm install --save-dev --save-exact --ignore-scripts \
  vendor/seshat/entry.tgz
npm install --save-optional --save-exact --ignore-scripts \
  vendor/seshat/linux-x64.tgz \
  vendor/seshat/linux-arm64.tgz \
  vendor/seshat/darwin-x64.tgz \
  vendor/seshat/darwin-arm64.tgz \
  vendor/seshat/win32-x64.tgz
npm ci --ignore-scripts --offline

./node_modules/.bin/seshat check --config ./seshat.json \
  --json --no-progress > seshat-report.json
```

The first archive is a root `devDependency`. The five native archives are root
`optionalDependencies`; npm installs only the one matching the current host
and keeps all five `file:vendor/seshat/...` entries in the lockfile. npm does
not accept `--save-dev` and `--save-optional` in one command, so keep the two
install commands separate. The final offline `npm ci` needs the consuming
project's registry dependencies and metadata in the npm cache.

PowerShell uses the same commands from the example or workspace root:

```powershell
npm ci
$artifactDir = 'C:\path\to\candidate-archives'
New-Item -ItemType Directory -Force vendor\seshat | Out-Null
Copy-Item "$artifactDir\seshat-entry.tgz" vendor\seshat\entry.tgz
Copy-Item "$artifactDir\seshat-linux-x64-release.tgz" vendor\seshat\linux-x64.tgz
Copy-Item "$artifactDir\seshat-linux-arm64-release.tgz" vendor\seshat\linux-arm64.tgz
Copy-Item "$artifactDir\seshat-darwin-x64-release.tgz" vendor\seshat\darwin-x64.tgz
Copy-Item "$artifactDir\seshat-darwin-arm64-release.tgz" vendor\seshat\darwin-arm64.tgz
Copy-Item "$artifactDir\seshat-win32-x64-release.tgz" vendor\seshat\win32-x64.tgz

npm install --save-dev --save-exact --ignore-scripts .\vendor\seshat\entry.tgz
npm install --save-optional --save-exact --ignore-scripts `
  .\vendor\seshat\linux-x64.tgz `
  .\vendor\seshat\linux-arm64.tgz `
  .\vendor\seshat\darwin-x64.tgz `
  .\vendor\seshat\darwin-arm64.tgz `
  .\vendor\seshat\win32-x64.tgz
npm ci --ignore-scripts --offline

& .\node_modules\.bin\seshat.cmd check --config .\seshat.json `
  --json --no-progress | Tee-Object -FilePath .\seshat-report.json
```

For a standalone run, use only the matching native archive. Replace `linux-x64`
below with the matching host target when needed. On POSIX:

```sh
NATIVE_TGZ=vendor/seshat/linux-x64.tgz
mkdir -p seshat-standalone
tar -xzf "$NATIVE_TGZ" --strip-components=1 -C seshat-standalone
SESHAT=./seshat-standalone/bin/seshat
"$SESHAT" check --config ./seshat.json --json --no-progress \
  > seshat-report.json
```

For a standalone Windows run, extract `vendor\seshat\win32-x64.tgz` with
`tar.exe` and invoke `package\bin\seshat.exe` directly. Hosted Windows
consumer verification of the local npm recipe remains pending. Both routes
still need the example project's Node, test runner, TypeScript and coverage
dependencies.

Run the focused verifier from the repository root with either an installed
launcher or a native executable:

```sh
LAUNCHER=/absolute/path/to/node_modules/@binary-balance/seshat/bin/seshat.mjs
node examples/verify.mjs --cli "$LAUNCHER" \
  --output /absolute/path/to/public-consumer-examples.json
```

The verifier installs every example in disposable copies, runs the normal
check, checks the expected scope, function coverage and mutation results,
compares one and two Seshat workers, checks link preservation, and exercises
threshold and incomplete-run exits for the Node example. It passes arguments as
an argv array and does not evaluate caller supplied shell text. The separate
`benchmarks/proofs/npm-package.mjs` proof uses a disposable loopback registry
and a populated npm cache; that proof is local packaging evidence, not a
published-registry installation route.

## Select source and capture

For a single package, include the source tree and capture the project files
needed by its setups:

```json
{
  "source": {
    "include": ["src/**/*.ts"],
    "exclude": ["src/ignored.ts"]
  },
  "capture": [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "collect-node.mjs",
    "src",
    "tests",
    "node_modules"
  ]
}
```

For a workspace, capture the workspace manifests and each internal package
that the tests can reach:

```json
{
  "source": {
    "include": ["src/**/*.ts", "packages/**/*.ts"]
  },
  "capture": [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "collect-node.mjs",
    "packages",
    "tests",
    "node_modules"
  ]
}
```

`capture` entries are literal project-relative paths; they do not accept
globs. Include patterns use `/`, are case-sensitive on Unix and
case-insensitive on Windows, and support `*` within a directory and `**` across
directories. Seshat assesses regular UTF-8 `.ts`, `.tsx`, `.mts`, and `.cts`
files. A selected source file must be captured. Internal workspace links must
have captured targets; external, dangling and cyclic links are rejected, and
captured links are rewritten in the worker copy. Inspect the resolved scope in
the report before changing a pattern:

```sh
./node_modules/.bin/seshat check --config ./seshat.json \
  --json --no-progress > seshat-report.json
node -e "const r=require('./seshat-report.json'); console.log(r.scope.files)"
```

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
`scope.files` is the resolved source scope. `result.sources` contains function
coverage and CRAP values for `check` and `crap`; `result.mutation` on `check`
and `mutate` contains `planned`, `killed`, `survived`, `unresolved`, `score`,
`workersRequested` and `workersUsed`. The stable field and nullability rules
are in the [report format](../docs/report-format.md).

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

CRAP uses `complexity^2 * (1 - coverage)^3 + complexity`. For complexity 10,
zero, half and full statement coverage produce `110`, `22.5` and `10`. Missing
or unreliable coverage is `unknown`, not zero; an empty function is
`not-applicable`, and class field or static block rows are `complexity-only`.
For three mutants with two killed and one survived, the score is
`2 / (2 + 1) * 100 = 66.666...`. Timeouts and execution errors are unresolved,
and a complete run with no mutants has `score: null` because mutation is not
applicable.

Exit 0 means complete execution with no failed applicable threshold. Exit 1
means complete execution with an unmet threshold. Exit 2 means invalid input,
a failed baseline, incomplete execution or output failure. Unix signal
cancellation uses 130 or 143. On Windows, handled console cancellation uses
exit 2 and sets `report.signal` to 2. An incomplete run takes precedence over a
threshold failure. Without thresholds, a complete run reports its measurements
with `quality.state: "not-configured"`.

Seshat cannot promise JSON when its executable or interpreter cannot start,
stdout cannot be written, or the operating system forcibly kills the process.

The Node example includes a small Istanbul collector. It supports the listed
UTF-8 TypeScript ESM files on Node 24.20.0 and the built-in test runner. It is
an example adapter, not a general V8 coverage converter.
