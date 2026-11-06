# Jest/Expo and Node test-file selection

[#186](https://github.com/Binary-Balance/seshat/issues/186) extends the existing
whole-file selector to verified Jest/Expo and Node setups. The
[feasibility probes](jest-node-test-selection.md) established the runner APIs;
this implementation adds continuous counter observation and lifecycle checks.
Plain Jest remains [#220](https://github.com/Binary-Balance/seshat/issues/220).

## Supported routes

- Jest 29.7.0, jest-expo 57.0.5 or 57.0.6, the Seshat Expo environment, one
  project, Babel coverage and babel-jest 29.7.0 transforms. Both serial files
  and process workers are supported.
- Node >=24.20.0 <25, isolated test processes and the existing
  [collector recipe](../../benchmarks/proofs/collect-node.mjs). The collector
  must retain the managed `NODE_OPTIONS` imports and set
  `SESHAT_NODE_ISTANBUL=1` on its test processes. Concurrent files and bodies
  are supported.

Command filters and exclusions are documented in
[configuration](../configuration.md#mutation-execution). Unknown commands or
options use the full command. Jest concurrent bodies, skipped/todo workloads,
custom environments/transforms, worker threads, global lifecycle hooks and V8
coverage do not establish selection evidence. Node skip/todo workloads and
replacement of the observed process exit boundary also use full commands.
Helper-declared Node tests retain their entry-file ownership; when the first
body boundary cannot be established, coverage attribution remains unavailable.

Node coverage commands remain trusted instrumentation, as with full-run
coverage. A custom collector must instrument every loaded assessed source and
produce complete original-source Istanbul maps; it cannot replace that contract
with synthetic zero maps. The supplied recipe instruments those sources and
preserves both Seshat preloads and supplies that signal. Unknown collectors
leave their globals unchanged and use full commands. Clearing the managed
imports also produces missing child evidence and forces full commands.

## Evidence and failure handling

The shared observer installs before instrumented imports and watches statement
and function counters, source entries and the coverage root. It rejects resets,
deletions, replacement, changed maps, unrecognized raw identities and malformed
counters. A reset followed by new hits cannot erase the earlier invalidation.
Malformed data accessors are rejected without invoking application getters.
An observed source without calls is distinct from a source never imported.
Only the complete merged source map can establish the latter's zero coverage.

Istanbul's first import can retain the plain object on the right of a global
assignment. Publishing the observed empty root first ensures that import also
receives the observer. This is covered by an explicit regression.

Jest seals its per-file evidence at `run_finish`, preserving the existing hook
receipt. It keeps observing through environment teardown, then rechecks the
global property. A late source call or lost observer creates an exclusive invalid
marker. The root reporter reads markers after workers finish. A missing Jest
coverage map is accepted only when it agrees with empty observer evidence for
that file; malformed or conflicting maps remain unavailable.

Node installs its helper only in actual test children, with a matching parent
PID, execution ID and entry file. It imports no `node:test` hooks. The helper
observes the diagnostic first-body boundary and finalizes after synchronous
exit listeners, including later application cleanup. Changes to that exit
boundary disable attribution. Child observations use bounded exclusive files
in the existing job-artifact namespace; root receipts validate ownership,
uniqueness, size and file identity before joining them.

Both runners preserve duplicate names using structured ancestry. Node identities
belong to the entry file even when a helper declares the test. Synthetic passing
empty-file wrappers, skipped tests, todo tests and suite wrappers are not real
executed bodies. Empty runs cannot pass. Optional identity or attribution payloads
that exceed receipt limits are omitted without changing ordinary test counts.

After a selected job, the existing Rust owner verifies its exact executed
workload. A continuable completed run without confirmation gets one full-command
retry. Reports retain the requested files, selected attempt and both job counts.
Jest conservatively omits identities for hook-error/timeout receipts, so its
continuable cases take this retry. Job deadlines, cancelled jobs, execution
failures and cleanup failures cannot be replaced by a full retry.

Existing verdict policies remain authoritative. Jest's attributable `afterEach`
failures, including an assertion plus that hook failure, can kill a mutant;
suite cleanup errors cannot. Node preserves its existing timeout and combined
assertion/hook behaviour. Selection is checked against each runner's full-command
control rather than assigning a new cross-runner policy.

## Architecture decision

The assessment's shared-observer candidate now has two concrete consumers.
A private CommonJS module owns counter integrity; each runner keeps ownership
of its lifecycle and receipt. Vitest's existing observer is unchanged because
its installation boundary differs. No generic runner framework was introduced.

The Rust selection/confirmation/retry protocol still has one owner and one
production caller. Both new adapters use the existing `SetupEvidence` interface;
they do not repeat that protocol. The deferred fallback extraction still offers
no demonstrated reduction in caller knowledge or test setup. Large files and
complexity scores remain signals for investigation rather than split targets.

## Reproduce

After installing the locked proof dependencies and building the CLI:

```sh
node --test benchmarks/proofs/coverage-observer.test.cjs \
  benchmarks/proofs/node-file-coverage.test.mjs \
  benchmarks/proofs/jest-file-coverage.test.mjs
SESHAT_PROOF_OUTPUT=work/jest-node-selection.json \
  node benchmarks/proofs/jest-node-selection.mjs \
  --cli crates/seshat/target/debug/seshat
SESHAT_PROOF_OUTPUT=work/selection-cancellation.json \
  node benchmarks/proofs/selection-cancellation.mjs \
  crates/seshat/target/debug/seshat
```

The cancellation script runs on Unix; existing Windows console proofs remain
responsible for platform signal delivery. It compares selected/full jobs under
SIGINT and SIGTERM, checking a single attempted job, cancelled verdict, source
preservation, descendant removal and empty scratch directories.

The matched runner proof retains ordinary/equivalent mutants, verified zero
coverage, module loading, file hooks, parallel files, concurrent bodies,
missing attribution, command filters, changed identities, empty runs, timeouts,
cleanup failures, counter resets/deletion, process errors and artifact-cleanup
failure. It records full/selected outcomes, completeness, scores, job counts
and phase/job times. Samples are paired fixture observations, not consumer
performance claims. Cross-file order or state dependencies remain a reason
to set `"testSelection": false`.

## Retained validation

The [portable results](../../outputs/jest-node-selection.json) retain 29 matched
pairs: 18 Node cases on 24.20.0 and 11 Jest cases on 24.22.2, plus four Unix
cancellation controls. Each comparison records its actual binary hash; earlier
passing controls are retained alongside the final integrity/collector changes.
The ordinary fixture preserves its 20% score while reducing operator jobs from
five to three for both runners. Timing fields remain individual fixture samples.

Final local checks passed 197 Rust tests, formatting and Clippy with warnings
denied, 85 CLI scenarios plus legacy parity, eight shared-observer checks and
twenty Node-adapter checks. Jest producer checks passed against both recorded
Expo versions, including Node 24.20.0 controls and the unrelated-file regression.

CI repeats all eighteen cases per runner on minimum Node 24.20.0/Linux x64.
Latest-Node compatibility checks repeat eight cases per runner across the five
supported hosts. These checks validate the PR head rather than relying only
on the retained development samples.
