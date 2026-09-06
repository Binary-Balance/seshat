# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `Binary-Balance/seshat`.
Use the `gh` CLI from inside this clone, or pass
`--repo Binary-Balance/seshat` explicitly.

## Conventions

- Create: `gh issue create --title "..." --body "..."`
- Read with labels and discussion:
  `gh issue view <number> --json number,title,body,labels,comments`
- List: `gh issue list --state open --json number,title,labels`
- Comment: `gh issue comment <number> --body "..."`
- Add labels: `gh issue edit <number> --add-label "..."`
- Remove labels: `gh issue edit <number> --remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

Use `--body-file` for long issue bodies.

When a skill says "publish to the issue tracker", create a GitHub issue.
When it says "fetch the relevant ticket", read the issue and its comments.

## Pull requests as a triage surface

PRs as a request surface: no.

## Wayfinding operations

For `/wayfinder`, use one issue labelled `wayfinder:map` as the map.
Its body holds Notes, Decisions-so-far, and Fog.

- Link child tickets as GitHub sub-issues. If unavailable, use a task list
  in the map and a `Part of #<map>` reference in each child.
- Label children `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling`, or `wayfinder:task`.
- Record blockers using native GitHub issue dependencies. If unavailable,
  use a `Blocked by: #<number>` line in the child.
- Choose the first open, unassigned child in map order with no open blockers.
- Claim it with `gh issue edit <number> --add-assignee @me`.
- Resolve it by commenting with the result, closing the issue, and adding
  a summary and link to the map's Decisions-so-far.
