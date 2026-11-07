---
name: docs-adr
description: Write or supersede an Architecture Decision Record in the house format and keep the ADR index consistent. Use whenever a rule, boundary, technology, or process decision changes. Reserve the number first with pnpm adr:reserve (numbers.yaml on main).
---
# ADR

The format is `apps/docs/src/docs/adr/template.mdx`; this skill only restates it.

1. Number: reserve it first with `pnpm adr:reserve <slug> --issue STA-n`, which lands it in `apps/docs/adr/numbers.yaml` on main; the first reservation to land wins, so a conflicting reservation PR is closed and run again. Never take the highest on a branch plus one.
   File: `apps/docs/src/docs/adr/NNNN-<kebab-slug>.mdx`, copied from the template.
2. Frontmatter: `title: "NNNN — Title"` and `description: "<Status> · YYYY-MM-DD"`. Status is one of Proposed, Accepted,
   Deferred, Rejected or `Superseded by NNNN` (the template's status table). Nothing may rely on a Proposed ADR.
3. Sections in order: `## Context`, `## Decision` (numbered rules a reviewer can say yes or no to), `## Consequences`,
   `## Enforcement` (the check by path, or `planned — <mechanism>`), `## Revival trigger` (Deferred and Rejected only),
   `## Supersedes and sources`.
4. Supersession happens in the same commit: the new ADR says `Supersedes: NNNN`; the old ADR's description becomes
   `Superseded by NNNN · <date>` and it gains a `<Note>` pointing forward. A partial change (one row, one decision) adds an
   "Amended by" `<Note>` and keeps the description. An Accepted ADR's body is edited only for typos and its Enforcement line.
5. Projection: if the decision changes a law, update the constitution page and its History in the same commit; if it changes
   a rule, update the matching `.agents/rules/*.md` and run `pnpm agents:sync`. If enforceable, add the check.
6. Add the row to `apps/docs/src/docs/adr/index.mdx` (the `{ folder: "adr" }` entry in `apps/docs/src/config/docs.config.ts` lists the page), then
   run `pnpm verify` (gen assembles the site, then `mint validate` and `mint broken-links`).
