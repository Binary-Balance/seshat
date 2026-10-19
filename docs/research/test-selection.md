# Whole-file mutation test selection

Issue [#181](https://github.com/Binary-Balance/seshat/issues/181) adds default
whole-test-file selection with an explicit `"testSelection": false` opt-out.
The initial verified route is a direct Vitest 5 `run` command, the Seshat runner,
isolated Node workers and default Istanbul instrumentation in one project.
Node, Jest, command wrappers and unverified configurations retain full commands.
Raw coverage identities outside the assessed sources, including query imports,
force full commands because their source remapping is unverified.

Attribution selects a conservative superset: all files that execute any code in
the mutated source file. Every test and hook in each selected file remains in
the workload. Function execution during module loading and module-level mutants
use full commands. Full original, worker and inactive switching baselines remain.

Per-file runtime evidence may omit an unimported source. Rust resolves that
omission against complete, source-mapped Istanbul evidence before using it.
Only complete zero statement coverage across every setup permits skipping an
operator mutant. An omitted source or missing receipt alone never proves zero.

Selected commands must report the same test identities, including duplicate
names, that the baseline recorded for those files. A completed run with different
identities is retried with the full command. Empty selected runs and process,
receipt or cleanup failures cannot count as passing tests.

## Reproduce

Build the release CLI following the [proof guide](../../benchmarks/proofs/README.md),
then run:

```sh
node --test benchmarks/proofs/vitest-file-coverage.test.mjs
SESHAT_PROOF_OUTPUT=outputs/test-selection.json \
  node benchmarks/proofs/test-selection.mjs
```

The portable report retains matched outcomes, actual job counts and the existing
phase and mutation timing fields. Raw receipts remain in the ignored proof work
directory. These are single paired fixture samples, not representative consumer
benchmarks. Cross-file state and order dependencies remain a documented reason
to disable selection.

## Results and limits

The [portable evidence](../../outputs/test-selection.json) records twelve matched
cases: ordinary and equivalent mutants, zero coverage, parallel workers,
switching, module loading, file hooks, concurrent files, missing attribution,
expanded substring filters, timeouts, query imports and cleanup failures.
The ordinary fixture keeps its 20% score while reducing operator jobs from five
to three. Timing fields are retained for each matched pair.

The query-import regression first reproduced a wrong 20% selected score against
40% for the full command. After rejecting unverified raw identities, both runs
produce 40%. Separate selected/full controls show that mutant-induced cleanup
errors, alone or combined with an assertion failure, remain execution errors in
Vitest. Their scores stay null and their diagnostics retain the cleanup failure.

The eight unchanged controls reuse their passing initial binary snapshot. The
ordinary, query and cleanup cases were run after the identity guard. Each
comparison records the binary hash. These checks cover the stated fixture
workloads; they do not establish independence for arbitrary consumer tests.
