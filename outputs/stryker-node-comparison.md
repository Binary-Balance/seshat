# Stryker Node workspace comparison

This report records the matched mutation-only comparison in
[`stryker-node-comparison.json`](stryker-node-comparison.json). The matrix used
the committed driver at `1f3bb6b6e36fb6d56a50a9a43e8363f32bd44a47` and accepted
all 24 runs: one warmup and five measured runs for each tool at workers 1 and
2.

The host used Node 24.20.0, npm 11.19.0, TypeScript 6.0.3, StrykerJS 10.0.0
and Linux x64 on an AMD EPYC 7763 host with two logical CPUs and
16,720,142,336 bytes of memory. The candidate is the
`@binary-balance/seshat` 0.0.0 package built from runtime revision
`62bcddd2a2008cdcca23b8baf93448b2d147f8d8`. The comparison reused the BR2zxn
candidate tarball recorded in the [previous release evidence](release-benchmark.json)
and did not rebuild runtime code. The tarball and installed binary hashes below
match that evidence.

## Timings

Times are milliseconds. Each row uses the five measured samples; the bracketed
values are the minimum and maximum. Seshat's original TypeScript check runs
inside `mutate`, so this report has no separate child-command measurement for
it. Stryker's whole invocation
includes the external original TypeScript check followed by the Stryker command.

| Tool | Workers | Whole invocation median [min, max] | Original TypeScript check median [min, max] | Mutation command median [min, max] |
| --- | ---: | ---: | ---: | ---: |
| Seshat | 1 | 1220.838 [1191.124, 1302.782] | inside `mutate` | inside `mutate` |
| Seshat | 2 | 1284.436 [1272.726, 1312.998] | inside `mutate` | inside `mutate` |
| StrykerJS | 1 | 2814.209 [2666.760, 2935.573] | 759.597 [654.407, 789.571] | 2038.357 [2012.316, 2236.968] |
| StrykerJS | 2 | 2658.115 [2627.256, 2785.778] | 673.060 [668.207, 818.819] | 1970.660 [1958.988, 1988.001] |

The timed boundary runs from child-process spawn through stdout and stderr
drain. Stryker's two phase measurements are reported separately; their medians
are not added to produce the whole-invocation median. Report parsing and
semantic validation follow the timed boundary. Top-level invocations ran
serially, while workers within a workers-2 mutation invocation could run
concurrently.

## Fixture and parity

Both tools used the shared Node workspace writer and the same source, test,
package metadata, TypeScript configuration and package symlink:

```text
src/compare.ts:
export const adult = (age: number) => age >= 18;

packages/rules/index.ts:
export const answer = () => 42;
```

The project uses `noEmit: true` and one Node test. The symlink is
`node_modules/@seshat/rules -> ../../packages/rules`. The input inventory hash
is `653ef36d6390f8fdee150758411ad04f74aa4d68579ac369467ea5d6a66a8110`.

Seshat used its normal embedded `{seshatReporter}` route. Stryker used its
command runner with `node --test --test-concurrency=1 tests/check.mjs`, local
JSON reporting, `coverageAnalysis: "off"`, and concurrency 1 or 2. Stryker
mutated the two source paths with only `EqualityOperator` active. The original
TypeScript check was mandatory and timed before each Stryker command.

Every run produced this normalized tuple set and semantic hash:

| Path | Byte offset | Original | Replacement | Verdict |
| --- | ---: | --- | --- | --- |
| `src/compare.ts` | 42 | `>=` | `>` | killed |
| `src/compare.ts` | 42 | `>=` | `<` | killed |

The common semantic hash is
`a11c1366dc9fb91121bb17a75b533df4c46fc0373c8522c7a5e3bc46df3406f9`.
The JSON validation records four warmups, twenty measured runs, four tool and
worker conditions, and that one common hash.

The Stryker reports contained exactly `packages/rules/index.ts` and
`src/compare.ts`, with source bytes matching the shared files. They retained
four `Ignored` placements from excluded mutators and exactly two active
mutants. Both active records have `testsCompleted: 1`; their `statusReason`
contains `ERR_ASSERTION` and `tests/check.mjs`. Stryker reports the whole
`age >= 18` expression at line 1, start column 39 and end column 48. The driver locates the
unique operator within that span before calculating byte offset 42.

## Provenance and footprint

| Item | Recorded value |
| --- | --- |
| Candidate tarball | 957,505 bytes, SHA-256 `ebfbe1d8af92572f2eb92dc034aba22eeffa769af725fe5b88391e64a8b7c135` |
| Installed Seshat binary | 2,404,520 bytes, SHA-256 `9e4adaad4531ae410eac83004b764d04cc4d3198b6d09b4dedcc84ae6d8fec88` |
| Installed Seshat package | 2,904,275 bytes across 6 files, inventory hash `56107f0db58a266ba19cc3eddf57e4b5f3a67c364dfa1cffcc872aff37581da7` |
| Stryker package lock | 81,077 bytes, SHA-256 `a14213c92496b3869e9bd42d9c63f34f59091a1313ec127b4904816b7c5fd37f` |
| Stryker installed dependencies | 165 lock entries, 8,412 files, 39,183,854 bytes |
| Driver | SHA-256 `b488975697fd3ed2c761858499dcc52b889e4f05f698930ef796ecb0925bc55f` |
| Shared fixture helper | SHA-256 `c0cd8cc593bb2ba167001a2aff4e1e55f875445b1ff81a70d03791c97a6d3cad` |
| Protocol | SHA-256 `aaa17a760d4d869cc230df86248288027b4178523f6fc7dc03dd9a32519f84be` |

The Stryker footprint covers only `benchmarks/stryker/node_modules`. The shared
Node runtime and TypeScript installation are excluded from that count.

## Reproduction

From a clean checkout at the driver revision, install the locked benchmark
dependencies and the existing shared TypeScript tools:

```sh
git checkout 1f3bb6b6e36fb6d56a50a9a43e8363f32bd44a47
npm ci --prefix benchmarks --ignore-scripts --no-audit --no-fund
npm ci --prefix benchmarks/stryker --ignore-scripts --no-audit --no-fund
```

Build or locate a candidate tarball using the [candidate packaging
instructions](../packaging/README.md#build-and-verify-from-the-source-checkout),
then provide its path explicitly:

```sh
CANDIDATE_TARBALL=/absolute/path/to/binary-balance-seshat-0.0.0.tgz
node benchmarks/proofs/stryker-node-comparison.mjs \
  --repo "$PWD" \
  --mode matrix \
  --tool both \
  --seshat-tarball "$CANDIDATE_TARBALL" \
  --output outputs/stryker-node-comparison.json
```

Run the matrix with host permissions. Sandbox process and local network
restrictions can produce `EPERM` during mutation child execution after the
original check and baseline pass. That is an environment failure, not a
mutation verdict or a Seshat reporter defect. The product reporter remains
unmodified.

Coverage, CRAP, test selection, builds inside the timed commands and per-mutant
TypeScript checks are excluded. These four fixture-specific medians do not
establish full-check equivalence, product performance, or a language-only
speed comparison. Issue #5 remains open for other runner comparisons,
switching, build cost and broader workloads.
