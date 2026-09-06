# Reuse prepared code, not test-process state

Use isolated source replacement by default and retain mutation switching as an
explicit experimental option, both using fresh test processes. The experiments
show that switching can save repeated builds, but its benefit depends on the
workload and was not dependable in the selected real Jest/Expo tests. Switching
prepares comparison alternatives once and activates exactly one mutant before
application code loads; promote it only where verified correctness and measured
performance justify its implementation cost.

Reuse of prepared code can avoid repeated builds without introducing the
runner-specific state-reset machinery needed for persistent test workers. Defer
worker reuse and automatic per-test selection; run all configured tests for each
mutant initially, including mutants exercised during module initialisation.

Support an explicit mutant-worker limit, defaulting to one. Parallel execution is
opt-in because separate processes do not isolate ports, files or databases;
coordinate runner concurrency rather than multiplying both levels without a
bound.
