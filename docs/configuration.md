# Configuration

Current source accepts stable Node versions `>=24.20.0 <25`. The published 0.1.0 package
still requires 24.20.0. See the [runner compatibility matrix](runner-compatibility.md)
for the exact runner versions and retained checks.

This guide follows the current `main` source. See the [release status](../README.md#release-status)
for the distinction between published `0.1.0` and unreleased fixes.

Place a declarative `seshat.json` in the project to assess. Its directory is the
project root. `seshat check` reads `./seshat.json` by default; `--config PATH`
selects another file. Unknown fields, duplicate fields and invalid paths fail
before execution. Configuration is JSON, with no inheritance or executable code.

Install the project's dependencies before running Seshat. It copies the selected
inputs and installed dependencies into an execution copy; it does not install or
configure Node, TypeScript, a test runner or a coverage provider. Commands in a
setup are argument arrays and do not run through a shell.

For a local 0.1.0 archive, use the [six-archive local installation
recipe](../README.md#install-a-local-010-archive) from the project root. For an
npm workspace, that is the workspace root containing its root `package.json`
and `package-lock.json`. Keep the entry and all five native archives under the
project-relative `vendor/seshat` directory. The two npm install commands write
the entry as a root dev dependency and the native payloads as root optional
dependencies, then `npm ci --ignore-scripts --offline` replays the complete
lockfile. The offline step needs the consuming project's registry metadata and
package bytes in npm's cache. Standalone extraction still uses one matching
native archive and does not use npm.

The [Node example](../examples/node/seshat.json) and
[npm workspace example](../examples/workspaces/seshat.json) are complete
single-package and workspace configurations. The [consumer examples guide](../examples/README.md)
has the matching install and report commands.

## Node built-in test runner

The Node setup uses the built-in test runner with a small Istanbul adapter. The
adapter is checked in with the [Node example](../examples/node/README.md) and
the [workspace example](../examples/workspaces/README.md). It supports the
listed UTF-8 TypeScript ESM files on Node `>=24.20.0 <25`. It is an example adapter,
not a general V8 or c8 coverage converter.

For a single-package project, the important shape is:

```json
{
  "source": {
    "include": ["src/**/*.ts"],
    "exclude": ["src/ignored.ts"]
  },
  "capture": [
    "package.json", "package-lock.json", "tsconfig.json", "collect-node.mjs",
    "src", "tests", "node_modules"
  ],
  "setups": [{
    "name": "node",
    "runner": "node",
    "cwd": ".",
    "timeoutMs": 30000,
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

The test command must include Node's `--test-reporter={seshatReporter}`
placeholder. The coverage command must write a fresh full Istanbul JSON file at
the configured `report` path. The collector includes selected but unimported
files with zero statement counters.

For an npm workspace, include both source roots and capture both the root and
workspace inputs:

```json
{
  "source": {"include": ["src/**/*.ts", "packages/**/*.ts"]},
  "capture": [
    "package.json", "package-lock.json", "tsconfig.json", "collect-node.mjs",
    "src", "packages", "tests", "node_modules"
  ]
}
```

Use the `setups` block from the [workspace configuration](../examples/workspaces/seshat.json);
both its test and coverage commands target `tests/check.mjs`.
After `npm ci`, npm workspace links must resolve inside the captured inputs.
Seshat rewrites those internal links in its execution copy.

## Jest/Expo example

This example follows the [public Jest/Expo example](../examples/jest-expo/README.md).
The verified route uses Node `>=24.20.0 <25`, Jest 29.7.0, jest-expo 57.0.5, Expo
57.0.20, React Native 0.86.3, `@react-native/jest-preset` 0.86.3,
`babel-preset-expo` 57.0.10, React 19.2.3 and TypeScript 6.0.3. The fixture
uses Jest Circus with Babel coverage and a fresh Istanbul JSON report.

Use the fixture's `jest.config.cjs` (`preset: 'jest-expo'`) and
`babel.config.cjs` (`babel-preset-expo`) with this `seshat.json` shape:

```json
{
  "source": {"include": ["src/status.tsx"]},
  "capture": [
    "package.json", "package-lock.json", "tsconfig.json",
    "babel.config.cjs", "jest.config.cjs", "src", "tests", "node_modules"
  ],
  "setups": [{
    "name": "jest-expo",
    "runner": "jest",
    "cwd": ".",
    "timeoutMs": 60000,
    "typecheck": ["node", "node_modules/typescript/bin/tsc", "--project", "tsconfig.json"],
    "test": [
      "node", "node_modules/jest/bin/jest.js", "--config", "jest.config.cjs",
      "--runInBand", "--runTestsByPath", "tests/status.test.tsx",
      "--reporters=default", "--reporters={seshatReporter}", "--env={seshatEnvironment}"
    ],
    "coverage": {
      "command": [
        "node", "node_modules/jest/bin/jest.js", "--config", "jest.config.cjs",
        "--runInBand", "--runTestsByPath", "tests/status.test.tsx",
        "--reporters=default", "--reporters={seshatReporter}", "--env={seshatEnvironment}",
        "--coverage", "--coverageProvider=babel", "--coverageReporters=json",
        "--coverageDirectory=coverage", "--collectCoverageFrom", "src/status.tsx"
      ],
      "report": "coverage/coverage-final.json"
    }
  }]
}
```

Install the fixture dependencies with `npm ci`, then run the fixture from its
directory with the local launcher or native executable. The checked configuration
is also in [examples/jest-expo/seshat.json](../examples/jest-expo/seshat.json).
For the maintainer proof from the repository root, `--tarball` accepts a prepared
native archive and `--cli` accepts an installed native executable:

```sh
node benchmarks/proofs/jest-expo-check.mjs \
  --tarball /absolute/path/to/binary-balance-seshat-linux-x64-0.1.0.tgz
# or:
node benchmarks/proofs/jest-expo-check.mjs \
  --cli /absolute/path/to/node_modules/@binary-balance/seshat-linux-x64/bin/seshat
```

The setup uses `{seshatReporter}` and `{seshatEnvironment}` with the default
`jest-expo` environment, Jest Circus and one Jest project. Its coverage command
uses Babel instrumentation, `--coverageReporters=json` and
`--collectCoverageFrom`, and writes `coverage/coverage-final.json`. Use
`--runInBand` and tune Seshat's top-level `workers` setting instead of enabling
Jest's own parallel execution. Custom Jest runners, environments and projects
are outside this tested setup. See the [Jest/Expo proof workflow](../benchmarks/proofs/README.md#jestexpo-combined-workflow)
for the retained failure controls. The stable field and nullability rules are
in the [report format](report-format.md).

## Vitest

This example follows the [public Vitest example](../examples/vitest/README.md),
which has TypeScript, React TSX, a Fastify route and three Vitest tests. Adjust
the source paths and capture list for your project. The tested runner is Vitest
5.0.0 with `@vitest/coverage-istanbul` 5.0.0 and Node `>=24.20.0 <25`.

Merge these settings into `vitest.config.mjs`:

```js
export default {
  test: {
    runner: process.env.SESHAT_VITEST_RUNNER,
    include: ['tests/stack.test.tsx'],
    coverage: {
      provider: 'istanbul',
      include: ['src/tempo.ts', 'src/view.tsx', 'src/server.ts'],
      reporter: ['json'],
      reportsDirectory: 'coverage',
    },
  },
};
```

Ordinary Vitest runs use its default runner when the environment variable is
absent. Seshat's integration does not compose with another custom runner.

Use this `seshat.json` with the example's package and TypeScript configuration:

```json
{
  "source": {
    "include": ["src/**/*.ts", "src/**/*.tsx"],
    "exclude": ["src/ignored.ts"]
  },
  "capture": [
    "package.json", "package-lock.json", "tsconfig.json", "vitest.config.mjs",
    "src", "tests", "node_modules"
  ],
  "workers": 1,
  "setups": [
    {
      "name": "vitest",
      "runner": "vitest",
      "cwd": ".",
      "timeoutMs": 30000,
      "typecheck": ["node", "node_modules/typescript/bin/tsc", "--project", "tsconfig.json"],
      "test": [
        "node", "node_modules/vitest/vitest.mjs", "run", "--config", "vitest.config.mjs",
        "--maxWorkers=1", "--no-file-parallelism", "--maxConcurrency=1",
        "--reporter=default", "--reporter={seshatReporter}"
      ],
      "coverage": {
        "command": [
          "node", "node_modules/vitest/vitest.mjs", "run", "--config", "vitest.config.mjs",
          "--maxWorkers=1", "--no-file-parallelism", "--maxConcurrency=1",
          "--reporter=default", "--reporter={seshatReporter}", "--coverage"
        ],
        "report": "coverage/coverage-final.json"
      }
    }
  ]
}
```

Install your project's dependencies before running Seshat. The complete checked
configuration is in [examples/vitest/seshat.json](../examples/vitest/seshat.json).
The coverage command uses the Istanbul provider, writes JSON to
`coverage/coverage-final.json`, and passes `{seshatReporter}`. The [report format](report-format.md)
defines the stable result fields.

## Source and capture

`source.include` and optional `source.exclude` select the files to assess. Both
CRAP and mutation testing use that scope, and reports list the resolved files.
Patterns use `/` separators and are relative to the project root. Matching is
case-sensitive on Unix and case-insensitive on Windows. `*` matches within a
directory and `**` spans directories. Brace expansion and leading `!` are not
supported; use separate patterns and the `exclude` array.

Each include must match a file. Selected files must be regular UTF-8 TypeScript
or TSX files, including `.mts` and `.cts`. Exclude declaration files and tests
explicitly. An exclusion cannot leave the source scope empty. Source discovery
skips `.git`, `node_modules` and directory symlinks.

`capture` lists literal files and directories needed to run tests. It is not a
list of globs. Include the selected source, tests, configuration, generated inputs
and installed dependencies. Missing, overlapping or duplicate entries are errors.
Selected source omitted from capture is also an error.

For npm workspaces, capture the relevant package directories and both root and
workspace-local dependencies. Workspace links must point to captured inputs;
external, dangling and cyclic links are rejected. Internal links are rewritten
into the execution copy, and hard-linked inputs become independent copies.

After a run, inspect the resolved scope before interpreting a score:

```sh
node -e "const r=JSON.parse(require('node:fs').readFileSync('seshat-report.json','utf8')); console.log(r.scope.files)"
```

In PowerShell:

```powershell
$report = Get-Content .\seshat-report.json -Raw | ConvertFrom-Json
$report.scope.files
```

The Node example resolves to `src/rules.ts` after excluding
`src/ignored.ts`. The workspace example resolves files under both `src` and
`packages/rules`; see [examples/node/seshat.json](../examples/node/seshat.json)
and [examples/workspaces/seshat.json](../examples/workspaces/seshat.json).

## Test setups

Each setup has a unique `name`, a `runner` of `node`, `jest` or `vitest`, and a
project-relative `cwd`. Commands are argument arrays, not shell expressions.
`timeoutMs` defaults to 30,000 and applies to each job separately.

`test` and `coverage.command` must contain the program followed by its argument
array. `coverage.report` is a project-relative path, and each setup must use a
different report path. `typecheck` is an optional argument array for `crap` but
is required in every setup for `check` and `mutate`.

`check` and `mutate` require a `typecheck` in every setup and passing original
test baselines. `crap` runs a configured typecheck when present, followed by its
baseline and fresh coverage. Coverage settings are required in the configuration
even for `mutate`, which does not execute the coverage command.

Every mutant runs all configured setups. No automatic test selection, persistent
test-process reuse or cross-run verdict caching is performed. Each baseline and
mutant starts a fresh test process.

`check` and `mutate` use source replacement by default. Pass
`--experimental-switching` to use the bounded helper-based switching experiment.
The option is rejected by `crap`. Seshat completes the original typechecks and
baselines first, plus fresh coverage for `check`, then prepares every selected
source in the captured copy. It runs an inactive prepared baseline on the primary
copy and each mutation worker before scheduling mutants. Prepared baseline rows,
their job count and preparation timings are retained in the JSON mutation report.
Switching does not typecheck transformed helpers. Helper wrapping can lose
TypeScript narrowing and can change reflection or source-text observations; verify
the result against replacement for the project before relying on it.

`{seshatReporter}` is replaced with the private reporter for that runner. Node
commands use `--test-reporter={seshatReporter}`. The bounded Node coverage
collectors in [examples/node/collect-node.mjs](../examples/node/collect-node.mjs)
and [examples/workspaces/collect-node.mjs](../examples/workspaces/collect-node.mjs)
are checked-in example adapters, not general collectors shipped in the npm
package. They instrument TypeScript ESM with Istanbul and run Node's built-in
test runner.

The experimental Jest integration uses `{seshatReporter}` plus
`--env={seshatEnvironment}`. Its environment extends the default `jest-expo`
preset and is limited to Jest Circus, one Jest project per setup and the tested
preset behaviour. Arbitrary Jest environments are not supported. The pinned
public fixture and its installed-command controls are documented in the
[Jest/Expo proof workflow](../benchmarks/proofs/README.md#jestexpo-combined-workflow);
other runner versions and configurations remain unverified.

The checked Vitest configuration uses `SESHAT_VITEST_RUNNER` as its
`test.runner` value. Keep `--reporter={seshatReporter}` in both the test and
coverage commands, and keep `--maxWorkers`, `--no-file-parallelism` and
`--maxConcurrency` bounded as shown in the [Vitest example](../examples/vitest/seshat.json).

## Coverage

`check` and `crap` run the configured coverage command, remove its previous output
and consume the fresh full Istanbul JSON. A summary-only report is insufficient.
Locations must refer to original TypeScript source. Include unimported files so
that the provider supplies real zero counters rather than omitting them. The
report path must be a project-relative regular-file destination outside the
selected source files. Seshat removes a stale report in its execution copy and
requires the coverage command to create a fresh one.

The verified coverage routes are Node with the checked-in Istanbul statement
adapter, Jest/Expo with Babel coverage, and Vitest with its Istanbul provider.
Coverage tools remain project dependencies. c8's line counters do not provide
the required statement measurement. Vitest's V8 provider has a known ambiguous
same-line function mapping that Seshat rejects.

Source line positions support LF and CRLF endings and UTF-16 columns. Sources
containing lone CR, U+2028 or U+2029 separators produce incomplete coverage with
a diagnostic and no coverage or CRAP scores. The load-failure observer likewise
withholds location-based evidence for these sources.

Reports from multiple setups are merged only when their source and statement
mappings agree. A shared JSON format alone does not establish compatibility.
Missing counters and ambiguous mappings make the run incomplete. Valid counters
showing zero execution are measured 0% coverage. Functions verified to have no
executable body or parameter work have not-applicable coverage and CRAP. Class
initialisers and static blocks retain complexity results but are outside CRAP
scoring. Unknown and not-applicable rows do not become passing numbers.

## Parallel execution

`workers` defaults to one. Increase it only when tests isolate ports, files,
databases and other external resources. Each worker has an independent source
copy and baseline. The test runner's own concurrency must also be controlled.
The examples use Node `--test-concurrency=1`, Jest `--runInBand` and the Vitest
worker flags shown above. Seshat has no command-line worker override.

Compare repeated complete runs with fixed source, dependencies and test scope.
Keep a faster configuration only when scores, mutant definitions and verdicts
remain consistent. Copying and extra baselines can make more workers slower.

`--scratch PATH` chooses an existing temporary parent outside the project. The
default is the operating system's temporary directory. Handled Unix SIGINT and
SIGTERM cancellation removes owned execution copies and stops owned child
processes. Windows console cancellation is handled separately and reports
`signal: 2`. A forced kill such as SIGKILL cannot perform cleanup.

Process-exit polling during cleanup has one five-second budget per job, shared
by retries and final cleanup. Further cancellation signals do not restart that
budget. An expired budget reports that exit is unconfirmed and processes may
remain; it does not count as successful cleanup. This bounds process waits,
not filesystem cleanup or the total assessment time.

Output reads retain up to 2 MiB per stream. Reports include up to 1,000 diagnostic
characters from each stream, even if a writer never closes the pipe. After
process cleanup, Seshat allows 500 ms for both pipes to close, then closes its
read handles and records a pipe error. A timeout remains `timed-out` even when
its runner receipt is missing; a missing receipt cannot turn it into a kill.

On Unix, Seshat sends SIGKILL to the owned process group, including ordinary
descendants that stay in it. A child can escape by starting another group or
session, for example Node's `detached: true` or a daemon that calls `setsid`
between forks.
The Linux [supervision proof](../benchmarks/proofs/README.md#unix-supervision-boundary)
confirms that escaped descendants survive. Held-open output pipes produce the
bounded error above. A daemon that closes its pipes can survive a successful
job without a cleanup error. Successful cleanup therefore does not prove that
no detached background process remains. Tests must stop any services they
start; keep children in the owned group when relying on Seshat to stop them.

Windows uses a Job object with kill-on-close and no breakaway permission.
Ordinary child processes inherit job membership; detaching from a console does
not itself escape the Job. The native Windows controls verify descendant
termination and pipe closure, including after leader exit. This is a different
boundary from a Unix process group, not a cross-platform sandbox. See Microsoft's
[Job objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
and [process creation flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags).

Seshat does not send a preliminary SIGTERM to jobs. A short grace period can
let a cooperative fixture write cleanup evidence, but cannot reach descendants
outside the group and adds delay for uncooperative jobs. The checked workloads
do not establish a need for that change. Cleanup keeps the leader's PID owned
until signalling finishes. After ownership is released, no signal is sent to
that numeric PID or group again; EPERM remains uncertainty, not proof of exit.

Job evidence retains execution, pipe and cleanup errors separately. A signal
received after a job has completed still cancels the overall assessment without
relabelling that completed job as cancelled.

## Quality thresholds

Add optional thresholds at the top level of `seshat.json`:

```json
"thresholds": {
  "maxCrap": 30,
  "minMutationScore": 80
}
```

These are examples, not defaults. `maxCrap` applies to each measured function,
not an average. `minMutationScore` applies to a complete mutation run. Equality
passes and comparisons use unrounded values, so a measured value exactly equal
to its limit passes. Omit a field or set it to null to disable it. Unknown
fields, invalid types and out-of-range values are errors.

Each command evaluates only its requested assessments. Incomplete execution
takes precedence over threshold failure. No applicable functions or mutants is
reported as not applicable, not as an invented passing score.

| Exit status | Meaning |
| --- | --- |
| 0 | Complete execution with no failed applicable threshold |
| 1 | Complete execution with an unmet threshold |
| 2 | Invalid input, failed baseline, incomplete execution, output failure, or handled Windows console cancellation |
| 130 / 143 | Handled Unix SIGINT / SIGTERM cancellation |

Without thresholds, successful execution does not mean the scores are good.
In CI, retain both the exit status and JSON report. This POSIX example keeps a
threshold exit of 1 or an incomplete exit of 2 after inspecting the report:

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

## Reports

`--json` emits one schema-version-1 report on stdout for a run that gets as far
as Seshat's output writer, including configuration, baseline and incomplete-run
failures. It records execution completeness, resolved scope, function results,
mutation verdicts, optional threshold results, timings, worker counts and
runtime diagnostics. Diagnostics include runner versions from validated
receipts, exact declaration/lock comparisons, per-test/coverage effective
worker limits when direct command flags or resolved runner configuration make
them knowable, unresolved breakdowns, mutation throughput and bounded
slow-execution rows. Progress uses stderr; `--no-progress` suppresses it while
preserving final measurements.

Unknown measurements are not zero. Incomplete runs preserve available results
but withhold the affected final score. JSON keeps execution `complete` separate
from `quality.state`, so a completed run can still fail a threshold.
On Unix, handled SIGINT and SIGTERM set `cancelled: true`, set `signal` to 2 or
15 and return 130 or 143. On Windows, handled `CTRL_C_EVENT` and
`CTRL_BREAK_EVENT` return 2 and set `signal: 2`; that value is a Windows
cancellation marker. Seshat cannot promise JSON when its executable or
interpreter cannot start, stdout cannot be written, or the operating system
forcibly kills the process. Help and version forms are text commands and do not
read configuration. See the [report format](report-format.md) for the stable
fields, nullability and versioning rules.
