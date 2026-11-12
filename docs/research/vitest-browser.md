# Vitest browser mode feasibility

Issue [#159](https://github.com/Binary-Balance/seshat/issues/159) asks whether
code that needs a real browser can get Seshat's runner evidence and
source-mapped coverage through Vitest browser mode. This note records the
bounded investigation. It does not add browser support.

**Verdict: feasible through an undocumented Vitest internal, with public
hooks as a weaker fallback.**
Browser mode has no supported way to install a custom runner, so the shipped
Vitest adapter cannot work there. A setup file that wraps the live browser
runner can install the same evidence hooks. With it, the unchanged native CLI
and Vitest reporter gave the expected verdict in every case below, on Vitest
5.0.0 and on a 5.1.0 subset. Support still needs the implementation work listed
at the end and its own release proofs.

## Tested boundary

Linux x64, Node 24.22.2, Playwright 1.63.0 with Chrome Headless Shell
153.0.8010.12 (revision 1243), React 19.2.8 and TypeScript 6.0.3.

- Full matrix: Vitest, `@vitest/browser`, `@vitest/browser-playwright` and
  `@vitest/coverage-istanbul` 5.0.0.
- Subset (`stack`, `switching`, `coverage-maps`, `missing-evidence`,
  `timeout`): the same four packages at 5.1.0, the latest release.

Firefox, WebKit, headed browsers, the WebdriverIO and preview providers, other
Vitest 5 releases, macOS and Windows are untested.

## Fixture

[`fixtures/vitest-browser`](../../benchmarks/proofs/fixtures/vitest-browser)
is self-contained:

- `meter.tsx` renders a React component with `createRoot` and reads its
  laid-out width with `getBoundingClientRect`, which needs a real rendering
  engine. It contains a nested arrow function and an arrow in an object.
- `gain.ts` renders a gain stage with `OfflineAudioContext`. Autoplay rules
  can start a live `AudioContext` suspended; offline rendering does not depend
  on them.
- `evidence-setup.ts` is the prototype adapter described below.

[`vitest-browser-check.mjs`](../../benchmarks/proofs/vitest-browser-check.mjs)
copies the fixture and runs `seshat check` for each case. The recorded
summaries come from one [full 5.0.0 run](vitest-browser.json) and one
[5.1.0 subset run](vitest-browser-5.1.0.json).

## Findings

### Custom runners are ignored

Browser mode silently ignores `test.runner`. In a manual check, a runner
module that throws on import still produced a passing run, with no warning.
In the installed code,
`@vitest/browser`'s tester builds its runner class directly from `vitest`'s
`TestRunner`; only the Node pools read `config.runner`. The
[`runner` option docs](https://vitest.dev/config/runner) and the
[browser mode guide](https://vitest.dev/guide/browser/) do not mention this.

So the shipped [`vitest-runner.mjs`](../../benchmarks/proofs/vitest-runner.mjs)
cannot be used. A browser config that keeps the Node runner setting produces
no evidence and stops at the baseline (`missing-evidence`).

### Evidence hooks through a setup file

The prototype setup file wraps the live runner instance at
`window.__vitest_browser_runner__.runner` and installs the Node adapter's three
hooks: `onBeforeRunTask` records identity, `runTask` marks entry and calls
`TestRunner.getTestFn`, and `onTaskFinished` snapshots errors before cleanup.
`test.meta` set in the page reached the Node reporter unchanged, so the
reporter needed no changes.

This is a weaker dependency than the Node adapter's. That adapter uses the
documented `runner` option and extends Vitest's runner class; this one patches
an undocumented global. If the global moves, the hooks are not installed and
the baseline fails (`missing-evidence`), so the failure is closed, not silent.

### Public hooks as a fallback

Public hooks alone (`beforeEach` and `afterEach` in the setup file, without
the runner global) can also produce the evidence. With this setup file in
place of the prototype, an experimental copy of the proof passed all 33 cases
on 5.0.0. It also passed three cases added to that copy: a throwing
`beforeEach` in a nested `describe` (`nested-before-each`), a throwing
`afterEach` there (`nested-after-each`), and a kill with passing hooks at both
levels (`nested-kill`). On 5.1.0 it passed `stack`, `switching`,
`before-each`, `after-each`, `cleanup`, `mixed`, `timeout`, `around-each`, the
three nested cases and `missing-evidence`, which runs without the setup file.
These runs' summaries are not recorded.

```ts
import {afterEach, beforeEach, inject} from 'vitest';
const executionId = inject('seshatExecutionId' as never);
// The tested copy also kept the prototype's mutant ID shim for switching.
beforeEach(({task}: any) => {
  task.meta.seshat = {executionId, entered: false, unsupported:
    Boolean(task.fails || task.concurrent || task.retry || task.repeats)};
});
afterEach(({task}: any) => {
  task.meta.seshat.entered = task.result?.hooks?.beforeEach === 'pass';
  task.meta.seshat.beforeCleanup = JSON.stringify((task.result?.errors ?? [])
    .map((e: any) => [e.name, e.message, e.stack]));
});
```

It relies on two undocumented parts of Vitest's test loop:

- `task.result.hooks.beforeEach` ends as `'pass'` only if every `beforeEach`
  hook passed, and the body runs next. If it stopped being set, no test would
  count as entered and the baseline would stop with an error (fail closed).
  If it read `'pass'` after a failed hook, a setup failure would count as a
  kill, a wrong verdict (fail open); `before-each` and the experiment's
  `nested-before-each` would catch that.
- The snapshot excludes every cleanup error. Under the default `stack`
  order, `afterEach` errors are added to the list only after the hooks stop,
  and a throwing hook skips the rest, including the setup file's, which runs
  last. Cleanup functions returned by `beforeEach` and `aroundEach` teardown
  run after all `afterEach` hooks. If Vitest added `afterEach` errors at once
  and kept running hooks, or ran those cleanups first, a cleanup failure would
  count as a kill (fail open); `after-each`, `mixed`, `cleanup` and the
  experiment's `nested-after-each` would catch that. Other `sequence.hooks`
  orders were not tested.

Because both can fail open, public hooks are the route to switch
to if the global moves, not the chosen route.

Without the runner global, a setup file cannot wrap the test body to mark
entry: in Vitest 5.0 and 5.1,
`TestRunner.setTestFn` and `setSuiteHooks` are the lookup functions `getFn`
and `getHooks`, so they set nothing
([vitest#11639](https://github.com/vitest-dev/vitest/issues/11639)).

### Execution identity

The page has no `process.env` (`globalThis.process` is `undefined`), so the
job identity cannot be read there. The config forwards it with
`provide: {seshatExecutionId: process.env.SESHAT_EXECUTION_ID}` and the setup
file reads it with `inject`. A missing adapter and a fixed, replayed identity
both stop at the baseline as execution errors.

### Coverage

Browser-mode Istanbul produced statement, branch and function maps identical
to Vitest's Node mode for both sources (`coverage-maps`). Seshat's importer
accepted them and attributed all seven functions. These values were counted by
hand from the fixture and match both Vitest versions:

| Function | Complexity | Covered branches | CRAP |
| --- | ---: | ---: | ---: |
| `renderPeak` | 4 | 4/4 | 4 |
| `describeLevel` | 3 | 3/4, `'silent'` never returned | 3.141 |
| `Meter` | 1 | none; statements | 1 |
| `band` (`arrow@174`) | 3 | 3/4, `'silent'` never returned | 3.141 |
| `mountMeter` | 4 | 2/4, `?? ''` and `: 0` never taken | 6 |
| `flushSync` callback (`arrow@481`) | 1 | none; statements | 1 |
| `unmount` (`arrow@741`) | 1 | none; statements | 1 |

`stack` plans 19 mutants: 13 killed and 6 survived. The survivors are four
`>` to `>=` mutants: three boundaries the tests never reach (a gain of exactly
1, and a zero level in `describeLevel` and `band`) and the peak comparison,
where `>=` gives the same peak. The other two are the `?.` and `??` in
`mountMeter`, where the element always exists. Replacement, two workers and
switching gave identical verdicts.

The reporter rejects whole-file attribution when `browser.enabled` is set, so
every mutant ran the full command (`attribution-unavailable`). That is the
safe fallback; browser test-file selection is not proposed here.

### Failure classification

Each control has one comparison mutant on `1 === 1`, as in
[`vitest-check.mjs`](../../benchmarks/proofs/vitest-check.mjs). Cases that
share a name with that Node proof gave the same verdict there. Cases marked *
have no Node counterpart; they gave the verdict expected from the reporter's
rules.

| Case | Mutant behaviour | Verdict |
| --- | --- | --- |
| `assertion`, `clean-hooks`, `assertion-count` | Assertion fails | killed |
| `application-error` * | Test body throws a `TypeError` | killed |
| `survived` | No test notices | survived |
| `before-all`, `before-each` | Setup hook throws | execution error |
| `after-each`, `cleanup`, `mixed`, `around-each` | Cleanup throws | execution error |
| `import-error` | Module throws on load | execution error |
| `unhandled` | Unhandled rejection | execution error |
| `page-crash` * | Renderer crashes mid-test (`Page.crash`) | execution error |
| `timeout`, `hook-timeout` | Test or hook times out in the page | timed out, test timeout |
| `deadline` * | Test waits past the job deadline | timed out, deadline |
| `blocked-page` * | Test blocks the page with a busy loop | timed out, deadline |

Every result other than killed or survived withheld the score. Browser
timeout messages match the reporter's existing `Test|Hook timed out` pattern,
and no timeout counted as a kill, as the post-#156 policy requires.

`continue-after-timeout` and `continue-after-crash` check the same rule as the
Node proof's `operator-timeout-continues` and `operator-crash-continues`, with
one setup. A test timeout or a page crash on the first of three mutants left
the other two runnable: both were killed, none was skipped, and the score was
withheld.

`missing-evidence` (the Node proof's `missing-runner`), `replayed-identity`
(no Node counterpart), `retry`, `repeat`, `expected-failure` and `concurrent`
failed the baseline, so no mutant ran. Malformed evidence in
the page, such as a wrongly typed `test.meta`, was not tested. The reporter
code that checks it is the same as on the Node route.

### Lifecycle and cleanup

Playwright starts Chromium in its own session and process group, so Seshat's
process-group kill does not reach it. Chromium exits by itself when its pipe
to the killed Vitest process closes; one manual measurement took 480 ms. The
proof waits up to 5 s and found no surviving browser process after any case,
including `deadline`, `blocked-page` and `cancellation` (SIGINT during a
mutant job).

A killed job cannot run Playwright's Node-side cleanup, so each deadline or
cancellation leaves one Chromium profile and one artifacts directory in
`TMPDIR`, about 230 KB in a manual check. Normal runs leave none.

Each job starts its own Vitest server. In a manual check, two concurrent runs
took the next free API port (63315, then 63316). `workers` saw two jobs
running at the same time, with identical verdicts.

Vitest captures a screenshot of each failed test by default in headless mode,
writing PNG files into the job's copy. Killed mutants pay that cost. It was
not measured.

### Switching

Replacement works without changes. Experimental switching fails closed: its
guard throws when `globalThis.process.env` is missing, the prepared baseline
fails, no mutant runs and the score is withheld (`switching-closed`). When the
config also forwards `SESHAT_MUTANT_ID` and the setup file exposes it as
`globalThis.process.env`, switching gives the same verdicts as replacement
(`switching`). Both routes are feasible; switching can stay unsupported for
browser setups without affecting replacement.

### Cost

These numbers come from the recorded 5.0.0 run on a shared 2-vCPU host. Other
projects' work was running; `uptime` showed load averages between 2 and 6 at
the end. Treat them as rough proportions, not benchmarks. The 5.1.0 subset ran
next; `uptime` showed load averages between 3 and 4 at its end. Each of its
cases took 60% to 100% of the 5.0.0 time.

- The same one-test control took 2.3 s per mutant job in browser mode and
  0.6 s in Vitest's Node mode (`assertion` against `node-reference`), almost
  4 times as long. The difference is mostly starting Vite and Chromium.
- `stack` averaged 4.5 s per mutant job across 19 mutants.
- Two workers cut `stack`'s mutation time only from 85 s to 77 s. Each job
  runs a Vite server and a browser, so two at once compete for the 2 vCPUs.

Scope and evidence were not reduced to improve these numbers. Measuring on a
quiet host belongs with the implementation work.

## Implementation work

A follow-up issue in the 0.18.0 milestone should:

1. Ship the setup file as an embedded adapter, referenced like the runner and
   reporter, and decide how the identity reaches the page. The prototype needs
   the user's config to forward it.
2. Detect browser mode in the reporter, record the provider, browser and
   browser version in the receipt, and validate the supported versions in Rust.
   Detect the internal runner global explicitly so a Vitest change gives a
   clear error.
3. Give each job a private `TMPDIR` inside its scratch copy, so profiles left
   by killed jobs are removed with it.
4. Decide whether to support switching; if so, ship the mutant ID shim.
5. Consider recommending `screenshotFailures: false` after measuring it.
6. Add the proof to the release checks on each supported host, including the
   browser install, and document configuration and limits.

## Reproduce

```sh
npm ci --prefix benchmarks/proofs/fixtures/vitest-browser
npx --prefix benchmarks/proofs/fixtures/vitest-browser playwright install chromium-headless-shell
node benchmarks/proofs/vitest-browser-check.mjs --cli crates/seshat/target/release/seshat
```

`--cases` runs a subset and `--deps DIR` uses another installed dependency
set. `SESHAT_PROOF_OUTPUT` receives the portable summary; the full report with
raw receipts stays in `work/assurance-proofs/vitest-browser-check-*`.
