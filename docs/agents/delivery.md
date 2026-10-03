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

Review passes use fresh agents with no inherited conversation history. The
fresh context is what matters, not which model reviews.

## When to delegate

Ask: **What does this delegation buy us: parallel progress, independent
scrutiny, or relief from a concrete context problem?** If there is no clear
answer, continue directly.

Delegate a bounded assignment when at least one of these benefits applies:

- Work can proceed independently, and the parent has other useful work to do
  while the child implements.
- Independent judgment is valuable, such as reviewing substantial changes.
  This is a quality benefit even when it costs more.
- Fresh context addresses conflicting or distracting history that is affecting
  progress. Conversation length alone is insufficient.

Prefer direct work when explaining and supervising the assignment would
approach the effort of completing it. For well-specified, independently
verifiable implementation, consider delegating to the least expensive available
model that can do the work reliably. The required checks and independent review
below apply whether implementation is direct or delegated, so its mistakes are
caught.

## Bounded delegation and implementation ownership

Before delegating, define one independently reviewable slice: the concrete
inputs, output, files owned, relevant interfaces, constraints, acceptance checks,
and the point at which the agent should stop and report. Include the decisions
and context needed for that slice; link supporting material instead of copying
unrelated history. Split broad work at useful completion boundaries, not into
instructions for every edit.

Assign one clear implementer to each slice and one writer per branch at a time.
The coordinator owns scope, contracts, decisions and delivery coordination. It
must not mirror the implementer's investigation, coding or routine validation.
While implementation runs, resolve a distinct open question or wait for an
agreed milestone. Request updates at those milestones or when evidence indicates
a blocker; silence alone is not proof that work has stalled.

If repeated clarification or repair consumes the expected benefit, narrow the
assignment or explicitly transfer implementation ownership. If progress stalls,
inspect the cause while preserving useful context, files and evidence. Before
another agent takes over edits, stop the previous writer and explicitly transfer
ownership. A handoff does not bypass the normal review requirements. Parallel
implementation is appropriate only for independently scoped work without
conflicting writers.

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
3. Start a fresh review agent with no inherited conversation history. Give it
   the PR URL, current head commit and originating issue/specification. It
   must read repository instructions and inspect the full PR diff and relevant
   code, checking correctness, requirements, simplicity and validation. It must
   not edit the implementation.
4. Have the reviewer post its findings on the PR. Each actionable finding needs
   a file/line reference, the concrete problem and its impact. Record the
   reviewed commit, checks performed and any verification gaps. If there are
   no actionable findings, say so explicitly. Use a review comment if the shared
   GitHub account cannot formally review its own PR; do not claim an independent
   GitHub approval.
5. If findings need changes, the current implementer can fix them. Delegate fixes
   only when the criteria above justify it, with an explicit ownership transfer
   if the writer changes. Give a delegated fixer the PR, current head and review
   findings. The implementer must read the relevant code, make the necessary
   fixes, run appropriate checks, commit and push to the same branch, and post
   what changed and how it was verified. Explain with evidence when a finding
   does not warrant a change; do not silently dismiss it. Keep one writer per
   branch at a time.
6. After fixes or a disputed finding, start another fresh reviewer for the
   updated PR. Check prior findings and the full current diff for regressions.
   Repeat the review/fix cycle until no actionable findings or unresolved
   verification gaps remain. Do not reuse the implementation or fix agent as
   the reviewer.

The coordinating agent owns this loop. Review and fix agents report back after
their assigned pass; they do not start their own delivery loops. Fresh reviews
require actual new agent sessions, not role changes in an existing conversation.
Coordinate branch checkouts when agents share a workspace so that a writer
cannot change files under another agent's review.

A PR is ready to merge when its current head has a clean fresh-agent review,
all findings are addressed or explicitly resolved, relevant local checks and
configured required GitHub checks pass, and it has no merge conflicts. No CI
configuration is not evidence of passing tests; record local validation. Recheck
the head after any further push. Report the PR link and readiness to the user.

Continue autonomously through actionable fixes. If progress needs unavailable
credentials, infrastructure or a user decision, report the specific blocker and
keep the PR unready. Do not stop merely because one review/fix round completed.

## Merging

When merging is authorised, recheck the reviewed commit, required checks and
conflict status. Choose the merge method that leaves the clearer history:

- Squash (`--squash`) when the branch's commits are mostly review fixes or
  other steps that mean little on their own.
- Use a merge commit (`--merge`) when each commit is a meaningful step worth
  keeping, or when another open PR is stacked on the branch.

Use `gh pr merge <number> <method> --match-head-commit <sha>` with the reviewed
head SHA so a later push cannot be merged accidentally. Confirm the PR merged
and the resulting commit reached `main`. Close linked issues only when their
acceptance criteria are met.

## Branch and worktree cleanup

After confirming the merge:

1. Fetch the latest remote refs. Delete the task's remote branch if GitHub has
   not already deleted it, provided it still points to the merged PR's head.
2. Remove a task worktree only when it is clean and no other agent or session is
   using it. Preserve unfinished work and unique evidence.
3. Leave the task branch before deleting it locally with `git branch -d`. After
   a squash merge Git refuses, because the original commits are not in `main`.
   Use `git branch -D` only after confirming the branch tip matches the merged
   PR's head and holds no later or unpushed work.
4. Prune stale remote refs and worktree entries, and update a clean local `main`
   with a fast-forward only. Leave unrelated branches and active worktrees alone.

If cleanup cannot safely finish, report what remains and why. Cleanup must not
discard work or interrupt another session.

## npm publication checkpoint

Before an agent publishes to npm, complete release preparation, applicable
checks and the dry run. Present the exact package names and versions, release
revision, registry and dist tag, together with a brief summary of changes and
validation results. Give the maintainer a chance to review the prepared release
and request final changes.

Wait for explicit approval of that prepared release before running `npm publish`
or invoking a publisher or workflow with publishing enabled. A request to
prepare a release does not authorise publication. One approval covers the named native
payloads and entry package, including retries with unchanged inputs; do not ask
separately for each package.

If package contents, the release revision or publication targets change, repeat
the affected preparation and checks, present the updated release, and obtain
approval before publishing it. This is an agent checkpoint, not a GitHub
protected environment or a change to repository permissions, npm access or
trusted publisher configuration. Follow the [npm publication runbook](../npm-publishing.md)
for the preparation and publishing steps.
