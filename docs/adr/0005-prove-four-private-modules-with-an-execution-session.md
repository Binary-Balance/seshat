# Prove four private modules with an execution session

Provisionally use one Rust crate with private analysis, coverage, execution and
assessment modules, and an opaque execution session with private runner jobs.
This keeps runner lifecycle hazards local and scoring independent of process
details without exposing a plan language or plugin framework; the coverage and
mutation-execution proofs must validate the split before the release CLI grows.
