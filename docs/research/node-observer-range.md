# Node import-failure observer range

Evidence for [#228](https://github.com/Binary-Balance/seshat/issues/228).
The candidate enables the observer on stable Node `>=24.20.0 <25`.
Latest-node package checks must prove an active observer before this ships.

## Local execution

Linux x64, Rust 1.98.1, locked dependencies. The unchanged 0.12.1 proof
executable was retained from `4128bcc3599f338fa37b4b40492ae8378aae304a`.
Its Node 24.22.2 run leaves all eleven attributable application import failures
unresolved. The candidate runs all 26 scenarios on actual Node 24.22.0 and
24.22.2; those eleven become kills. The other fifteen verdicts stay unchanged.
The [portable results](node-observer-range.json) record every scenario.

Controls retain execution errors for setup throws, missing imports, caught or
reused exceptions, background failures, custom stacks, primitive throws and
mixed application/setup failures. Synthetic prerelease controls keep the
observer disabled; they establish no prerelease support. Each real execution
checks source preservation and removal of the session copy.

The CLI proof also checks the active diagnostic against an attributable import
kill. Removing load context leaves the same runtime diagnostic active but the
import crash unresolved: an active version gate alone cannot establish a kill.
All 84 CLI scenarios plus legacy parity pass. The 180 Rust unit tests, three
CLI output tests and eleven proof-input tests pass, as do the 21 observer-guard
and compatibility-wrapper tests. The proof-input expectations use the new range;
the initial run exposed their old two-version expectation before it was updated.

Run from the repository root, selecting the actual Node executable for each
version:

```sh
cargo build --release --locked --offline \
  --manifest-path crates/seshat/Cargo.toml --bins
node benchmarks/proofs/node-load-failure.mjs
node benchmarks/proofs/cli.mjs
node --test benchmarks/proofs/runner-compatibility.test.mjs
cargo test --locked --offline --manifest-path crates/seshat/Cargo.toml
```

## Continuing compatibility gate

All five supported hosts already invoke `runner-compatibility.mjs` with the
latest stable Node 24 after building the pinned package. The wrapper now reads
the module-guard proof and requires the actual executing Node version, one
attributed module failure and a killed mutant. It records the observer state,
runtime and verdict in `summary.json`. A successful child process that only
proves disabled-observer fallback fails this gate. Regression controls cover
that case and a receipt from the wrong runtime.

The version-guard tests exercise stable versions, the lower boundary,
prereleases, build metadata and malformed versions. These synthetic cases
verify activation rules, not execution support for future runtimes.
If a later Node 24 breaks the real proof, restore a deliberate version pin and
record the failing version in the compatibility guide before shipping.
