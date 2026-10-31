---
description: Resolve open questions; mark the spec complete only when none remain.
strategy: wrap
---

## Stackra: feature directory (runs first)

Specs live in `.agents/specs/sta-<n>-<slug>/` (ADR 0120 D1), never in `specs/`. Before anything else run
`pnpm spec:gate dir` (add `--key STA-n` when the branch name carries no key). It prints the
spec folder for the branch's Linear key and writes `.specify/feature.json`. Pass that path as
`SPECIFY_FEATURE_DIRECTORY=<path>` in front of every `.specify/scripts` call this command makes. If it fails,
STOP and report it; never fall back to a numbered folder.

{CORE_TEMPLATE}

## Stackra: completion marker

When no `[NEEDS CLARIFICATION` marker remains anywhere in the spec, every `## Impact` answer is
filled, and `**Linear**` holds a real `STA-n` key, set `**Clarifications status**: complete`.
Otherwise leave it `pending` and list what is still open. Decisions (lane, licence tier, deploy-mode limits,
retention, providers) come only from the owner; never answer them yourself.

When it is complete, set `**Status**: Clarified`, append `<date> · Draft → Clarified · <you> · <owner's go>` to
`## Status history`, and verify with `pnpm spec:gate plan <spec.md>` and
`pnpm spec:gate check <folder>`. A missing Linear issue is created with
`pnpm spec:linear issue <spec.md>`.
