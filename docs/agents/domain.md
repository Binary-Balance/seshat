# Domain docs

## Layout

Seshat uses a single-context layout:

- `CONTEXT.md` at the repo root for domain terms and their meanings.
- `docs/adr/` for architecture decision records, or ADRs.

## Before exploring

Read `CONTEXT.md` and any ADRs relevant to the work.

If they do not exist, proceed silently. Do not propose creating them
just because they are missing. The domain-modeling skill creates them
when terms or decisions are resolved.

## Vocabulary

Use the terms defined in `CONTEXT.md` in issues, proposals, code, and tests.
Avoid synonyms the glossary explicitly rejects.

If a needed concept is missing, reconsider the term or note the gap
for domain-modeling.

## Decision conflicts

Explicitly flag proposals that contradict an existing ADR.
Identify the decision and explain why it should be reconsidered.
