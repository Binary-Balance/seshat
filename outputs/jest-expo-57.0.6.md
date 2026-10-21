# Jest/Expo 57.0.6 verification

Verified on Linux x64 with Node 24.22.0 for the 0.8.1 maintenance change.
The candidate reports Seshat 0.8.0; release versioning is separate.

Seshat accepts exactly jest-expo 57.0.5 and 57.0.6 with Jest 29.7.0.
Other patches, SDK versions and prereleases remain rejected.

## Before and after

The CLI built from `15d0a4b` runs all three fixture tests successfully with
57.0.6, then rejects its receipt. Seshat exits 2, reports an incomplete
assessment, leaves all four mutants unrun and withholds the score.

```text
unsupported jest-expo version "57.0.6"; supported: 57.0.5
```

The new receipt regression also failed before the fix on that exact error.
With the fix, both versions pass all 24 cases below. Normal runs cover all
three functions, with CRAP scores 2, 1 and 1. The four comparison mutants
produce three kills and one survivor, for a 75% mutation score. Repeat and
two-worker runs retain those results.

The proof checks source preservation and scratch cleanup after every case.
Every emitted Jest receipt reports the selected version in both `expo` and
`actual.jest-expo`; declared, locked and actual version diagnostics all match.

- Before binary SHA-256: `34447e81e3086946c518a6ef9354ac99586cfa13d35244fe266ac3b6746bca31`.
- Candidate binary SHA-256: `4e6affc28be2dfc376d7bfadc228decb2cc70ad6d760e02ac036ae99377172d5`.
- Raw reports: [before](jest-expo-57.0.6-before.json),
  [57.0.6](jest-expo-57.0.6.json),
  [57.0.5 regression](jest-expo-57.0.5-regression.json).

## Commands

Build the candidate and copy the executable to an isolated output before
running proofs when a Cargo target directory is shared. For each version,
prepare a dependency directory from the fixture manifest and lockfile with
only jest-expo changed. The 57.0.5 run uses the fixture locks from `15d0a4b`.
The 57.0.6 run uses the updated checked-in locks. No other dependency changes.

```sh
cargo build --release --locked --manifest-path crates/seshat/Cargo.toml --bin seshat
node benchmarks/proofs/jest-expo-check.mjs \
  --cli /absolute/path/to/copied/seshat \
  --deps /absolute/path/to/prepared/dependencies
node benchmarks/proofs/reporter-diagnostics.mjs
node benchmarks/proofs/jest-hook-errors.mjs
```

The full Rust library suite passes 136 tests. The new receipt controls accept
57.0.5 and 57.0.6 and reject 57.0.4, 57.0.7, 57.1.0, 58.0.0,
57.0.6-rc.1, 57.0.6+build, 057.0.6, 57.0, an empty string and null.
They check the executing and working-directory fields separately. Existing
receipt format, identity and Jest version controls remain in place.
A synthetic 57.0.7 dependency directory also fails the proof driver guard.
A focused 57.0.6 normal run also passes with the final driver and its
selected dependency manifest and lockfile.

The updated proof fixture passes `npm ci --ignore-scripts --no-audit --no-fund`.
The example lock passes the same command with `--dry-run`. JavaScript syntax,
Rust formatting and the diff checks pass.

## Proof cases

Both versions have identical exit status, completion, baseline, coverage,
comparison and extreme-mutant verdicts. Exit 2 is expected for incomplete
controls; those runs withhold the mutation score.

| Case | Exit | Complete | Comparison verdicts |
| --- | --- | --- | --- |
| normal-1 | 0 | true | killed, killed, survived, killed |
| normal-repeat | 0 | true | killed, killed, survived, killed |
| normal-2 | 0 | true | killed, killed, survived, killed |
| nested-root | 0 | true | killed, killed, survived, killed |
| automatic-cleanup | 0 | true | survived, killed |
| mixed-load-hook | 2 | false | execution-error, not-run |
| before-all-timeout | 2 | false | timed-out, survived |
| assertion-kill | 0 | true | killed |
| expect-assertions | 0 | true | killed |
| assertion-error | 0 | true | killed |
| survivor | 0 | true | survived |
| before-all | 2 | false | execution-error |
| after-all | 2 | false | execution-error |
| before-each | 0 | true | killed |
| after-each | 0 | true | killed |
| mixed-assertion-hook | 0 | true | killed |
| mixed-suite-hook | 2 | false | execution-error |
| import-failure | 2 | false | execution-error |
| test-timeout | 2 | false | timed-out |
| hook-timeout | 2 | false | timed-out |
| missing-events | 2 | false | execution-error |
| missing-receipt | 2 | false | execution-error |
| retry-eventually-passes | 2 | false | execution-error |
| retry-baseline | 2 | false | unassessed |

## Limits

These runs use the native executable on Linux x64. They do not certify a
new OS, CPU target, Node range, Jest version or Expo SDK. Cross-platform
package checks and release publication remain separate. No npm package was
published. Local paths in the retained JSON are normalized.
