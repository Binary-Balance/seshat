# Architecture

Seshat uses one Rust crate with private analysis, coverage, assessment and execution
modules. The `seshat` CLI and `seshat-proofs` development command share that crate.
The source lives in `crates/seshat/src/`. Proof fixtures and JavaScript drivers
remain under `benchmarks/proofs/`.

## Analysis

`analysis.rs` parses captured TypeScript and TSX with Oxc. It identifies function
scopes, calculates complexity and generates comparison mutants. It owns source
coordinates and mutation edits, including the experimental switching transform.
Nested functions have independent complexity counts. Class initialisers and
static blocks receive complexity results but are outside CRAP scoring.

Function rows also report [cognitive complexity](cognitive-complexity.md),
calculated in the same syntax-tree traversal. It starts at zero, accounts for
nesting and never replaces the cyclomatic input to CRAP.

Each scope starts at complexity `1`. Each of these constructs adds `1` to its
innermost containing scope:

- `if`, `for`, `for…in`, `for…of`, `while`, `do…while` and `catch`;
- each non-default `switch` case and each conditional expression (`?:`);
- each logical expression (`&&`, `||`, `??`) and logical assignment
  (`&&=`, `||=`, `??=`);
- each default in a parameter or destructuring binding;
- each optional member access or optional call (`?.`).

Chained expressions can therefore add more than one decision. For example,
`a?.b?.()` adds two, while an ordinary member access adds none. Decisions outside
these scopes, such as a module-level `if`, do not create a module complexity
score or increase a function's score. Module-level comparisons can still
generate mutants; complexity measurement does not limit mutation scope.
Destructuring assignment defaults, such as `({x = 1} = value)`, do not add a
decision.

## Coverage

`coverage.rs` attributes full Istanbul JSON to original-source function scopes.
It validates locations and counters, combines compatible reports and rejects
ambiguous mappings. Existing JavaScript coverage tools provide source-mapped
reports; Rust does not convert raw V8 coverage or process source maps.
Missing or unreliable evidence remains unknown. It never becomes zero coverage.
CRAP uses mapped branch outcome counters, with statement coverage as the
fallback when a function has no recorded branches. Statement measurements stay
in the report. Both mapping kinds must agree before setup hits are combined.

## Assessment

`assessment.rs` calculates CRAP and turns typed test outcomes into mutation
verdicts. Passing baselines are required. Timeouts and infrastructure failures
remain unresolved rather than counting as killed mutants. Incomplete mutation
runs retain their counts and withhold the final percentage.
A complete run with zero planned mutants has no applicable percentage. Both
cases use `score: null`; `complete` distinguishes them in the
[mutation report](report-format.md#mutation-assessment).

## Execution

`execution.rs` owns the isolated execution session and uses its private `platform`
module for Unix process groups and Windows Job objects. Its private `project`
module validates declarative configuration, resolves source scope, copies inputs
and rewrites internal workspace links.
The `collection` module runs original checks, fresh coverage and mutation jobs;
`job` bounds process output, deadlines and cleanup.

Every mutant runs all configured test setups in fresh processes. Replacement is
the CLI default. `check` and `mutate` expose experimental switching through
`--experimental-switching`; the proof command also supports switching.
Parallel workers have independent writable copies and receipts, with one worker
by default. Separate processes do not isolate external ports or databases.

Small Node, Vitest and Jest/Expo adapters collect runner evidence. They distinguish
test failures from setup, cleanup and import failures within their tested limits.
The public captured-project path and proof `execute` mode handle Unix
SIGINT/SIGTERM and Windows console cancellation by stopping scheduling, cleaning
up owned processes and withholding incomplete scores. Both use the same bounded
process runner. It polls output pipes without reader threads, retains partial
diagnostics, and shares one process-cleanup deadline across retries and drop.
Command builders remove inherited Node options and module paths
before setting up runner-specific evidence.
SIGKILL and Windows force termination cannot run graceful cleanup.

## CLI and reports

`cli.rs` parses arguments, formats terminal or versioned JSON output, and evaluates
optional quality thresholds. It reports progress on stderr, keeping JSON stdout
separate. Invalid input and incomplete execution take precedence over threshold
failure. The [configuration guide](configuration.md) documents the current contract.

## Decisions and evidence

The [decision records](adr/) explain native execution, coverage input, module
ownership and preserving assurance when optimising. The
[regression guide](../benchmarks/proofs/README.md) lists runnable checks and their
limits. The [release scope](release-scope.md) defines release requirements;
[GitHub Issues](https://github.com/Binary-Balance/seshat/issues) tracks their status.
