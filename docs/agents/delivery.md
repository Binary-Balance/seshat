# Commit, review and fix

Apply this process whenever a piece of repository work is finished. Committing,
pushing a task branch, opening its PR and posting review/fix notes are part of
the task; do not ask for separate permission for each step. Stop before merging
unless the user has authorised the merge.

1. Check the diff and run the checks appropriate to the change. Retain required
   evidence with portable paths. Commit only the task's files on a `codex/`
   branch, preserving unrelated local work. Keep separate pieces of work in
   separate PRs.
2. Push the branch and open a PR in `Binary-Balance/seshat` against `main`, or
   update the existing PR for that work. Describe the problem, resulting
   behaviour, validation and material limits. Link the originating issue with
   `Closes #N` when merging will fully resolve it. Keep the issue open until then.
3. Start a fresh review agent with no inherited conversation history. Give it
   the PR URL, current head commit and originating issue/specification. It must
   read repository instructions and inspect the full PR diff and relevant code,
   checking correctness, requirements, simplicity and validation. It must not
   edit the implementation.
4. Have the reviewer post its findings on the PR. Each actionable finding needs
   a file/line reference, the concrete problem and its impact. Record the
   reviewed commit, checks performed and any verification gaps. If there are
   no actionable findings, say so explicitly. Use a review comment if the shared
   GitHub account cannot formally review its own PR; do not claim an independent
   GitHub approval.
5. If findings need changes, start a different fresh fix agent with no inherited
   conversation history. Give it the PR, current head and review findings. It
   must read the relevant code, make the necessary fixes, run appropriate checks,
   commit and push to the same branch, and post what changed and how it was
   verified. Explain with evidence when a finding does not warrant a change;
   do not silently dismiss it. Keep one writer per branch at a time.
6. After fixes or a disputed finding, start another fresh reviewer for the
   updated PR. Check prior findings and the full current diff for regressions.
   Repeat the review/fix cycle until no actionable findings or unresolved
   verification gaps remain. Do not reuse the implementation or fix agent as
   the reviewer.

The coordinating agent owns this loop. Review and fix agents report back after
their assigned pass; they do not start their own delivery loops. Use actual new
agent sessions, not role changes in an existing conversation. Coordinate branch
checkouts when agents share a workspace so that a writer cannot change files
under another agent's review.

A PR is ready to merge when its current head has a clean fresh-agent review,
all findings are addressed or explicitly resolved, relevant local checks and
configured required GitHub checks pass, and it has no merge conflicts. No CI
configuration is not evidence of passing tests; record local validation. Recheck
the head after any further push. Report the PR link and readiness to the user.

Continue autonomously through actionable fixes. If progress needs unavailable
credentials, infrastructure or a user decision, report the specific blocker and
keep the PR unready. Do not stop merely because one review/fix round completed.
