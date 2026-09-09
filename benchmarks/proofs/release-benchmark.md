# Linux x64 release benchmark protocol

This slice measures one installed Linux x64 npm candidate through
`seshat check --json` on the existing fixtures in
`diagnostics-overhead.mjs`. It is evidence for these fixtures only. It does
not establish a production overhead bound or a release-wide performance claim.

## Matrix

Install the current candidate tarball as an npm package. There is no
baseline-versus-candidate comparison in this slice. Use one warmup and three
measured samples for each of these six conditions:

| Fixture | Source and tests | Expected mutants |
| --- | --- | --- |
| `nodeWorkspace` | Node workspace, TypeScript | 2 killed, score 100 |
| `vitest` | Vitest TSX stack | 4 killed, score 100 |
| `jestExpo` | Jest/Expo TSX | 3 killed, 1 survived, score 75 |

The harness `EXPECTED` values are part of the protocol. The source metrics are
`nodeWorkspace: packages/rules/index.ts=[[1,1,1,1]],
src/compare.ts=[[1,1,1,1]]`; `vitest: tempo.ts=[[3,5,5,3]],
view.tsx=[[1,1,1,1]], server.ts=[[1,3,3,1],[1,1,1,1]]`; and
`jestExpo: src/status.tsx=[[2,3,3,2],[1,1,1,1],[1,1,1,1]]`, where each
tuple is `[complexity, covered, total, crap]`. The exact mutants are:

- Node: offset 42, `>=` to `>` killed; offset 42, `>=` to `<` killed.
- Vitest: offset 60, `<` to `<=` killed; offset 60, `<` to `>=` killed;
  offset 91, `>` to `>=` killed; offset 91, `>` to `<=` killed.
- Jest/Expo: offset 113, `>=` to `>` killed; offset 113, `>=` to `<` killed;
  offset 216, `>` to `>=` survived; offset 216, `>` to `<=` killed.

The expected test counts are Node 1, Vitest 3 and Jest/Expo 3. Each result is
complete with zero unresolved or not-run mutants. Expected `jobsAttempted` is
Node 5/6, Vitest 7/8 and Jest/Expo 7/8 for workers 1/2 respectively. The
worker count and this job count are the intentional differences removed from
the cross-worker parity hash.

For every fixture, run Seshat workers `1` and `2`. Keep each configured test
runner serial (`--test-concurrency=1`, `--runInBand`, or the fixture's fixed
Vitest equivalent). The measured matrix keeps normal progress enabled. Seshat
replacement is the measured strategy. Alternate worker order between measured
rounds within each fixture; run all child processes serially, with no
concurrent builds or downloads. The full matrix is 24 executions, including
six warmups.

Every run must preserve the fixture's source, tests, operator definitions,
mutant IDs and offsets, expected verdicts, configuration hash, captured input
hashes, and empty scratch directory. The exact semantic expectations are the
ones in the harness: Node has two killed mutants; Vitest has four killed
mutants; Jest/Expo has three killed and one surviving mutant.

Retain portable raw wall-clock measurements from process spawn through stdout
and stderr drain. Keep Seshat report phase and analysis timings separate from
that total. Record source/config/artifact hashes, tool and dependency versions,
platform, kernel, CPU, available logical CPUs and memory, package/tarball and
installed-binary sizes, maintained source/dependency counts, and the exact
reused build metadata. Do not invent build timing when the reused metadata does
not contain it.

Experimental switching is supported by the proof-only `execute` command, while
the installed `check` path has replacement as its current CLI strategy. This
slice therefore records replacement timings only. Switching is explicitly
unmeasured and pending a matched installed CLI design. No runtime code changes
are part of this slice.

## Exclusions

Stryker is not installed or timed here. A later matched comparison must pin its
version, restrict it to the equivalent `EqualityOperator` mutations described
in the [supported mutators](https://stryker-mutator.io/docs/mutation-testing-elements/supported-mutators/),
disable test selection with `coverageAnalysis: "off"` as described in the
[Stryker configuration](https://stryker-mutator.io/docs/stryker-js/configuration/),
use the exact source and tests, and define the treatment of typecheck, fresh
coverage, CRAP and baseline work before measuring. Its command-runner timings
are not equivalent to this full Seshat `check` workflow until those boundaries
are agreed.

This report excludes claims about other operating systems, architectures,
projects, test-runner configurations, package builds, or unmeasured switching
strategies.
