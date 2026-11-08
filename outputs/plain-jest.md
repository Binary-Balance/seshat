# Plain Jest verification

Verified on 2026-11-07, Linux x64, Node 24.22.2, using the self-contained
[TypeScript example](../examples/jest) without `jest-expo`. Dependencies are
locked to Jest, jest-runner, Circus, babel-jest and node/jsdom environments
29.7.0, Babel core/TypeScript preset/CommonJS transform 7.29.7 and TypeScript
6.0.3. The CLI uses Cargo's dev profile.

The [raw reports](plain-jest.json) contain all thirteen cases, runner receipts,
function coverage, mutation outcomes, job counts and phase timings. The frozen
executable SHA-256 is
`8eb5c97f4398b2b9a9a9bcd712c59e9fc35b33c1b92f35753de7dc2bc7d8d2bc`;
the driver checks its identity after every invocation. Paths are portable.

| Environment | Strategy | Jobs attempted | Worker baseline jobs | Baseline ms | Coverage ms | Operator mutation ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| node (default) | replacement | 9 | 0 | 2091 | 1975 | 7280 |
| node (default) | switching | 10 | 0 | 3582 | 2131 | 6891 |
| jsdom | replacement | 9 | 0 | 2240 | 2990 | 9671 |
| jsdom | switching | 10 | 0 | 2262 | 2609 | 5378 |

All four runs passed baseline and coverage with four tests across two files.
`classify` measured 3/3 statements, CRAP 2; `isPositive` measured 1/1, CRAP 1.
Each run killed three comparison mutants and retained one survivor (75%);
both extreme mutants were killed. Replacement and switching produced identical
function measurements and mutant verdicts. Switching adds one prepared-source
baseline; neither mutation phase needed additional worker baselines.

An additional plain-Jest case runs baseline, coverage and mutations through
`npm test`, preserving the same three kills, one survivor and two extreme kills.
The [Expo npm-wrapper report](plain-jest-expo-wrapper.json) independently
confirms passing baseline/coverage and the expected 75% score on Expo 57.0.6.
Discovery waits for the actual Jest CLI so npm banners cannot become
configuration JSON. Both wrapper cases run in retained compatibility checks.

The second test-file argument follows the environment option after the
variadic reporter options. This guards the discovery regression where deleting
the environment option let Jest mistake that test path for another reporter.
Discovery now replaces that option with `--showConfig` in place.

All eight negative controls exit 2 with incomplete execution, zero kills and
unassessed operator mutants: V8 coverage, custom transform, custom environment,
multiple projects, an environment docblock bypassing the wrapper, failed
baseline, unsupported Jest and unsupported environment versions. Source
restoration and empty scratch directories are checked after every invocation.

Plain Jest uses the full configured command for every mutant. Its default
selection fallback is `missing-test-files`, with one attempt per mutant and
no speculative selected-file run. Expo selection remains a separate verified
route.

Configuration discovery starts one extra Jest process per test job. Across
the 34 receipts in the four passing cases, `configDiscoveryMs` ranged from
151.68 to 440.37 ms, with median 253.67 ms. These checks ran alongside an Expo
wrapper regression on a shared host; the timings are observations, not a performance
comparison. Discovery is bounded to 15 seconds and 1 MiB. Configurations must
be deterministic and safe to evaluate twice.

Reproduce from the repository root:

```sh
cargo build --locked --offline --manifest-path crates/seshat/Cargo.toml
npm ci --prefix examples/jest --ignore-scripts --no-audit --no-fund
mkdir -p work/plain-jest
cp crates/seshat/target/debug/seshat work/plain-jest/seshat-wrapper-fix-proof
SESHAT_PROOF_OUTPUT=outputs/plain-jest.json node benchmarks/proofs/jest-check.mjs \
  --cli work/plain-jest/seshat-wrapper-fix-proof --deps examples/jest
```

The public-example verifier also passed all five examples, including plain
Jest and Expo one/two-worker parity. Installed-package and other-host proofs
run through the existing package workflows; no npm publication was performed.
