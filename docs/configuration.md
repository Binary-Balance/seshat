# Configuration

Place a declarative `seshat.json` in the project to assess. Its directory is the
project root. `seshat check` reads `./seshat.json` by default; `--config PATH`
selects another file. Unknown fields, duplicate fields and invalid paths fail
before execution. Configuration is JSON, with no inheritance or executable code.

## Vitest example

This example follows the [included fixture](../benchmarks/proofs/fixtures/vitest),
which has TypeScript, React TSX, a Fastify route and three Vitest tests. Adjust the
source paths and capture list for your project. The tested runner is Vitest 5.0.0
with `@vitest/coverage-istanbul` 5.0.0 and Node 24.20.0.

Merge these settings into `vitest.config.mjs`:

```js
export default {
  test: {
    runner: process.env.SESHAT_VITEST_RUNNER,
    include: ['stack.test.tsx'],
    coverage: {
      provider: 'istanbul',
      include: ['tempo.ts', 'view.tsx', 'server.ts'],
      reporter: ['json'],
      reportsDirectory: 'coverage',
    },
  },
};
```

Ordinary Vitest runs use its default runner when the environment variable is
absent. Seshat's integration does not compose with another custom runner.

Use this `seshat.json` with the fixture's package and TypeScript configuration:

```json
{
  "source": {
    "include": ["tempo.ts", "view.tsx", "server.ts"]
  },
  "capture": [
    "package.json", "tsconfig.json", "vitest.config.mjs",
    "tempo.ts", "view.tsx", "server.ts", "stack.test.tsx", "node_modules"
  ],
  "workers": 1,
  "setups": [
    {
      "name": "unit",
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

Install your project's dependencies before running Seshat. It copies the selected
inputs and installed dependencies; it does not install or configure them for you.
For the standalone fixture's build and execution checks, see the
[regression guide](../benchmarks/proofs/README.md#vitest-combined-workflow).

## Source and capture

`source.include` and optional `source.exclude` select the files to assess. Both
CRAP and mutation testing use that scope, and reports list the resolved files.
Patterns are case-sensitive and relative to the project root. `*` matches within
a directory and `**` spans directories. Brace expansion and leading `!` are not
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

## Test setups

Each setup has a unique `name`, a `runner` of `node`, `jest` or `vitest`, and a
project-relative `cwd`. Commands are argument arrays, not shell expressions.
`timeoutMs` defaults to 30,000 and applies to each job separately.

`check` and `mutate` require a `typecheck` in every setup and passing original
test baselines. `crap` runs a configured typecheck when present, followed by its
baseline and fresh coverage. Coverage settings are required in the configuration
even for `mutate`, which does not execute the coverage command.

Every mutant runs all configured setups. No automatic test selection, persistent
test-process reuse or cross-run verdict caching is performed.

`{seshatReporter}` is replaced with the private reporter for that runner. Node
commands use `--test-reporter={seshatReporter}`. The bounded Node coverage collector
is available in [collect-node.mjs](../benchmarks/proofs/collect-node.mjs); it is a
proof utility, not a general collector shipped in the npm package.

The experimental Jest integration uses `{seshatReporter}` plus
`--env={seshatEnvironment}`. Its environment extends the default `jest-expo` preset
and is limited to Jest Circus, one Jest project per setup and the tested preset
behaviour. Arbitrary Jest environments are not supported. A standalone public
Expo fixture and broader runner-version verification remain release work.

## Coverage

`check` and `crap` run the configured coverage command, remove its previous output
and consume the fresh full Istanbul JSON. A summary-only report is insufficient.
Locations must refer to original TypeScript source. Include unimported files so
that the provider supplies real zero counters rather than omitting them.

The verified coverage routes are Node with Istanbul statement instrumentation,
Jest with Babel coverage, and Vitest with its Istanbul provider. c8's line counters
do not provide the required statement measurement. Vitest's V8 provider has a
known ambiguous same-line function mapping that Seshat rejects.

Reports from multiple setups are merged only when their source and statement
mappings agree. A shared JSON format alone does not establish compatibility.
Missing counters and ambiguous mappings make the run incomplete. Empty functions
have not-applicable coverage and CRAP; class initialisers and static blocks retain
complexity results but are outside CRAP scoring.

## Parallel execution

`workers` defaults to one. Increase it only when tests isolate ports, files,
databases and other external resources. Each worker has an independent source
copy and baseline; the test runner's own concurrency must also be controlled.

Compare repeated complete runs with fixed source, dependencies and test scope.
Keep a faster configuration only when scores, mutant definitions and verdicts
remain consistent. Copying and extra baselines can make more workers slower.

`--scratch PATH` chooses an existing temporary parent outside the project.
The default is the operating system's temporary directory. Handled SIGINT/SIGTERM
cancellation removes owned execution copies and stops owned child processes.
SIGKILL cannot perform cleanup.

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
passes and comparisons use unrounded values. Omit a field or set it to null to
disable it. Unknown fields, invalid types and out-of-range values are errors.

Each command evaluates only its requested assessments. Incomplete execution
takes precedence over threshold failure. No applicable functions or mutants is
reported as not applicable, not as an invented passing score.

| Exit | Meaning |
| --- | --- |
| 0 | Complete execution with no failed applicable threshold |
| 1 | Complete execution with an unmet threshold |
| 2 | Invalid input, failed baseline, incomplete execution or output failure |
| 130 / 143 | Handled SIGINT / SIGTERM cancellation |

Without thresholds, successful execution does not mean the scores are good.
In CI, retain both the exit status and JSON report:

```sh
./node_modules/.bin/seshat check --config ./seshat.json --json > seshat-report.json
```

## Reports

`--json` emits one draft schema-version-1 report on stdout, including on failure.
It records execution completeness, resolved scope, function results, mutation
verdicts, optional threshold results, timings and worker counts. Progress uses
stderr; `--no-progress` suppresses it while preserving final measurements.

Unknown measurements are not zero. Incomplete runs preserve available results
but withhold the affected final score. JSON keeps execution `complete` separate
from `quality.state`, so a completed run can still fail a threshold.
See the [report contract](../benchmarks/proofs/README.md#cli-candidate) for fields.
