# Fewer redundant jobs verdict evidence

[#136](https://github.com/Binary-Balance/seshat/issues/136) requires each
release group to show unchanged verdicts on the existing proof fixtures, with
`jobsAttempted`, `workerBaselineJobs` and phase timings from the `--json`
report. This records that evidence for 0.11.0
([#249](https://github.com/Binary-Balance/seshat/issues/249)).

## Method

Each native package workflow installs its built archive and runs the public
consumer [examples](../../examples) and the Vitest and Jest/Expo check proofs.
It retains each `seshat check --json` report in the host's
`*-package-proof` artifact. The comparison uses those artifacts from two
builds on all five supported hosts:

| Build | Head | Linux x64 | Linux ARM64 | macOS x64 and ARM64 | Windows x64 |
| --- | --- | --- | --- | --- | --- |
| 0.10.0 | `de3f53a9ec0231e942ef545174ffbd1a6e49f573` | [40416308408](https://github.com/Binary-Balance/seshat/actions/runs/40416308408) | [40416308416](https://github.com/Binary-Balance/seshat/actions/runs/40416308416) | [40416308390](https://github.com/Binary-Balance/seshat/actions/runs/40416308390) | [40416308384](https://github.com/Binary-Balance/seshat/actions/runs/40416308384) |
| 0.11.0 | `394afba477bb974f0fb74103186a22d0644f0eef` | [41187182223](https://github.com/Binary-Balance/seshat/actions/runs/41187182223) | [41187182290](https://github.com/Binary-Balance/seshat/actions/runs/41187182290) | [41187182250](https://github.com/Binary-Balance/seshat/actions/runs/41187182250) | [41187182235](https://github.com/Binary-Balance/seshat/actions/runs/41187182235) |

For every mutant and pseudo-test outcome in `summary.json`,
`vitest-check.json` and `jest-expo-check.json`, the comparison required the
same report position, ID, kind, path, offset, original text, replacement and
verdict. `vitest-check.json` stores each run's result twice. The two copies are
equal, and each outcome is counted once. That gives 12 reports per host: four
examples, four Vitest checks and four Jest/Expo checks. For each report it also
required the same completeness, quality state, mutation score, source results,
mutant job counts and `workerBaselineJobs`, and each example's worker 1/2 parity
check to pass. A field-by-field comparison of the rest of each report, ignoring
timings, execution IDs and temporary paths, found only the `jobsAttempted` and
`typecheck` changes explained below and the new `mutantTimeoutMs` and
`uncappedMutantTimeoutMs` fields.

The other proof files in the same artifacts hold fault-injection and operator
scenarios. Their outcomes had the same comparison:

| Host | Other proof files | Other outcomes | All outcomes | Outcomes that differ |
| --- | --- | ---: | ---: | ---: |
| linux-x64 | `standalone.json`, `debian11.json`, `crash-continuation.json` | 494 | 545 | 3 |
| linux-arm64 | `standalone.json` | 372 | 423 | 1 |
| macos-x64 | `standalone.json` | 372 | 423 | 1 |
| macos-arm64 | `standalone.json`, latest-Node `cli.json`, `jest-expo-check.json`, `node-load-failure.json`, `parallel.json` and `vitest-check.json` | 511 | 562 | 2 |
| windows-x64 | `operators.json`, `shared-cli.json`, `shared-parallel.json`, `windows-runtime-cli-evidence.json` | 378 | 429 | 1 |

`public-consumer-examples.json` repeats the examples in `summary.json`, so it is
not counted. The latest-Node proofs moved from Node 24.22.1 to 24.22.2 between
the builds.

## Result

All 51 outcomes on each host are identical between 0.10.0 and 0.11.0: 28 from
the public examples, 13 from the Vitest checks and 10 from the Jest/Expo checks.
Completeness, scores and `workerBaselineJobs` match, including the intentionally
incomplete `before-all` checks. Worker parity passes for every example on every
host. `countedAsKilled` is `false` for every outcome and `countedTimeouts` is 0,
because none of these reports opts in.

Across all 2,382 compared outcomes, 8 differ. All 8 are the same outcome in one
scenario. Every other scenario has unchanged outcomes on all five hosts.

### Changed verdict: `worker-baseline-error`

This [`parallel.mjs`](../../benchmarks/proofs/parallel.mjs) scenario makes every
worker baseline fail. Its one extreme mutant changes from `killed` to `not-run`:

- in `standalone.json` on Linux x64, Linux ARM64, macOS x64 and macOS ARM64;
- in both parallel sections of `debian11.json`;
- in the macOS ARM64 latest-Node `parallel.json`; and
- in the Windows `shared-parallel.json`.

The cause is [#221](https://github.com/Binary-Balance/seshat/issues/221), not
[#202](https://github.com/Binary-Balance/seshat/issues/202) or
[#240](https://github.com/Binary-Balance/seshat/issues/240). Worker copies and
their baselines now run before the extreme phase, so a failed worker baseline
stops both phases. In 0.10.0 this extreme phase needed only one worker and
finished before the operator phase prepared its workers.

This change is deliberate. [PR #242](https://github.com/Binary-Balance/seshat/pull/242)
records it as a limit, and the [report format](../report-format.md#pseudo-testing)
documents it. The run was already incomplete in 0.10.0: all four operator mutants
were `not-run` and the score was withheld. Only the extreme results are lost:
`pseudoTesting.complete` changes to `false`, and the function's
`pseudoTestStatus` changes from `checked` to `unknown`. `parallel.mjs` asserts
nothing about `pseudoTesting` in this mode, so its proof passes on both builds.

### Job counts

The arithmetic was checked, not assumed. In all 185 retained reports with a
`jobsAttempted` value, in both builds, it equals the report's baseline, coverage,
typecheck, compiler findings and mutant jobs plus its worker and prepared
baseline jobs. Every change from 0.10.0 to 0.11.0 comes from the causes below.

- [#222](https://github.com/Binary-Balance/seshat/issues/222) **explains the
  drops in all 12 reports.** Each has one setup, with
  `typecheck.reusedFrom: "compilerStrictness"`, so `jobsAttempted` falls by
  exactly one. Parallel scenarios have two setups and fall by two, for example
  20 → 18.
- [#221](https://github.com/Binary-Balance/seshat/issues/221) **saves no jobs in
  these reports.** The examples and checks here use one worker. All 80 retained
  multi-worker reports plan one extreme mutant, so
  `pseudoTesting.workerBaselineJobs` was already 0 in 0.10.0. The two-worker
  example runs keep only a parity result. PR #242 measured the saving on the Node
  example with two workers: `jobsAttempted` 12 → 11.
- [#227](https://github.com/Binary-Balance/seshat/issues/227) **saves no jobs in
  these reports.** No retained report has a `no-coverage` setup in either build.
  The `setups` case of `test-selection.mjs` asserts that saving and passed in the
  0.11.0 Linux x64 run, but its report is not retained.
- **`worker-baseline-error` falls from 11 to 7.** Two typecheck jobs go (#222),
  and the extreme mutant's two setup jobs no longer run (#221).
- **`source-error` varies by one job from timing.** Two workers race to reach the
  injected fault, so one setup of a stopped mutant can record `not-run` instead of
  `execution-error`. Mutant verdicts match. Beyond the two typecheck jobs, it
  loses a job on macOS (16 → 13) and gains one on Windows (15 → 14), and the
  rows differ between the two macOS ARM64 runs of the same build.
- **14 reports that stop early keep their counts.** These are the `SIGINT`,
  `SIGTERM` and `SIGTERM-after-receipt` CLI checks and five Windows runtime
  scenarios. Their compiler findings state is `unknown`, so no typecheck is
  reused.

[#202](https://github.com/Binary-Balance/seshat/issues/202) and
[#240](https://github.com/Binary-Balance/seshat/issues/240) change no job count
or verdict here. The Jest/Expo reports set `timeoutMs` to 60,000, so their
mutant limit falls from 60,000 to 30,000, or to 30,216 for the Windows Jest/Expo
example (5 × its 6,043 ms baseline). Every other retained limit is 30,000, or
`null` where no mutants ran. No mutant job in the 12 reports timed out; the slowest took
4,992 ms. `uncappedMutantTimeoutMs` is `null` throughout.

## Timings

Timings are single samples on shared GitHub-hosted runners and support no
performance claim. They move in both directions across hosts, including in phases
these changes do not touch, such as baselines and coverage. Linux x64 is slower in
nearly every phase, for example, while Windows x64 is close to unchanged.

`typecheck` reads `skipped` for 0.11.0 because `phaseTimings.typecheckMs` is `null`
when the compiler findings helper has already checked the program.

The mutation and pseudo-test job counts and `workerBaselineJobs` in the tables
are the same in both builds, so they appear once. The CI artifacts expire on
24 January 2027 (0.10.0) and 29 January 2027 (0.11.0). After that, these tables
are the retained record.

### linux-x64

| Report | Score | jobsAttempted | mutation jobs / workerBaselineJobs | pseudo-test jobs / workerBaselineJobs | Execution ms | typecheck | compilerStrictness | baseline | coverage | mutation wall | pseudo-test wall |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| example node | 75 | 10 → 9 | 4 / 0 | 2 / 0 | 1,633 → 2,365 | 291 → skipped | 463 → 761 | 86 → 173 | 231 → 442 | 381 → 663 | 180 → 325 |
| example jest-expo | 75 | 11 → 10 | 4 / 0 | 3 / 0 | 9,899 → 16,220 | 520 → skipped | 667 → 1,138 | 2,023 → 3,211 | 1,991 → 3,256 | 2,725 → 4,970 | 1,969 → 3,642 |
| example vitest | 83.33 | 14 → 13 | 6 / 0 | 4 / 0 | 7,551 → 11,226 | 848 → skipped | 1,148 → 1,786 | 469 → 760 | 662 → 1,042 | 2,660 → 4,656 | 1,764 → 2,980 |
| example workspaces | 100 | 9 → 8 | 2 / 0 | 3 / 0 | 1,576 → 2,210 | 309 → skipped | 454 → 774 | 85 → 165 | 240 → 430 | 185 → 329 | 302 → 510 |
| Vitest stack | 83.33 | 14 → 13 | 6 / 0 | 4 / 0 | 7,536 → 11,506 | 824 → skipped | 1,051 → 1,779 | 452 → 792 | 612 → 1,082 | 2,840 → 4,786 | 1,757 → 3,066 |
| Vitest assertion | 100 | 5 → 4 | 1 / 0 | 0 / 0 | 3,137 → 3,616 | 860 → skipped | 1,095 → 1,755 | 359 → 539 | 485 → 782 | 338 → 539 | 0 → 0 |
| Vitest survived | 0 | 5 → 4 | 1 / 0 | 0 / 0 | 3,132 → 3,617 | 839 → skipped | 1,097 → 1,763 | 364 → 542 | 487 → 772 | 345 → 540 | 0 → 0 |
| Vitest before-all | withheld | 5 → 4 | 1 / 0 | 0 / 0 | 3,112 → 3,642 | 842 → skipped | 1,076 → 1,777 | 354 → 540 | 482 → 784 | 357 → 539 | 0 → 0 |
| Jest/Expo normal-1 | 75 | 11 → 10 | 4 / 0 | 3 / 0 | 9,980 → 18,560 | 527 → skipped | 646 → 1,188 | 1,867 → 3,457 | 1,895 → 3,507 | 2,914 → 6,031 | 2,128 → 4,373 |
| Jest/Expo assertion-kill | 100 | 5 → 4 | 1 / 0 | 0 / 0 | 4,745 → 8,116 | 522 → skipped | 658 → 1,202 | 1,426 → 2,719 | 1,439 → 2,703 | 698 → 1,488 | 0 → 0 |
| Jest/Expo survivor | 0 | 5 → 4 | 1 / 0 | 0 / 0 | 5,893 → 7,906 | 847 → skipped | 840 → 1,198 | 1,990 → 2,654 | 1,527 → 2,681 | 687 → 1,369 | 0 → 0 |
| Jest/Expo before-all | withheld | 5 → 4 | 1 / 0 | 0 / 0 | 4,937 → 7,955 | 537 → skipped | 664 → 1,196 | 1,484 → 2,686 | 1,494 → 2,681 | 755 → 1,387 | 0 → 0 |

### linux-arm64

| Report | Score | jobsAttempted | mutation jobs / workerBaselineJobs | pseudo-test jobs / workerBaselineJobs | Execution ms | typecheck | compilerStrictness | baseline | coverage | mutation wall | pseudo-test wall |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| example node | 75 | 10 → 9 | 4 / 0 | 2 / 0 | 2,211 → 1,787 | 387 → skipped | 571 → 555 | 123 → 124 | 365 → 356 | 509 → 504 | 255 → 248 |
| example jest-expo | 75 | 11 → 10 | 4 / 0 | 3 / 0 | 16,240 → 14,889 | 667 → skipped | 846 → 834 | 3,090 → 3,023 | 3,132 → 2,959 | 5,026 → 4,719 | 3,475 → 3,350 |
| example vitest | 83.33 | 14 → 13 | 6 / 0 | 4 / 0 | 10,690 → 9,678 | 1,053 → skipped | 1,396 → 1,447 | 679 → 674 | 925 → 908 | 4,061 → 4,056 | 2,574 → 2,591 |
| example workspaces | 100 | 9 → 8 | 2 / 0 | 3 / 0 | 2,085 → 1,700 | 385 → skipped | 576 → 569 | 122 → 124 | 365 → 368 | 259 → 254 | 377 → 384 |
| Vitest stack | 83.33 | 14 → 13 | 6 / 0 | 4 / 0 | 10,959 → 10,044 | 1,044 → skipped | 1,355 → 1,400 | 684 → 698 | 1,020 → 953 | 4,231 → 4,236 | 2,625 → 2,757 |
| Vitest assertion | 100 | 5 → 4 | 1 / 0 | 0 / 0 | 4,007 → 2,964 | 1,060 → skipped | 1,358 → 1,363 | 459 → 467 | 673 → 675 | 456 → 459 | 0 → 0 |
| Vitest survived | 0 | 5 → 4 | 1 / 0 | 0 / 0 | 4,051 → 2,972 | 1,060 → skipped | 1,387 → 1,358 | 460 → 473 | 673 → 673 | 471 → 468 | 0 → 0 |
| Vitest before-all | withheld | 5 → 4 | 1 / 0 | 0 / 0 | 4,021 → 2,997 | 1,062 → skipped | 1,362 → 1,400 | 462 → 463 | 674 → 674 | 461 → 460 | 0 → 0 |
| Jest/Expo normal-1 | 75 | 11 → 10 | 4 / 0 | 3 / 0 | 17,128 → 17,024 | 710 → skipped | 880 → 916 | 3,137 → 3,273 | 3,177 → 3,367 | 5,334 → 5,464 | 3,886 → 4,000 |
| Jest/Expo assertion-kill | 100 | 5 → 4 | 1 / 0 | 0 / 0 | 7,789 → 7,246 | 708 → skipped | 955 → 905 | 2,485 → 2,530 | 2,394 → 2,512 | 1,242 → 1,296 | 0 → 0 |
| Jest/Expo survivor | 0 | 5 → 4 | 1 / 0 | 0 / 0 | 7,581 → 7,148 | 718 → skipped | 896 → 918 | 2,349 → 2,424 | 2,372 → 2,527 | 1,243 → 1,277 | 0 → 0 |
| Jest/Expo before-all | withheld | 5 → 4 | 1 / 0 | 0 / 0 | 7,755 → 7,137 | 698 → skipped | 890 → 916 | 2,479 → 2,474 | 2,451 → 2,466 | 1,233 → 1,278 | 0 → 0 |

### macos-x64

| Report | Score | jobsAttempted | mutation jobs / workerBaselineJobs | pseudo-test jobs / workerBaselineJobs | Execution ms | typecheck | compilerStrictness | baseline | coverage | mutation wall | pseudo-test wall |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| example node | 75 | 10 → 9 | 4 / 0 | 2 / 0 | 5,644 → 2,763 | 877 → skipped | 1,329 → 716 | 349 → 220 | 903 → 512 | 1,447 → 886 | 735 → 425 |
| example jest-expo | 75 | 11 → 10 | 4 / 0 | 3 / 0 | 32,337 → 19,998 | 1,506 → skipped | 1,848 → 1,244 | 6,361 → 5,701 | 6,448 → 3,437 | 9,761 → 5,523 | 6,401 → 4,086 |
| example vitest | 83.33 | 14 → 13 | 6 / 0 | 4 / 0 | 16,300 → 12,429 | 1,612 → skipped | 2,304 → 1,726 | 1,033 → 887 | 1,343 → 1,143 | 6,183 → 5,224 | 3,819 → 3,446 |
| example workspaces | 100 | 9 → 8 | 2 / 0 | 3 / 0 | 4,164 → 2,561 | 607 → skipped | 876 → 715 | 263 → 221 | 630 → 512 | 506 → 439 | 1,278 → 670 |
| Vitest stack | 83.33 | 14 → 13 | 6 / 0 | 4 / 0 | 19,390 → 13,829 | 1,732 → skipped | 2,230 → 1,935 | 1,268 → 989 | 1,580 → 1,365 | 7,502 → 5,733 | 5,074 → 3,804 |
| Vitest assertion | 100 | 5 → 4 | 1 / 0 | 0 / 0 | 7,865 → 4,450 | 2,533 → skipped | 2,402 → 1,980 | 817 → 780 | 1,321 → 1,021 | 789 → 667 | 0 → 0 |
| Vitest survived | 0 | 5 → 4 | 1 / 0 | 0 / 0 | 6,789 → 4,134 | 1,795 → skipped | 2,339 → 1,916 | 784 → 643 | 1,097 → 934 | 771 → 640 | 0 → 0 |
| Vitest before-all | withheld | 5 → 4 | 1 / 0 | 0 / 0 | 6,767 → 4,114 | 1,766 → skipped | 2,351 → 1,903 | 789 → 651 | 1,085 → 901 | 774 → 656 | 0 → 0 |
| Jest/Expo normal-1 | 75 | 11 → 10 | 4 / 0 | 3 / 0 | 50,681 → 27,003 | 2,065 → skipped | 7,077 → 3,474 | 7,047 → 5,290 | 10,134 → 4,421 | 12,732 → 7,880 | 11,613 → 5,925 |
| Jest/Expo assertion-kill | 100 | 5 → 4 | 1 / 0 | 0 / 0 | 16,878 → 10,210 | 1,636 → skipped | 2,353 → 1,562 | 4,765 → 3,444 | 5,284 → 3,311 | 2,832 → 1,886 | 0 → 0 |
| Jest/Expo survivor | 0 | 5 → 4 | 1 / 0 | 0 / 0 | 14,241 → 10,260 | 1,590 → skipped | 1,644 → 1,786 | 4,660 → 3,380 | 3,913 → 3,204 | 2,423 → 1,883 | 0 → 0 |
| Jest/Expo before-all | withheld | 5 → 4 | 1 / 0 | 0 / 0 | 13,488 → 9,745 | 1,346 → skipped | 1,714 → 1,305 | 4,420 → 3,251 | 3,893 → 3,381 | 2,106 → 1,802 | 0 → 0 |

### macos-arm64

| Report | Score | jobsAttempted | mutation jobs / workerBaselineJobs | pseudo-test jobs / workerBaselineJobs | Execution ms | typecheck | compilerStrictness | baseline | coverage | mutation wall | pseudo-test wall |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| example node | 75 | 10 → 9 | 4 / 0 | 2 / 0 | 3,207 → 2,555 | 607 → skipped | 872 → 829 | 180 → 224 | 409 → 430 | 746 → 680 | 365 → 391 |
| example jest-expo | 75 | 11 → 10 | 4 / 0 | 3 / 0 | 22,193 → 19,193 | 948 → skipped | 1,277 → 1,106 | 4,846 → 4,229 | 4,129 → 4,472 | 6,256 → 4,976 | 4,708 → 4,404 |
| example vitest | 83.33 | 14 → 13 | 6 / 0 | 4 / 0 | 11,426 → 12,064 | 1,155 → skipped | 1,663 → 1,710 | 610 → 998 | 940 → 1,251 | 4,639 → 5,135 | 2,415 → 2,967 |
| example workspaces | 100 | 9 → 8 | 2 / 0 | 3 / 0 | 2,380 → 2,020 | 485 → skipped | 553 → 618 | 181 → 159 | 360 → 377 | 316 → 342 | 483 → 520 |
| Vitest stack | 83.33 | 14 → 13 | 6 / 0 | 4 / 0 | 12,599 → 15,924 | 1,339 → skipped | 2,032 → 3,050 | 1,027 → 1,448 | 1,034 → 1,545 | 4,340 → 5,774 | 2,825 → 4,104 |
| Vitest assertion | 100 | 5 → 4 | 1 / 0 | 0 / 0 | 5,133 → 4,761 | 1,294 → skipped | 1,667 → 1,993 | 667 → 738 | 868 → 1,149 | 634 → 850 | 0 → 0 |
| Vitest survived | 0 | 5 → 4 | 1 / 0 | 0 / 0 | 5,305 → 4,011 | 1,461 → skipped | 2,086 → 1,940 | 565 → 680 | 756 → 765 | 432 → 624 | 0 → 0 |
| Vitest before-all | withheld | 5 → 4 | 1 / 0 | 0 / 0 | 5,548 → 3,496 | 1,506 → skipped | 1,709 → 1,717 | 659 → 534 | 899 → 722 | 773 → 522 | 0 → 0 |
| Jest/Expo normal-1 | 75 | 11 → 10 | 4 / 0 | 3 / 0 | 21,438 → 20,396 | 1,062 → skipped | 1,303 → 1,283 | 4,161 → 4,304 | 3,882 → 3,362 | 6,613 → 6,674 | 4,406 → 4,765 |
| Jest/Expo assertion-kill | 100 | 5 → 4 | 1 / 0 | 0 / 0 | 11,061 → 9,986 | 856 → skipped | 1,441 → 1,795 | 3,971 → 3,207 | 3,281 → 3,061 | 1,500 → 1,910 | 0 → 0 |
| Jest/Expo survivor | 0 | 5 → 4 | 1 / 0 | 0 / 0 | 11,017 → 9,670 | 932 → skipped | 1,318 → 1,868 | 3,697 → 3,483 | 3,027 → 2,832 | 2,038 → 1,480 | 0 → 0 |
| Jest/Expo before-all | withheld | 5 → 4 | 1 / 0 | 0 / 0 | 10,612 → 12,562 | 903 → skipped | 1,429 → 1,490 | 3,899 → 5,348 | 2,680 → 3,953 | 1,695 → 1,762 | 0 → 0 |

### windows-x64

| Report | Score | jobsAttempted | mutation jobs / workerBaselineJobs | pseudo-test jobs / workerBaselineJobs | Execution ms | typecheck | compilerStrictness | baseline | coverage | mutation wall | pseudo-test wall |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| example node | 75 | 10 → 9 | 4 / 0 | 2 / 0 | 3,465 → 2,791 | 610 → skipped | 880 → 851 | 201 → 196 | 602 → 583 | 778 → 766 | 384 → 388 |
| example jest-expo | 75 | 11 → 10 | 4 / 0 | 3 / 0 | 29,134 → 27,881 | 1,044 → skipped | 1,284 → 1,284 | 5,729 → 6,045 | 5,301 → 5,146 | 9,051 → 8,927 | 6,715 → 6,469 |
| example vitest | 83.33 | 14 → 13 | 6 / 0 | 4 / 0 | 17,361 → 15,902 | 1,580 → skipped | 2,071 → 2,060 | 1,130 → 1,146 | 1,521 → 1,490 | 6,756 → 6,903 | 4,296 → 4,296 |
| example workspaces | 100 | 9 → 8 | 2 / 0 | 3 / 0 | 3,262 → 2,526 | 622 → skipped | 854 → 833 | 191 → 180 | 571 → 567 | 403 → 380 | 615 → 561 |
| Vitest stack | 83.33 | 14 → 13 | 6 / 0 | 4 / 0 | 18,315 → 16,406 | 1,687 → skipped | 2,150 → 2,127 | 1,216 → 1,218 | 1,556 → 1,559 | 7,134 → 6,976 | 4,568 → 4,521 |
| Vitest assertion | 100 | 5 → 4 | 1 / 0 | 0 / 0 | 6,556 → 4,718 | 1,673 → skipped | 2,210 → 2,130 | 789 → 768 | 1,091 → 1,045 | 790 → 773 | 0 → 0 |
| Vitest survived | 0 | 5 → 4 | 1 / 0 | 0 / 0 | 6,441 → 4,807 | 1,678 → skipped | 2,109 → 2,172 | 776 → 782 | 1,091 → 1,094 | 785 → 757 | 0 → 0 |
| Vitest before-all | withheld | 5 → 4 | 1 / 0 | 0 / 0 | 6,568 → 4,757 | 1,702 → skipped | 2,169 → 2,138 | 783 → 796 | 1,110 → 1,052 | 802 → 769 | 0 → 0 |
| Jest/Expo normal-1 | 75 | 11 → 10 | 4 / 0 | 3 / 0 | 26,551 → 25,418 | 1,145 → skipped | 1,419 → 1,426 | 4,560 → 4,562 | 4,724 → 4,678 | 8,395 → 8,442 | 6,299 → 6,304 |
| Jest/Expo assertion-kill | 100 | 5 → 4 | 1 / 0 | 0 / 0 | 12,011 → 10,949 | 1,187 → skipped | 1,406 → 1,396 | 3,654 → 3,646 | 3,800 → 3,817 | 1,955 → 2,083 | 0 → 0 |
| Jest/Expo survivor | 0 | 5 → 4 | 1 / 0 | 0 / 0 | 11,881 → 10,807 | 1,127 → skipped | 1,358 → 1,426 | 3,680 → 3,614 | 3,733 → 3,734 | 1,975 → 2,027 | 0 → 0 |
| Jest/Expo before-all | withheld | 5 → 4 | 1 / 0 | 0 / 0 | 12,169 → 10,824 | 1,160 → skipped | 1,426 → 1,399 | 3,700 → 3,674 | 3,837 → 3,762 | 2,037 → 1,983 | 0 → 0 |
