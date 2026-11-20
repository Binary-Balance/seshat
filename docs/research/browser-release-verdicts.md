# 0.17.0 → 0.18.0 native verdict comparison

All **3,333 shared outcomes** retain their verdict and
counted-kill flag: 2,916 mutation outcomes
and 417 extreme/pseudo-testing outcomes.
All **527 full source arrays** (568 records),
shared scores and completion states match. No report or outcome was added or
removed. 309 full reports are complete and 218 remain
incomplete; unresolved fixtures remain unresolved.

Compared 838 report pairs from eight artifact pairs. All consumed
JSON was checked against official artifact ZIP digests and member bytes:
16 ZIPs, 176 JSON members.

| Artifact | Report pairs | Shared outcomes |
| --- | ---: | ---: |
| linux-arm64-package-proof | 96 | 499 |
| linux-x64-package-proof | 181 | 720 |
| macos-arm64-package-proof | 226 | 822 |
| macos-x64-package-proof | 96 | 499 |
| windows-runtime-cli-evidence | 6 | 3 |
| windows-runtime-preflight | 0 | 0 |
| windows-shared-fixture-evidence | 84 | 196 |
| windows-x64-package-proof | 149 | 594 |

Baseline: [0.17.0 audit](../releases/0.17.0-audit.json), direct build head
`217a29315bf2b3460bbcb940ca707394387ca58a`. Candidate: 0.18.0 direct build head
`609cf0e4f3545865afa8c858f09a8cd0f7a7d238` in [PR #305](https://github.com/Binary-Balance/seshat/pull/305).
Source and artifact coordinates are retained in the
[comparison JSON](browser-release-verdicts.json) and
[artifact verification](browser-release-artifacts.json).

## Intended additions and observed differences

- New `browser: null` diagnostics in non-browser reports are empty defaults:
  825 removed before comparison. Any non-null browser
  evidence stays visible. No assessment value or verdict is normalised away.
- macOS ARM64's latest-Node pass advanced from 24.22.2 to 24.22.3. Its eight
  `node-VERSION` artifact members are paired under `node-latest`; exact original
  member paths and hashes remain in `memberPaths`. Runtime values remain
  explicit differences. Other hosts' latest-Node passes are separate artifacts
  and are covered by CI, not this retained comparison.
- 8 setup states in deliberate `source-error` fixtures move
  between `not-run` and `execution-error` as scheduling changes. Overall outcomes
  remain execution errors. Four reports change total jobs; the full JSON keeps
  each change and all phase timings.
- 82 execution-state differences are receipt filename numbering
  (`capture-N-3` versus `capture-N-9`, for example). The per-attempt temp dirs
  use the same allocator. State and error meaning remain unchanged.
- 5 Windows cancelled child exits differ between `1` and
  `-1073741510`; cancellation flags and all numeric CLI statuses match.
- Remaining recorded differences are diagnostic text, timing-ranked slowest
  executions, temporary Jest paths, expected version text (25 errors), two
  supervision binary hashes, and stderr text. None changes source assessments,
  eligibility/planned counts or final scores.

All 533 shared CLI statuses and 633
numeric process statuses match. Worker and prepared-baseline job counts match;
total-job arithmetic passes for all 527 full reports.
Selection, selection-cancellation and execute-cancellation summaries are unchanged.
Timing observations are from separate runs and imply no speed guarantee.

Existing fixture subtrees, examples and proof generators are bound to Git
object IDs in `fixtureSourceVerification`. The added browser fixture is outside
that shared set; its evidence is recorded [separately](browser-release-hosts.json).

## Reproduce and limits

From the repository root, with retained inputs under `work/release-0.18.0`:

```sh
python3 -I work/release-0.18.0/verdict-comparison/verify_artifacts.py
python3 -I work/release-0.18.0/verdict-comparison/compare.py
python3 -I work/release-0.18.0/verdict-comparison/render.py
```

The JSON retains verifier/comparator/renderer hashes and measured job/timing
values. These scripts and downloaded raw reports are local retained evidence;
the public report carries portable paths and GitHub artifact identities. This
checks the recorded fixture executions, not all possible consuming projects.
