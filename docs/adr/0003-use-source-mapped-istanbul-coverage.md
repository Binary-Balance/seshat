# Use source-mapped Istanbul coverage

Seshat will consume full Istanbul JSON coverage reports whose locations have
already been mapped to the original source, keeping raw V8 conversion and
source-map processing out of the Rust implementation. The coverage-route proof
supports Jest/Babel, Vitest/Istanbul and Node with existing Istanbul statement
instrumentation/remapping libraries. c8's line records do not meet the chosen
statement semantics.

This reduces maintained code but adds coverage setup to some consuming projects.
The shared format does not guarantee identical measurements across providers:
integration fixtures must verify source locations and attribution, including
nested functions and TSX. Summary-only JSON is insufficient because it omits the
locations needed for function-level attribution.

The importer handles Istanbul's open line-end convention and trailing statement
semicolons without accepting spans over other code. Vitest/V8 still fails the
same-line arrow case, so use the fixture-verified Istanbul route as the candidate
for project integration. These are bounded proofs, not general compatibility
guarantees; differing provider maps can still prevent merging. See
`outputs/coverage-routes.md` for the evidence.
