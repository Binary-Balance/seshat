# Unreleased changes

CRAP now uses branch coverage by default, falling back to statement coverage
for functions with no recorded Istanbul branches. Scores rise for functions
with untested branch outcomes, even when every statement ran. Existing
`maxCrap` thresholds may therefore fail where they previously passed.

Statement coverage remains available in the report. Report schema version 1
adds `branchCovered`, `branchTotal`, `branchCoverage` and `coverageBasis` to
function rows. Missing or unreliable branch data leaves CRAP unknown rather
than falling back to statements.

See [#130](https://github.com/Binary-Balance/seshat/issues/130) and the
[report format](../report-format.md). No release version is selected by this note.
