---
description: Create the spec in .agents/specs/sta-<n>-<slug>, interview the Impact questionnaire, then hand off to clarify.
strategy: wrap
---

## Stackra: feature directory (runs first)

Specs live in `.agents/specs/sta-<n>-<slug>/`, keyed by the spec's Linear issue (ADR 0120 D1). Never use
`specs/` and never auto-number: `feature_numbering` is `linear-key`, which means the directory always comes
from the Linear key, never from a scan. Once step 1 below has chosen the short name, and before step 3
creates the directory, run:

```bash
pnpm spec:gate dir --slug <short-name>
```

It reads the STA key from the branch name (`figentra/sta-<n>-…`; pass `--key STA-n` when the branch has none),
prints the folder and writes `.specify/feature.json`. That printed path **is** the explicitly provided
`SPECIFY_FEATURE_DIRECTORY` below: use it as-is, and pass `SPECIFY_FEATURE_DIRECTORY=<path>` in front of every
`.specify/scripts` call. If the command fails, STOP: there is no Linear issue yet. Create one
(`pnpm linear create --title "…"`), or ask the user for its key, and work on a Linear-named branch.

{CORE_TEMPLATE}

## Stackra: Impact questionnaire (mandatory)

The spec template (v2) carries an `## Impact` section. After drafting, ask the user each question in it and write
the answers in. Set `**Linear**` to the folder's key. Never guess an answer: leave it as
`[NEEDS CLARIFICATION: ...]`. Write requirements in EARS form ("WHEN … THE <subject> SHALL …"), give every SC a
verification method, and keep `## Amendments` and `## Status history` (one line: `<date> · — → Draft · <you> ·
created`). Leave `**Status**: Draft` and `**Clarifications status**: pending`, then run
`pnpm spec:gate check <folder>`. Do not run `/speckit.plan`: the next step is always
`/speckit.clarify`.
