# Jest/Expo and Node whole-file selection feasibility

Bounded research for [#186](https://github.com/Binary-Balance/seshat/issues/186),
2026-11-06, against `c84c8bd3af603f178fc837e324dc40815d231903`.
These are disposable runtime probes, **not shipped selection support**.
Plain Jest remains [#220](https://github.com/Binary-Balance/seshat/issues/220).
The subsequent implementation and its safeguards are recorded in the
[selection evidence](jest-node-selection.md).

The existing receipt and Rust selection model can accommodate both runners.
Jest supplies isolated per-file Istanbul maps; Node supplies entry-file ownership
but needs child-side Istanbul evidence. Neither requires cross-file counter
subtraction. **Final coverage maps alone are insufficient:** the reset and late
import deletion probes erase real execution without failing the tests. Do not
enable selection on that evidence until an integrity mechanism passes those
negative cases. Reusing Vitest's observer has not been justified by these probes.

## Boundaries and reproduction

Runtime: Node **24.22.2**, Jest and babel-jest **29.7.0**, jest-expo **57.0.5 and
57.0.6**. Both installations use babel-preset-expo 57.0.10, React Native/preset
0.86.3, React 19.2.3, babel-plugin-istanbul 6.1.1, istanbul-lib-instrument 5.2.1,
istanbul-lib-coverage 3.2.2 and istanbul-lib-source-maps 4.0.1. The Node collector
uses instrument 6.0.3 and coverage 3.2.2. These are **resolved installed versions**,
not inferred from requested package versions. Expo release source is pinned by
its npm metadata: [57.0.5 at c300d2c](https://github.com/expo/expo/blob/c300d2cc60c9e684e64f48d9bc90ea18a571d01d/packages/jest-expo/jest-preset.js)
and [57.0.6 at 58da4ed](https://github.com/expo/expo/blob/58da4edafcb043872c3ed9bf8f5957e6544d0a9c/packages/jest-expo/jest-preset.js).

Keep the existing Node **>=24.20.0 <25** boundary. The lower-bound
[24.20.0 runner source](https://github.com/nodejs/node/blob/v24.20.0/lib/internal/test_runner/runner.js)
contains entry-file ownership, and its
[API documentation](https://github.com/nodejs/node/blob/v24.20.0/doc/api/test.md)
contains the diagnostic tracing API. Only 24.22.2 was executed here; lower-bound
runtime and supported-host CI remain required. The installed Node implementation
was also inspected through `process.binding('natives')`; that inspection API is
not proposed for the adapter. Existing Vitest 5 behaviour remains unchanged.

Disposable scripts, generated fixtures, raw observations and normalized summaries
are retained under `work/issue186/`. Set `JEST575_DEPS` and `JEST576_DEPS` to
matching installed `node_modules` directories, then run from the repository root:

```sh
node work/issue186/probe-jest.mjs "$JEST575_DEPS" jest
node work/issue186/probe-jest.mjs "$JEST576_DEPS" jest576
node work/issue186/probe-node.mjs
node work/issue186/probe-node.mjs --diagnostic
node work/issue186/probe-collector.mjs
node work/issue186/probe-load-observer.mjs
node work/issue186/verify.mjs
```

All drivers and verification completed successfully. Individual Jest children
have a 25-second limit; Node children have 10–12-second limits. Fixtures contain
only generated local TypeScript/TSX and tests. Dependencies are linked, not
copied. The experiment directory occupied approximately 3 MiB; disk reserve
remained approximately 58 GiB. `jest*-summary.json`, `node-summary.json`,
`diagnostic-summary.json`, `collector-summary.json`, `observer-summary.json` and
`verification.json` retain the results. Raw records stay disposable; normalized
summaries replace the checkout root with `<repo>`.

## Jest: useful file maps, with precise limits

The following results held for **both Expo versions**:

- Baseline, serial coverage and two-worker coverage each ran three tests in two
  files. Worker PIDs were distinct in parallel and identical with `--runInBand`.
  File A's map contained its TSX source and cleanup source; file B's unrelated
  source did not leak into A's map.
- The two `outer duplicate` identities were preserved as two entries. The
  baseline and coverage workloads matched. `--runTestsByPath <absolute-A>` ran
  exactly A's two tests. An absent path ran zero tests and exited 1 even with
  `--passWithNoTests`; it supplied no usable executed identities.
- Maps used absolute original `.ts`/`.tsx` paths. The tested return statement
  mapped to original line 2, columns 51–68, and JSX retained original spans.
  Applying the installed source-map library preserved those locations.
- `afterAll` source calls were included. With Expo 57.0.6 and Testing Library
  13.3.3, automatic React unmount cleanup also incremented the source counter.
  That library was absent from the 57.0.5 installation, so automatic-unmount
  coverage was not established there.
- A module-initialization function call was visible before `run_start` completed;
  it must retain `static: true` and the full-command fallback. Concurrent test
  bodies still contributed to one file's map; they did not require per-test
  coverage attribution.
- Dynamic `import()` worked with `--experimental-vm-modules` and added the late
  source to the final map. Without that Node option it failed in this fixture.
  This proves transport, not safe late-import selection.
- Resetting statement/function counters produced **the identical source coverage
  object** as importing that source without calling it. Replacing `__coverage__`
  removed an imported source. Importing a source during a test and deleting its
  coverage entry left it absent from both initial and final snapshots. All three
  tests passed. Endpoint comparison cannot detect the last case.

These results match Jest 29.7.0's
[`runTest`](https://github.com/jestjs/jest/blob/v29.7.0/packages/jest-runner/src/runTest.ts):
it finishes the test framework, copies coverage, then tears down the environment.
The probe's custom teardown called a source function: the reporter's function
counter was 0, while the environment's later snapshot was 1. Thus `onTestResult`
is after test hooks, **not after arbitrary environment teardown**. Restrict the
candidate to the existing controlled Expo environment; custom environments and
source-executing teardown need fallback or separate proof.

[`getAllCoverageInfoCopy`](https://github.com/jestjs/jest/blob/v29.7.0/packages/jest-runtime/src/index.ts)
copies that sandbox's `global.__coverage__`.
[Jest's CoverageReporter](https://github.com/jestjs/jest/blob/v29.7.0/packages/jest-reporters/src/CoverageReporter.ts)
merges these maps and subsequently processes coverage. Do not mistake a merged
map for a per-file map. Validate/remap each file independently before emitting
source identities; the tested Babel route already supplied original positions.
The [source-map 4.0.1 API](https://github.com/istanbuljs/istanbuljs/blob/istanbul-lib-source-maps-v4.0.1/packages/istanbul-lib-source-maps/lib/map-store.js)
returns a `CoverageMap` from `transformCoverage`, not an object with a `map` field.
V8 coverage produced `v8Coverage` instead of the required map and must fall back.

For executed identities, extend the existing environment evidence using
`test_fn_start` and `test_done`, preserving duplicate names and excluding bodies
never entered. Reconcile that evidence against reporter `fullName` results and
counts; a failed `beforeAll` cannot establish execution merely because Jest
marks its descendants failed. These events and lifecycle ordering are defined by
[Jest Circus 29.7.0](https://github.com/jestjs/jest/blob/v29.7.0/packages/jest-circus/src/run.ts).

## Node: ownership works; collection needs a guarded child helper

`probe-node.mjs` established on **24.22.2**:

- Serial files, default concurrent files and an absolute selected-file argument
  yielded consistent ownership and duplicate identities. The declaration `file`
  for a shared test was `helper.mjs`, while `entryFile` correctly remained A.
  Numeric `testId` values repeated across children: scope parent relationships by
  entry file and compare stable name ancestry, not run-local numbers.
- Parent/child concurrent tests retained duplicate child names. Suites must be
  excluded, but an actual parent test body remains a test. A generated test with
  no declaration-file location still had valid `entryFile`; missing declaration
  location alone need not prevent attribution.
- `--test-isolation=none` supplied no entry ownership and no isolated helper
  evidence. Use the full command. Never infer ownership from the most recent
  event: concurrent files and shared helpers make that inference unsafe.
- Skip/todo events appeared as `test:pass` with directives. An empty file exited
  0 and produced a synthetic passing file event; its child summary reported
  **zero tests**, while the aggregate reported one passing file. The current
  reporter would count that wrapper. Require real child test identities and
  child-summary reconciliation; zero executed tests must never pass.

These ownership distinctions are documented in the
[24.22.2 event API](https://github.com/nodejs/node/blob/v24.22.2/doc/api/test.md#class-testsstream)
and implemented by [`FileTest.#handleReportItem`](https://github.com/nodejs/node/blob/v24.22.2/lib/internal/test_runner/runner.js).
`test:pass`/`test:fail` are terminal outcomes; combine their directives, types and
scoped ancestry with per-child summaries. Hook/file failures without a test
identity remain errors, not invented executed tests. Reporter events do not
supply the existing collector's Istanbul counters.

The injected `before` snapshot was empty before entry imports in the hook probe.
Its preload-registered `after` snapshot preceded the user's later cleanup:
cleanup function count 0 there, 1 at synchronous process exit. The diagnostic
variant imported **no `node:test`**; its first test-body tracing notification saw
ordinary imports with zero function counts and the module-load case with count
1. This is a conservative static check: earlier hook calls may also force full
execution. Node's actual
[test implementation](https://github.com/nodejs/node/blob/v24.22.2/lib/internal/test_runner/test.js)
places the notification at callback invocation; do not assume it precedes all
hooks. It also emits a `<root>` notification, so tracing alone is not an
executed-test inventory.

Exit snapshots included user `after` cleanup, even when that cleanup threw; the
runner exited 1 in the latter case. However, a later registered user
`process.on('exit')` callback incremented a source **after** the helper snapshot.
Arbitrary exit callbacks therefore require fallback or a proven final-collection
contract. Exit handlers must remain synchronous under
[Node 24.22.2's process API](https://github.com/nodejs/node/blob/v24.22.2/doc/api/process.md).
The Node reset and deleted-late-import cases erased execution just as in Jest.

### Safe activation and collector coexistence

Unconditionally registering `before()` started a zero-test harness in an ordinary
Node program. Checking only `NODE_TEST_CONTEXT=child-v8` also started a harness in
an ordinary descendant inheriting that variable. The successful probe instead:

1. Set an execution-scoped parent PID marker when the **parent reporter module**
   loaded, before test children spawned.
2. Activated the helper only for `child-v8`, an absolute entry path and
   `process.ppid === marker`; inactive programs imported no `node:test`.
3. Wrote distinct child observations; required child evidence rather than
   interpreting its absence as zero coverage.

This left ordinary programs, the collector and ordinary programs spawned by a
test inactive. The `--test` parent did not run the preload itself in these probes;
setting the marker inside that preload was insufficient. This agrees with
[Node's child spawning](https://github.com/nodejs/node/blob/v24.22.2/lib/internal/test_runner/runner.js)
and [lazy harness bootstrap](https://github.com/nodejs/node/blob/v24.22.2/lib/internal/test_runner/harness.js).
The marker is an execution boundary, not authentication against hostile tests.

`probe-collector.mjs` ran the existing `benchmarks/proofs/collect-node.mjs` with
both managed imports in `NODE_OPTIONS`: the load observer and the helper. The
collector stayed inactive, two test children supplied evidence, and final merged
coverage contained all four original TS sources, including cleanup hits.
A collector that cleared `NODE_OPTIONS` still passed three tests and wrote valid
coverage, but supplied **zero child sidecars**: selection must fall back.
`probe-load-observer.mjs` additionally preserved one fatal-import `.load-*`
receipt while both imports were present. This proves composition on this runtime,
not compatibility with arbitrary collectors or preload orderings.

## Minimum implementation and fallback policy

Keep the existing generic fields unchanged:
`testFiles: [absolute file]`, `tests: [{file, id}]`, and
`fileCoverage: {version:1, complete, files:[{file,sources:[{path,hit,static}]}]}`.
Keep duplicate identity multiplicity. The existing
[selection owner](../../crates/seshat/src/execution/project/selection.rs) should
still validate equal baseline/coverage workloads, complete original-source
Istanbul coverage, conservative static fallback and exact selected execution.
Missing instrumentation is unknown; an omission becomes usable only after the
complete merged source report establishes it.

The smallest division of work is:

- **`jest-expo-environment.cjs`:** append entered/completed identities and the
  pre-test static observation to its existing per-file event sidecar. Preserve
  hook-error, retry and timeout handling.
- **`jest-reporter.cjs`:** collect each `onTestResult.coverage`, validate original
  source identity/maps, reconcile environment identities/counts, then emit the
  generic fields. No Vitest delta observer or shared runner framework is needed
  for file ownership. Coverage integrity still needs a separately proven gate.
- **New bounded Node child helper plus `node-reporter.mjs`:** compose managed
  preloads, scope activation as above, collect static/final observations, and
  join exactly one valid child record to each entry-file summary. Keep load-error
  handling and prevent synthetic/skipped tests from becoming passed executions.
- **Both `collect-node.mjs` copies:** preserve inherited managed imports and
  source instrumentation. Advertise or supply complete final attribution;
  arbitrary custom collectors without that evidence retain full execution.
- **`selection.rs`:** add two small command parsers beside the Vitest parser.
  For Jest use `--runTestsByPath` with selected absolute files; for Node replace
  literal file arguments after `--test` with selected absolute files. Preserve
  explicitly recognized runner options and reject unknown argument shapes.
- **`collection.rs` / `execution.rs`:** write/inject the helper, compose rather
  than overwrite Seshat's managed `NODE_OPTIONS`, clear inherited internal PID
  markers, and validate/clean new sidecars through existing job lifecycle rules.
  Prefer the existing `.events-*` cleanup namespace.

Initial positive candidates are the controlled single-project Jest/Expo Babel
route, serial or process-worker files, and direct Node `--test` with process
isolation and the cooperative original-source Istanbul collector. The probes
establish their transport and lifecycle boundaries; **integrity and mutation
verdict proofs below still gate production enablement**.

Use full execution for unsupported versions/providers, custom environments or
runners, multiple Jest projects, opaque command wrappers, non-isolated Node,
missing/ambiguous ownership, untrusted final-collection timing, and incomplete
attribution. Initially also reject workload-changing options: watch/list modes,
name/only/skip/tag filters, changed/related-test selection, sharding, bail,
rerun/retry modes, randomization and unknown options. Preserve only an explicit
allowlist of understood configuration/reporter/concurrency arguments. The
[Jest 29.7 CLI](https://jestjs.io/docs/29.7/cli#--runtestsbypath) distinguishes exact
path selection from regex and other workload filters; do not silently reinterpret
one as another. Late imports remain full fallback until observed throughout
loading, including the import-then-delete case. A declared unsupported reset
policy is insufficient when snapshots cannot detect the reset.

## Proofs still required before enabling selection

- Match selected/full mutant verdicts, completeness and job counts for both
  runners, source replacement and switching, hooks, module initialization,
  multiple sources/setups and concurrent files. The passing workload probes here
  are not mutant-verdict comparisons or performance measurements.
- Prove counter-reset/replacement/deletion detection from before source loading,
  including reset-then-reincrement, late imports and malformed/replaced maps.
  Do not infer zero coverage from a reset. No such integrity observer was built
  or established here; endpoint-only observation was disproved.
- Prove executed identity confirmation under assertion failures, hook failures,
  timeouts, skipped/empty files, duplicate names and changed selected workloads.
  Confirm the full retry retains the selected receipt and actual 0/1/2 job count.
- Preserve clean runner-timeout retry semantics. A supervisor/job deadline must
  not retry; a clean runner-reported timeout with unconfirmed tests can currently
  retry at the same per-attempt limit. A blanket `TimedOut` exclusion is wrong.
- Exercise cancellation and process, pipe, source-restoration and artifact
  cleanup errors during selection and retry. Unconfirmed process cleanup must
  preserve evidence and stop continuation.
- Validate sidecar execution IDs, source/file identities, duplicate/missing
  children, bounded size, symlink/hardlink/replacement attacks, exclusive writes
  and stale-record cleanup across consecutive jobs. Confirm serialization never
  races an unfinished child or source-executing teardown/exit callback.

These preserve [ADR-0001](../adr/0001-preserve-assurance-when-optimising.md),
[ADR-0003](../adr/0003-use-source-mapped-istanbul-coverage.md), fresh test processes
under [ADR-0004](../adr/0004-reuse-prepared-code-not-test-process-state.md), and the
existing ownership and timeout distinctions recorded in the
[self-assessment follow-up](rust-self-assessment-follow-up.md).
