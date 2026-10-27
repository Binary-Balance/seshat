# Execution continuity verdict evidence

[#136](https://github.com/Binary-Balance/seshat/issues/136) requires each
release group to show unchanged verdicts on the existing proof fixtures, with
`jobsAttempted`, `workerBaselineJobs` and phase timings from the `--json`
report. This records that evidence for 0.10.0
([#235](https://github.com/Binary-Balance/seshat/issues/235)).

## Method

Each native package workflow installs its built archive and runs the public
consumer [examples](../../examples) and the Vitest and Jest/Expo check proofs.
It retains each `seshat check --json` report in the host's
`*-package-proof` artifact. The comparison uses those artifacts from two
builds on all five supported hosts:

| Build | Head | Linux x64 | Linux ARM64 | macOS x64 and ARM64 | Windows x64 |
| --- | --- | --- | --- | --- | --- |
| 0.9.0 | `4317b6e6391b8d85a706beeec44f8976d5131e62` | [39887755053](https://github.com/Binary-Balance/seshat/actions/runs/39887755053) | [39887755059](https://github.com/Binary-Balance/seshat/actions/runs/39887755059) | [39887754991](https://github.com/Binary-Balance/seshat/actions/runs/39887754991) | [39887755070](https://github.com/Binary-Balance/seshat/actions/runs/39887755070) |
| 0.10.0 | `de3f53a9ec0231e942ef545174ffbd1a6e49f573` | [40416308408](https://github.com/Binary-Balance/seshat/actions/runs/40416308408) | [40416308416](https://github.com/Binary-Balance/seshat/actions/runs/40416308416) | [40416308390](https://github.com/Binary-Balance/seshat/actions/runs/40416308390) | [40416308384](https://github.com/Binary-Balance/seshat/actions/runs/40416308384) |

For every mutant and pseudo-test outcome in `summary.json`,
`vitest-check.json` and `jest-expo-check.json`, the comparison required the
same report position, ID, kind, path, offset, original text, replacement and
verdict. `vitest-check.json` stores each run's result twice; each outcome is
counted once. For each example it also required the same completeness, mutation
score and job counts, and the 0.10.0 report's worker 1/2 parity check to pass.

The other proof files in the same artifacts (`standalone.json`, `debian11.json`,
`operators.json` and `shared-parallel.json`) also contain fault-injection
scenarios: `job-timeout`, `switch-job-timeout`, `missing-receipt-replace`,
`missing-receipt-switch`, `receipt-error` and `timeout`. Their verdicts change by
design. Mutants after the injected fault were `not-run` in 0.9.0 and now run
([#168](https://github.com/Binary-Balance/seshat/issues/168),
[#213](https://github.com/Binary-Balance/seshat/issues/213)). In the `timeout`
scenario, mutant 1 also changes from `timed-out` to `killed`: the
[#213 change](https://github.com/Binary-Balance/seshat/commit/6e9904ab704f192fe4b91b5f246f2e81b1a8ce46)
made that fixture hang only mutant 0's `high` setup, so the proof can show
later mutants resolving.
Those proofs assert the new behaviour. Every other scenario in those files has
unchanged outcomes on all five hosts. The table covers only the public examples.

## Result

All 51 outcomes on each host are identical between 0.9.0 and 0.10.0: 28 from
the public examples, 13 from the Vitest checks and 10 from the Jest/Expo checks.
Every public example is complete in both builds, and the intentionally
incomplete `before-all` check runs match too. Scores and job counts are
unchanged. The new `countedAsKilled` field is `false` for every outcome because
no example opts in.
The examples run with one worker, so `workerBaselineJobs` is 0; the separate
two-worker runs pass the parity check without retaining their counts.

Timings are single samples on shared GitHub-hosted runners and move in both
directions, including in phases these changes do not touch, such as
typechecking. They show no consistent change and support no performance claim.
The mutation and pseudo-test wall times are the phases these changes affect.

The CI artifacts expire in January 2027. After that, this table is the retained
record.

| Host | Example | Score | jobsAttempted | mutation jobs / workerBaselineJobs | pseudo-test jobs / workerBaselineJobs | Execution ms 0.9.0 → 0.10.0 | typecheck | compilerStrictness | baseline | coverage | mutation wall | pseudo-test wall (ms, 0.9.0 → 0.10.0) |
| --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| linux-x64 | node | 75 | 10 | 4 / 0 | 2 / 0 | 2,966 → 1,633 | 543 → 291 | 801 → 463 | 163 → 86 | 454 → 231 | 671 → 381 | 332 → 180 |
| linux-x64 | jest-expo | 75 | 11 | 4 / 0 | 3 / 0 | 17,635 → 9,899 | 894 → 520 | 1,146 → 667 | 3,325 → 2,023 | 3,376 → 1,991 | 5,133 → 2,725 | 3,757 → 1,969 |
| linux-x64 | vitest | 83.33 | 14 | 6 / 0 | 4 / 0 | 12,910 → 7,551 | 1,386 → 848 | 1,818 → 1,148 | 765 → 469 | 1,069 → 662 | 4,859 → 2,660 | 3,010 → 1,764 |
| linux-x64 | workspaces | 100 | 9 | 2 / 0 | 3 / 0 | 2,826 → 1,576 | 532 → 309 | 828 → 454 | 174 → 85 | 443 → 240 | 333 → 185 | 515 → 302 |
| linux-arm64 | node | 75 | 10 | 4 / 0 | 2 / 0 | 2,164 → 2,211 | 377 → 387 | 562 → 571 | 121 → 123 | 358 → 365 | 499 → 509 | 246 → 255 |
| linux-arm64 | jest-expo | 75 | 11 | 4 / 0 | 3 / 0 | 15,762 → 16,240 | 663 → 667 | 836 → 846 | 3,025 → 3,090 | 3,019 → 3,132 | 4,706 → 5,026 | 3,509 → 3,475 |
| linux-arm64 | vitest | 83.33 | 14 | 6 / 0 | 4 / 0 | 10,667 → 10,690 | 1,035 → 1,053 | 1,401 → 1,396 | 663 → 679 | 922 → 925 | 4,081 → 4,061 | 2,564 → 2,574 |
| linux-arm64 | workspaces | 100 | 9 | 2 / 0 | 3 / 0 | 2,061 → 2,085 | 384 → 385 | 564 → 576 | 124 → 122 | 359 → 365 | 252 → 259 | 377 → 377 |
| macos-x64 | node | 75 | 10 | 4 / 0 | 2 / 0 | 3,713 → 5,644 | 600 → 877 | 844 → 1,329 | 238 → 349 | 586 → 903 | 959 → 1,447 | 482 → 735 |
| macos-x64 | jest-expo | 75 | 11 | 4 / 0 | 3 / 0 | 24,596 → 32,337 | 1,517 → 1,506 | 1,518 → 1,848 | 5,936 → 6,361 | 4,298 → 6,448 | 6,456 → 9,761 | 4,865 → 6,401 |
| macos-x64 | vitest | 83.33 | 14 | 6 / 0 | 4 / 0 | 17,958 → 16,300 | 2,616 → 1,612 | 2,404 → 2,304 | 1,042 → 1,033 | 1,344 → 1,343 | 6,632 → 6,183 | 3,915 → 3,819 |
| macos-x64 | workspaces | 100 | 9 | 2 / 0 | 3 / 0 | 3,666 → 4,164 | 677 → 607 | 855 → 876 | 243 → 263 | 617 → 630 | 517 → 506 | 753 → 1,278 |
| macos-arm64 | node | 75 | 10 | 4 / 0 | 2 / 0 | 2,300 → 3,207 | 427 → 607 | 567 → 872 | 149 → 180 | 314 → 409 | 587 → 746 | 254 → 365 |
| macos-arm64 | jest-expo | 75 | 11 | 4 / 0 | 3 / 0 | 13,973 → 22,193 | 649 → 948 | 897 → 1,277 | 2,675 → 4,846 | 2,787 → 4,129 | 4,055 → 6,256 | 2,903 → 4,708 |
| macos-arm64 | vitest | 83.33 | 14 | 6 / 0 | 4 / 0 | 12,195 → 11,426 | 1,274 → 1,155 | 1,600 → 1,663 | 748 → 610 | 1,160 → 940 | 4,390 → 4,639 | 3,020 → 2,415 |
| macos-arm64 | workspaces | 100 | 9 | 2 / 0 | 3 / 0 | 2,623 → 2,380 | 457 → 485 | 693 → 553 | 176 → 181 | 374 → 360 | 427 → 316 | 491 → 483 |
| windows-x64 | node | 75 | 10 | 4 / 0 | 2 / 0 | 3,337 → 3,465 | 568 → 610 | 793 → 880 | 201 → 201 | 581 → 602 | 792 → 778 | 396 → 384 |
| windows-x64 | jest-expo | 75 | 11 | 4 / 0 | 3 / 0 | 26,255 → 29,134 | 943 → 1,044 | 1,236 → 1,284 | 5,084 → 5,729 | 4,723 → 5,301 | 8,234 → 9,051 | 6,025 → 6,715 |
| windows-x64 | vitest | 83.33 | 14 | 6 / 0 | 4 / 0 | 17,326 → 17,361 | 1,526 → 1,580 | 2,503 → 2,071 | 1,077 → 1,130 | 1,434 → 1,521 | 6,654 → 6,756 | 4,121 → 4,296 |
| windows-x64 | workspaces | 100 | 9 | 2 / 0 | 3 / 0 | 3,058 → 3,262 | 604 → 622 | 784 → 854 | 184 → 191 | 554 → 571 | 368 → 403 | 558 → 615 |
