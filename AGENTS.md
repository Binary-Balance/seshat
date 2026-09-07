## Agent skills

### Issue tracker

Use GitHub Issues in `Binary-Balance/seshat`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout. See `docs/agents/domain.md`.

## Delivery workflow

For routine documentation-only edits, check prose and technical accuracy,
commands and links, and the diff. When repository rules allow, commit and push
directly to `main` without a PR or fresh-agent review/fix loop; otherwise use the
minimal required PR route without that loop. Changes touching executable code,
runtime/build/CI configuration, or substantive security/release-support claims
follow the normal workflow in `docs/agents/delivery.md`.

For work covered by the normal workflow, commit it, push its branch and open a
GitHub pull request. Follow `docs/agents/delivery.md` for the fresh-agent review
and fix loop. Continue until the PR is ready to merge; do not merge unless asked.

## Disk housekeeping

Periodically check free disk space and repository build/cache usage, especially
before large builds and after completing work. Reclaim obsolete, reproducible
artifacts once required evidence is retained. Preserve active work, needed
toolchains and unique evidence; do not indiscriminately clear shared caches.
Use `df -h .` and targeted `du -sh` checks to confirm space stays under control.

## Public repository

Keep source, documentation, examples, committed reports and issue text independent
of the maintainer's other projects. Use self-contained fixtures and portable paths.
Normalise local paths before committing recorded evidence.
