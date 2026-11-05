# Unreleased changes

Changes after [Seshat 0.12.1](0.12.1.md).

- Split collection into private planning, preparation, scheduling, summary,
  original-check and coverage-attribution phases without changing reports or
  verdicts (#226).

- Check Rust formatting and default Clippy warnings in Linux x64 package CI.
  Address the existing warnings without changing runtime behaviour (#224).

- Enable Node import-failure attribution across stable Node `>=24.20.0 <25`.
  Latest-node CI now requires and records an active observer and a killed
  application import mutant; ambiguous failures remain unresolved (#228).
