# Configuration

Seshat accepts stable Node versions `>=24.20.0 <25`. Version 0.1.0 accepts only
24.20.0. See the [runner compatibility matrix](runner-compatibility.md)
for the exact runner versions and retained checks.

This guide follows the current `main` source. See the [0.1.0 release notes](releases/0.1.0.md)
for version 0.1.0 behaviour.

Place a declarative `seshat.json` in the project to assess. Its directory is the
project root. `seshat check` reads `./seshat.json` by default; `--config PATH`
selects another file. Unknown fields, duplicate fields and invalid paths fail
before execution. Configuration is JSON, with no inheritance or executable code.

Install the project's dependencies before running Seshat. It copies the selected
inputs and installed dependencies into an execution copy; it does not install or
configure Node, TypeScript, a test runner or a coverage provider. Commands in a
setup are argument arrays; Seshat does not interpret shell expressions.

For a local archive, use the [six-archive local installation
recipe](../examples/README.md#install-and-run-a-local-archive) from the project root. For an
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
The verified route uses Node `>=24.20.0 <25`, Jest 29.7.0, jest-expo 57.0.5 or
57.0.6, Expo 57.0.20, React Native 0.86.3, `@react-native/jest-preset` 0.86.3,
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
  --tarball /absolute/path/to/binary-balance-seshat-linux-x64-0.5.0.tgz
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
the source paths and capture list for your project. Seshat accepts Vitest
`>=5.0.0 <6` with the matching `@vitest/coverage-istanbul` and Node
`>=24.20.0 <25`. The example is locked to Vitest 5.0.0.

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
skips `.git`, `node_modules` and directory symlinks. Source discovery and capture
exclude every ASCII case variant of `.git`, including `.GIT`, even when the
filesystem treats those as distinct directories. Traversal uses an explicit list
of pending paths, so directory depth does not grow the Rust call stack. The
filesystem's path limits still apply; unreadable paths fail the capture.

Filesystem paths used by capture and coverage reports must be valid Unicode.
Non-UTF-8 Unix names and unpaired Windows surrogates fail explicitly; Seshat does
not replace invalid characters in source identities. This includes the project
and scratch directory paths. On Windows, literal paths must also work without a
verbatim prefix. Reserved device names such as `NUL.ts`, trailing spaces or dots,
and alternate data streams are rejected, even if a verbatim path can create them.
See Microsoft's [Windows naming rules](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file).

`capture` lists literal files and directories needed to run tests. It is not a
list of globs. Include the selected source, tests, configuration, generated inputs
and installed dependencies. Missing, overlapping or duplicate entries are errors.
Selected source omitted from capture is also an error.

For npm workspaces, capture the relevant package directories and both root and
workspace-local dependencies. Workspace links must point to captured inputs;
external, dangling and cyclic links are rejected. Internal links are rewritten
into the execution copy, and hard-linked inputs become independent copies.

Captures use exclusive directory creation, so a name collision fails without
adopting or deleting the existing directory. Unix capture directories use mode
`0700`. Windows captures inherit the scratch parent's ACL; Seshat does not make
that ACL private. Choose a scratch directory accessible only to the intended
users. Denied directory creation fails the capture. See Microsoft's
[file access rules](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights).

Use trusted projects and keep their inputs unchanged while Seshat captures them.
Capture and configuration reads, source verification and mutation writes use
checked file handles. Unix opens each path component without following links;
Windows holds directory handles against rename or replacement. Mutation writes
check the opened file's link count before truncating it. A replacement can fail
an operation or leave it using the original opened file.

These checks do not create an atomic snapshot or a sandbox. Concurrent byte
edits, directory moves and new hard links after validation remain unsupported.
On Windows, concurrent changes to a directory's reparse metadata in place are
also unsupported. Seshat does not guard against that case. Test commands must
remain trusted and must not change selected source or its directory structure.
See the [controlled swap regressions](../benchmarks/proofs/README.md#capture-and-restoration-path-swaps)
for the checked cases and limits.

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
On Windows, `.cmd` and `.bat` programs use `cmd.exe` with argument escaping.

Commands run trusted project code with the invoking process's environment.
Seshat removes inherited `NODE_OPTIONS` and `NODE_PATH`, resets its own
runner-evidence variables and sets the captured working directory. Other
variables, including credentials and service configuration, remain inherited.
Source copies and process cleanup do not restrict access to those credentials,
the host filesystem or external services. Use an environment appropriate for
the project's commands. See the [capture boundaries](#source-and-capture),
[process cleanup limits](../benchmarks/proofs/README.md#cancellation-and-process-cleanup)
and [Windows process ownership](windows-package.md#primary-thread-ownership).

`test` and `coverage.command` must contain the program followed by its argument
array. `coverage.report` resolves from the setup's `cwd`, where the coverage
command runs. For example, `"cwd": "packages/app"` with
`"report": "coverage/coverage-final.json"` reads
`packages/app/coverage/coverage-final.json` relative to the project root.
Report paths cannot contain `..`; configure the coverage command to write
inside its setup directory. Each setup must resolve to a different report
destination.

`typecheck` is an optional argument array for `crap` but is required in every
setup for `check` and `mutate`. These mode requirements are checked before
Seshat walks or copies the configured inputs.

`check` and `mutate` require a `typecheck` in every setup and passing original
test baselines. `crap` runs a configured typecheck when present, followed by its
baseline and fresh coverage. All three commands collect fresh coverage.
`mutate` needs statement coverage to skip unexecuted functions during extreme
mutation; it still does not evaluate `maxCrap` thresholds.

`check` and `mutate` replace each eligible function body once before operator
mutation. Functions explicitly returning `void`, using a `void` expression or
without a return expression get an empty body; other functions get
the undefined value with `return void 0`, avoiding a shadowed `undefined`.
Nested functions' returns belong to their own
bodies. These replacements are not typechecked. Empty functions, constructors,
accessors, generators, implicit scopes and reliably zero-covered functions are
skipped. A surviving replacement with reliable positive statement coverage
marks the function `pseudoTested: true`. A killed replacement marks it false;
unresolved executions or unknown coverage leave the flag null. Counts and
execution evidence appear in `pseudoTesting`, separately from operator scores.

### Mutation operators

The optional top-level `mutationOperators` array selects operator families:

```json
"mutationOperators": ["comparison", "logical", "arithmetic", "boolean", "statement", "optional"]
```

Omitting it enables all six families. Use `["comparison"]` to retain the
comparison-only scope of 0.4.0, or `[]` to run extreme mutation without operator
mutants. Unknown names, duplicate names and non-array values fail before capture.
Selection does not change source coverage, complexity or extreme mutation.
Use `["comparison", "logical", "arithmetic"]` to retain the scope of 0.5.0
and 0.6.0.
Use `["comparison", "logical", "arithmetic", "boolean"]` to retain the scope
of 0.7.0. Use `["comparison", "logical", "arithmetic", "boolean", "statement"]`
to retain the scope of 0.8.x.

| Family | Replacements |
| --- | --- |
| `comparison` | `<` to `<=` or `>=`; `<=` to `<` or `>`; `>` to `>=` or `<=`; `>=` to `>` or `<`; `==`/`!=` and `===`/`!==` swaps. |
| `logical` | `&&`/`||` swaps. Operand grouping is preserved with parentheses. |
| `arithmetic` | Binary `+`/`-` and `*`/`/` swaps. |
| `boolean` | Runtime `true`/`false` swaps and prefix `!expression` to `(expression)`. |
| `statement` | Expression statements and bare `return` statements to `;` in eligible functions. |
| `optional` | Remove one runtime `?.` segment, or replace `left ?? right` with `(left) \|\| (right)`. |

Expression rewrites exclude unary signs, increments, assignments and
operators in comments, strings or type syntax. Arithmetic preserves JavaScript's
coercion and BigInt rules; a mutation can therefore change string concatenation or throw.
Logical mutations preserve short-circuiting and return operand values.
Removing `!` also removes its boolean conversion, so `!7` becomes `(7)`.
Nested negations have one candidate per prefix. Type-level boolean literals,
non-runtime property keys and TypeScript postfix non-null assertions are excluded.
JSX expression values are eligible; bare JSX attributes have no literal to flip.
Generated parentheses preserve statement boundaries when semicolons are omitted.

Optional mutations remove one optional member or call segment at a time. Static
members replace `?.` with ` .`, separating numeric literals; computed members
and calls replace it with two spaces. Remaining chain segments keep their
short-circuit behavior and method calls retain their receiver. Nullish defaults
become logical OR, with operands and the whole expression grouped. This makes
`0`, `false`, `""`, `NaN` and `0n` select the default as well as nullish values.
Neither transformation repeats evaluation of a receiver, key, callee or operand.
Removing `eval?.()` makes the call direct, which can change its scope.
Nested chains, generic calls, defaults containing `??`, class fields and TSX
expressions qualify. Optional type members, optional private fields rejected by
TypeScript, declaration-only syntax, `??=` and defaults without `??` are excluded.
See the [optional/nullish evidence](research/optional-mutations.md) for the exact
forms, switching exclusions, hand-checked examples and added test-job cost.

Statement removal selects whole expression statements, including assignments,
updates and calls, and bare returns in explicit synchronous, non-generator
functions. It removes the expression's evaluation or the return's early exit.
Replacing the complete AST statement with `;` preserves unbraced control-flow
bodies, labels, adjacent statements and barriers before later string literals.
Directives, declarations, blocks, control-flow targets and `return value` are
excluded. This also excludes `return void work()`, preserving its operand.

Module-level and static-block statements, constructors, async and generator
function bodies are excluded. Nested functions qualify independently, so a
synchronous function inside an async function can still have candidates.
Any candidate containing a `super()` call is excluded, including calls inside
nested arrows. Ordinary `super.method()` calls in eligible methods remain
eligible. Removing an ordinary call can still remove asynchronous work it starts.
See the [statement evidence](research/statement-mutations.md) for fixed examples,
exclusions and added test-job cost.

The mutation score includes all selected operator families. Adding families
can change the score and adds one test job per setup per new mutant.
JSON reports retain `enabledOperators`, each outcome's `kind`, and `perOperator`
planned/completed counts, job counts and cumulative execution time. The terminal
report prints each original operator's counts. Surviving mutants are not proof
of equivalence. See the [operator fixture evidence](research/mutation-operators.md).

### Mutation execution

Every mutant is assessed across all configured setups. Each baseline and mutant
job starts a fresh test process. There is no persistent test-process reuse or
cross-run verdict caching.

Whole-test-file selection is enabled by default. Set top-level
`"testSelection": false` to restore the full test command for every mutant.
Original, worker and inactive switching baselines always run the full command.

The initial selection route supports direct Vitest 5 `run` commands with the
Seshat runner, isolated Node workers and Istanbul coverage. It selects every
test file that executes any code in the mutated source file, including file
hooks. This is a conservative superset of the files covering the exact mutant.
It preserves each chosen file's tests, hooks and configured test order.
Node and Jest setups, command wrappers and unverified Vitest configurations
automatically retain full test commands.

Selected commands accept `--config`, `--reporter`, `--exclude`, `--maxWorkers`,
`--maxConcurrency`, `--pool`, `--testTimeout` and `--hookTimeout`, with a separate
value or `=value`. They also accept the flags `--no-file-parallelism`,
`--no-color` and `--isolate`. Existing positional file filters are replaced by
the selected files; the accepted options and their values are preserved.
Other options use the full command. Seshat reports a setup-wide fallback once
in human output, with its reason and any rejected option. JSON records the same
status in `result.setups[].selection`.

Raw coverage identities must match assessed sources exactly. Additional
instrumented sources, query imports and other unverified remapping use full runs.
If a setup reports `attribution-unavailable`, check that
Vitest's `coverage.include` instruments only the sources Seshat assesses.

Selection requires matching baseline and coverage test identities, complete
file attribution and supported command arguments. Module-level mutants and
sources whose functions execute during module loading use full commands.
Missing or ambiguous attribution also uses full commands. After a selected job,
Seshat verifies the executed test identities against the baseline. If a completed
test run executed a different workload, it reruns the full command and retains
the first attempt. Empty selected runs and infrastructure failures never become
passing evidence.

An operator mutant can skip execution only when all setups prove complete,
reliable zero coverage of its source. It is reported as survived without coverage.
Unknown coverage cannot justify skipping. The existing zero-coverage skip rule
for extreme mutations remains in effect.

Tests must run independently across files. State or ordering dependencies between
files can change verdicts when other files are omitted. Disable selection for
such suites. Matched proof fixtures cannot establish independence for every
consumer project. Reports retain the selection, executed-test evidence and
fallback reasons; see the [report format](report-format.md#mutation-assessment).

A job that exceeds `timeoutMs` stops further mutation scheduling. Results from
work already in progress on other workers remain available.

A runner-reported test timeout can allow scheduling to continue when the command
exits `1` within `timeoutMs`, its complete receipt has valid test counts and no
execution errors, and cleanup succeeds. Later extreme and operator mutants still
run. A timeout receipt with additional errors still stops scheduling.

A complete Jest receipt with exit `1`, valid counts, failed tests and no test
timeouts can count as a kill when every reported error is attributed to a
failing test's `beforeEach` or `afterEach` hook. Testing Library's automatic
cleanup is covered. Suite-hook, file-load and infrastructure errors, and errors
outside any test, remain execution errors and stop scheduling. See the
[receipt and verdict rules](report-format.md#setup-jobs-and-evidence).
Original and worker baselines must pass before any mutants run.

Both kinds of timeout remain unresolved. They do not prove that tests detected
the mutation. The overall mutation score stays withheld, including when an
extreme mutant times out and all operator mutants resolve. The terminal report
shows runner-reported timeout and unrun counts; JSON retains the attempts,
`complete: false` and `score: null`. A timeout exits `2`, and an incomplete
mutation-score threshold cannot pass. See the
[report fields](report-format.md#setup-jobs-and-evidence).

`check` and `mutate` use source replacement by default. Pass
`--experimental-switching` to use the bounded helper-based switching experiment.
The option is rejected by `crap`. Seshat completes the original typechecks and
baselines and coverage first. Extreme mutations use source replacement, including
when switching is requested. Seshat then prepares every selected source for
operator switching in the captured copy. It runs an inactive prepared baseline on the primary
copy and each mutation worker before scheduling mutants. Prepared baseline rows,
their job count and preparation timings are retained in the JSON mutation report.
Switching does not typecheck transformed helpers. Helper wrapping can lose
TypeScript narrowing and can change reflection or source-text observations; verify
the result against replacement for the project before relying on it.
Logical, boolean and nullish switching use inline conditional arms to retain lazy
evaluation and the surrounding `await`, `yield` and direct `eval` context. Nested arms duplicate
source text. If a rendered body exceeds 8 MiB, preparation fails explicitly
and no complete mutation score is reported; use source replacement instead.
Optional-chain switching selects complete chain alternatives so a conditional
wrapper does not end short-circuiting partway through a chain. Preparation
rejects a selected chain used directly as an outer call or tagged-template
target, or a `delete` operand, including through erased TypeScript wrappers.
Conditional arms cannot retain the reference those contexts require. Use
replacement for these forms. The whole run remains incomplete with no score;
candidates are never silently dropped.
Statement switching guards the original statement inside a block. The block
preserves dangling `else` binding and labels; nested candidates retain their
own IDs and execute in the existing function scope.
Removing `!` can expose an operand reference that an inline arm cannot preserve.
Switching rejects selected negations in call, optional-call or tagged-template
targets and `typeof`/`delete` operands when they expose references, including
through erased TypeScript wrappers. Use source replacement for these forms.
Preparation fails with an incomplete report and withheld score; it does not
silently omit mutants. Ordinary `!object.method()` and `!eval(...)` remain
supported because the call stays inside the operand.

`{seshatReporter}` is replaced with the private reporter for that runner.
`{seshatReporter}` and `{seshatEnvironment}` are supported only in command
arguments; the first array element names the program and rejects either
placeholder. Commands remain argument arrays. Node
commands use `--test-reporter={seshatReporter}`. The bounded Node coverage
collectors in [examples/node/collect-node.mjs](../examples/node/collect-node.mjs)
and [examples/workspaces/collect-node.mjs](../examples/workspaces/collect-node.mjs)
are checked-in example adapters, not general collectors shipped in the npm
package. They instrument original TypeScript ESM sources with Istanbul and let
Node's built-in test runner strip types, preserving multiline branch positions.
They require Node `>=24.20.0 <25` and erasable TypeScript syntax. See the
[Node example](../examples/node/README.md) for compatibility limits.

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

CRAP uses the fraction of recorded branch outcomes taken within each function.
When the provider records no branches for a function, it uses that function's
statement coverage. Statement coverage stays in the report for reference.
There is no configuration switch for the coverage input.

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

Reports must include `statementMap` and `s`, plus `branchMap` and `b` for branch
locations and their outcome counters. An empty branch map is valid; missing
branch data is unknown. The recorded branch kinds depend on the provider and
its transforms, so even 100% branch coverage does not prove all paths were tested.

Reports from multiple setups merge statement hits when source and statement
mappings agree. Branch hits combine for compatible outcomes. Unreliable branch
data leaves affected CRAP unknown while retaining independent statement coverage
and unaffected function scores. A shared JSON format alone does not establish
compatibility. Coverage attribution problems keep the assessment incomplete,
but passing original checks still allow mutations to run. Failed original jobs
and invalid coverage files stop mutations.
Missing counters and ambiguous mappings make the run incomplete. Valid counters
showing zero execution are measured 0% coverage. Functions verified to have no
executable body or parameter work have not-applicable coverage and CRAP. Class
initialisers and static blocks retain complexity results but are outside CRAP
scoring. Unknown and not-applicable rows do not become passing numbers.

Branch entries must match source `if`, ternary, logical, default-value or switch
syntax. Partially suppressed outcomes, such as `istanbul ignore else`, remain
unknown when the remaining entry cannot describe the complete source branch.
A function with executable parameters but no mapped statements also remains
unknown, even when it has branch counters.

## Parallel execution

`workers` defaults to one. Increase it only when tests isolate ports, files,
databases and other external resources. Each worker has an independent source
copy and baseline. Seshat uses at most one worker per planned mutant, so a larger
configured count does not create unused copies. Allow scratch space for a full
capture per effective worker, plus files generated by tests. Copy or worker
startup failures leave the assessment incomplete; Seshat does not drop mutants
to fit available resources. There is no CPU-based worker cap.

The test runner's own concurrency must also be controlled.
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

After each job, Seshat retains its parsed receipt and diagnostics in the report
and removes its receipt, observer and event sidecars once process cleanup is
confirmed. Shared reporters and active worker copies remain until they are no
longer needed. An artifact removal error is reported and stops new jobs; it
cannot produce a passing score. Unconfirmed process cleanup leaves per-job
files for the existing final cleanup attempt. Temporary evidence therefore does
not accumulate with completed jobs. Final results still grow with the assessed
scope, and an active job can produce sidecars for each test file.

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

## Type-safety findings

Syntax findings count type-safety escapes in the selected source automatically.
No additional configuration or thresholds are required.

Compiler strictness and inferred-`any` reporting recognize direct commands in
these forms:

```json
["node", "node_modules/typescript/bin/tsc", "--project", "tsconfig.json"]
["node", "node_modules/typescript/lib/tsc.js", "-p", "packages/rules"]
```

The runtime may be `node`, `nodejs` or an explicit path with either name. Windows
`.exe` names are accepted. The compiler script may use another path to the
installed `typescript/bin/tsc` or `typescript/lib/tsc.js`. Bare `tsc`, package
manager scripts, wrappers, Node runtime options before the script, watch mode
and build mode report compiler findings as `unknown`, even when the original
typecheck passes. They remain valid original typecheck commands.

Seshat runs a bounded metadata helper in each setup's captured `cwd` with the
same Node executable and installed TypeScript package. TypeScript parses the
original compiler arguments, JSONC configuration, relative and package `extends`,
multiple inheritance and command-line overrides. Capture the configuration,
inherited configuration inputs and any response files, including nested ones.
Configuration or response files outside the captured project, or missing inputs,
report `unknown` with a diagnostic.

The same helper creates one compiler program per setup, using that installed
TypeScript and the parsed arguments. Inferred-`any` reporting supports
TypeScript `>=5.0 <7.0`; other versions retain strictness reporting where its
metadata API is available. The checker reads captured project inputs and the
installed compiler's library files. Capture imported declarations and referenced
project outputs as well as source. Build/watch commands remain unsupported;
a referenced project's source is not inspected unless it belongs to the
setup's program.

Inferred findings count any-typed runtime expression sites per function and
setup. They include `JSON.parse` calls and any-typed value uses, including uses
flowing from explicit `any`. Counts are not distinct unsafe values or implicit
parameter errors. Unknown and out-of-program findings stay separate from zero.
No combined type-safety score is applied. Optional type-safety thresholds are
described below. See the [report fields](report-format.md#type-safety-findings).

Checker diagnostics, suppressed recovery types and enabled `noCheck` produce
unknown findings. Some untyped JavaScript imports also use recovery types and
remain unknown. Without `maxInferredAny`, this does not block CRAP or mutation
results. Checker work shares the helper's existing setup deadline and adds no
per-mutant jobs.
`inferredAny.ms` shows the added checker phase within `compilerStrictnessMs`.
Compatibility and synthetic scaling measurements are recorded in the
[inferred-any evidence](research/inferred-any.md).

With explicit source arguments, strictness comes from command-line options and
compiler defaults, rather than an unrelated `tsconfig.json`. TypeScript 6
requires `--ignoreConfig` for direct files when a config is present; Seshat
reports that error rather than borrowing the ignored config's strictness.

An unavailable compiler, unsupported metadata API, invalid configuration,
timeout or other helper failure produces a visible `unknown` finding. Without
`maxInferredAny`, it does not block an otherwise complete CRAP or mutation
assessment. No settings are invented for unknown findings. Unsupported options remain separate from options
that the compiler supports and disables.

## Quality thresholds

Add optional thresholds at the top level of `seshat.json`:

```json
"thresholds": {
  "maxCrap": 30,
  "maxCognitiveComplexity": 15,
  "minMutationScore": 80,
  "maxInferredAny": 10,
  "maxTypeEscapes": 0
}
```

These are examples, not defaults. `maxCrap` applies to each measured function,
not an average. `maxCognitiveComplexity` accepts a finite number at least zero
and applies to ordinary functions in all three commands, independently of
coverage status. Implicit class scopes are excluded. See the
[calculation and TypeScript choices](cognitive-complexity.md).
`minMutationScore` applies to a complete mutation run. Equality
passes and comparisons use unrounded values, so a measured value exactly equal
to its limit passes. Omit a field or set it to null to disable it. Unknown
fields, invalid types and out-of-range values are errors.

`maxInferredAny` and `maxTypeEscapes` accept non-negative integers and apply in
`crap`, `check` and `mutate`:

- `maxInferredAny` limits the total any-typed runtime expression sites in each
  setup's selected source. Include all function and implicit-scope rows and
  expressions outside them. Each setup must meet the same configured limit;
  counts are never added across setups. A setup with no selected source in its
  compiler program has a not-applicable check.
- `maxTypeEscapes` limits the total `explicitAny`, `tsIgnore`, `tsExpectError`
  and `tsNocheck` syntax counts across selected source, including syntax outside
  functions. Count each site once, independently of the number of setups.
  Type assertions, double assertions and non-null assertions do not contribute.

A selected file may be outside one setup's compiler program, but every selected
source file must have known inferred findings in at least one setup. Missing or
unknown required findings make a configured `maxInferredAny` check incomplete,
mark the report incomplete and exit 2. Valid CRAP and mutation evidence remains
in the report. Compiler failures alone do not block `maxTypeEscapes`, which uses
independent syntax counts. With these limits disabled, compiler findings retain
their existing non-blocking behavior. Declaration-only files must still be
excluded from assessment source; capture them as compiler inputs instead.

For consistent inferred counts, use the same compiler version and inputs on
local and CI machines. Every declaration file in the compiler program can affect
these counts. Generate required declaration files before Seshat runs, or commit
them, and include them in `capture`.

These are fixed count limits. Start at the current count and lower the limit as
sites are removed. Seshat does not store a baseline or lower limits automatically;
a new site offset by a removed site can still pass.

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
