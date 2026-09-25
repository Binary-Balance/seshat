# Coverage compatibility follow-up

Issue [#64](https://github.com/Binary-Balance/seshat/issues/64) investigated
remaining provider mappings and file identities after the line-separator,
statement-start and empty-function fixes.

## Trailing comments

The retained [provider proof](../../benchmarks/proofs/coverage-compatibility.mjs)
uses TypeScript source maps with Node/Istanbul, Jest/Babel and both Vitest
providers. It includes called and uncalled arrows, class fields and arrow
fields with same-line `//` and `/* */` comments.

Vitest maps an arrow's return expression through the trailing comment to a
null end column, meaning the end of the source line. The old semicolon/space
clamp rejected that valid mapping. The importer now accepts same-line comments
alongside the existing semicolon and whitespace allowance. It still rejects
ranges crossing code, a line break or an unfinished block comment. Called and
uncalled arrows retain their respective 1/1 and 0/1 statement counts.

This does not establish general V8 compatibility. The existing
[coverage-route proof](../../benchmarks/proofs/coverage-routes.mjs) retains its
ambiguous same-line mapping rejection. c8's line counters remain insufficient.

## Coincident statement spans

The proof compiles a TypeScript method decorator that invokes
`context.access.has({})` without invoking `context.access.get`. TypeScript emits
two separate callbacks, `obj => "method" in obj` and `obj => obj.method`.
Their statement counters are 1 and 0, but both source-map to the original method
name at line 2, columns 22 through 28.

Remapping those generated statements individually exposes the collision.
Istanbul's full remapping combines them upstream; the resulting Node and Jest
reports contain no duplicate spans. Equal source coordinates therefore do not
prove that two counters describe the same executable statement. No core
counter-merging change is justified. Duplicate records, including duplicates
created by the end-range clamp, and incompatible setup mappings still make
coverage incomplete.

## File identities

Collection tests reproduced two failures with `src/./subject.ts`: its coverage
was not found under `src/subject.ts`, and a report containing both names bypassed
the duplicate-file check. The public collector now canonicalizes each validated
regular source file before storing its coverage entry. Normalization stays in
collection, before core attribution.

The tests exercise absolute and dotted paths, mismatched identities, relative
paths, parent traversal, symbolic links, linked parents and hard links. Windows
checks additionally cover slash/backslash spellings, ASCII case aliases,
extended-length paths and duplicate normalized identities. Relative report
entry names, escapes and linked files remain rejected. This change does not
claim protection against concurrent source-path replacement, tracked in #70.

## Column diagnostics and checks

Missing columns still report `missing column`. Negative, fractional, string,
boolean, array and object columns now report an invalid non-negative integer.
Null remains valid only for an end-of-line position. Invalid coordinates withhold
coverage and CRAP scores.

From the repository root, with the documented toolchain and dependencies:

```sh
cargo test --locked --manifest-path crates/seshat/Cargo.toml
cargo build --release --locked --manifest-path crates/seshat/Cargo.toml --bins
node benchmarks/proofs/coverage-compatibility.mjs
node benchmarks/proofs/coverage-line-separators.mjs
node benchmarks/proofs/coverage-statement-starts.mjs
node benchmarks/proofs/cli.mjs
```

The provider proof prints tool versions and removes its disposable files. It
accepts `SESHAT_PROOF_BINARY` for an alternate freshly built proof executable;
the CLI proof accepts `SESHAT_CLI_BINARY`. Use the supported Node 24.20.0 runtime
for CLI receipt validation. Native Windows path tests run in the existing
Windows package workflow.
