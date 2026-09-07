# Commit, review and fix

Apply this process whenever work is not a routine documentation-only edit.
Routine documentation-only edits require checking prose and technical accuracy,
commands and links, and the diff. When repository rules allow, commit and push
them directly to `main` without a PR or fresh-agent review/fix loop; otherwise
use the minimal required PR route without that loop. Changes touching executable
code, runtime/build/CI configuration, or substantive security/release-support
claims use this normal workflow. Committing, pushing a task branch, opening its
PR and posting review/fix notes are part of the task; do not ask for separate
permission for each step. Stop before merging unless the user has authorised the
merge.

The coordinator delegates implementation work and review fixes to agents using
model `gpt-5.6-luna` with `reasoning_effort: max`. Review passes use fresh
agents with model `gpt-6-astra`; leave the reviewer's reasoning effort at its
default unless the user specifies one.

## Bounded delegation and implementation ownership

Before delegating, define one independently reviewable slice: the concrete
output, relevant files or interfaces, constraints, acceptance checks, and the
point at which the agent should stop and report. Include the decisions and
context needed for that slice; link supporting material instead of copying
unrelated history. Split broad work at useful completion boundaries, not into
instructions for every edit.

Assign one clear implementer to each slice and one writer per branch at a time.
The coordinator owns scope, contracts, decisions and delivery coordination. It
must not mirror the implementer's investigation, coding or routine validation.
While implementation runs, resolve a distinct open question or wait for an
agreed milestone. Request updates at those milestones or when evidence indicates
a blocker; silence alone is not proof that work has stalled.

If progress stalls, inspect the cause and narrow or reassign the slice while
preserving useful context, files and evidence. Before another agent takes over
edits, stop the previous writer and explicitly transfer ownership. A handoff
does not bypass the normal review requirements. Parallel implementation is
appropriate only for independently scoped work without conflicting writers.

Reuse applicable passing checks. Repeat them when the change, an unresolved
failure or a specific review concern warrants it. Keep independent review and
its targeted verification; avoiding duplicate routine work is not permission
to skip review or required validation.

## Review and fix loop

1. Check the diff and run the checks appropriate to the change. Retain required
   evidence with portable paths. Commit only the task's files on a `codex/`
   branch, preserving unrelated local work. Keep separate pieces of work in
   separate PRs.
2. Push the branch and open a PR in `Binary-Balance/seshat` against `main`, or
   update the existing PR for that work. Describe the problem, resulting
   behaviour, validation and material limits. Link the originating issue with
   `Closes #N` when merging will fully resolve it. Keep the issue open until then.
3. Start a fresh review agent with no inherited conversation history, using
   model `gpt-6-astra` and its default reasoning effort. Give it the PR URL,
   current head commit and originating issue/specification. It must read
   repository instructions and inspect the full PR diff and relevant code,
   checking correctness, requirements, simplicity and validation. It must not
   edit the implementation.
4. Have the reviewer post its findings on the PR. Each actionable finding needs
   a file/line reference, the concrete problem and its impact. Record the
   reviewed commit, checks performed and any verification gaps. If there are
   no actionable findings, say so explicitly. Use a review comment if the shared
   GitHub account cannot formally review its own PR; do not claim an independent
   GitHub approval.
5. If findings need changes, start a different fresh fix agent with no inherited
   conversation history, using model `gpt-5.6-luna` with `reasoning_effort: max`.
   Give it the PR, current head and review findings. It must read the relevant
   code, make the necessary fixes, run appropriate checks, commit and push to
   the same branch, and post what changed and how it was verified. Explain with
   evidence when a finding does not warrant a change; do not silently dismiss
   it. Keep one writer per branch at a time.
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
