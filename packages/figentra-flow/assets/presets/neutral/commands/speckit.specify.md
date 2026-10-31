---
description: Create the spec in .agents/specs/<key>-<slug>, then hand off to clarify.
strategy: wrap
---

## Workflow: feature directory (runs first)

Specs live in `.agents/specs/<key>-<slug>/`, keyed by the spec's issue. Never use `specs/` and never auto-number:
`feature_numbering` is `linear-key`, which means the directory always comes from the issue key, never from a scan.
Once step 1 below has chosen the short name, and before step 3 creates the directory, run:

```bash
figentra-flow gate dir --slug <short-name>
```

It reads the issue key from the branch name (pass `--key <key>` when the branch has none), prints the folder and
writes `.specify/feature.json`. That printed path **is** the explicitly provided `SPECIFY_FEATURE_DIRECTORY` below:
use it as-is, and pass `SPECIFY_FEATURE_DIRECTORY=<path>` in front of every `.specify/scripts` call. If the command
fails, STOP: there is no issue yet. Ask the user for its key, and work on a branch named after it.

{CORE_TEMPLATE}

## Workflow: after the draft

Set `**Issue**` to the folder's key. Never guess an answer: leave it as `[NEEDS CLARIFICATION: ...]`. Write
requirements and acceptance criteria in EARS form ("WHEN … THE <subject> SHALL …"), give every SC a verification
method, and keep `## Amendments` and `## Status history` (one line: `<date> · — → Draft · <you> · created`). Leave
`**Status**: Draft` and `**Clarifications status**: pending`, then run `figentra-flow gate check <folder>`. The next
step is always `/speckit.clarify`.
