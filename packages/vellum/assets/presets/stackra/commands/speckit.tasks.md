---
description: Generate tasks; each maps to a Linear issue.
strategy: wrap
---

## Stackra: feature directory (runs first)

Specs live in `.agents/specs/sta-<n>-<slug>/` (ADR 0120 D1), never in `specs/`. Before anything else run
`pnpm spec:gate dir` (add `--key STA-n` when the branch name carries no key). It prints the
spec folder for the branch's Linear key and writes `.specify/feature.json`. Pass that path as
`SPECIFY_FEATURE_DIRECTORY=<path>` in front of every `.specify/scripts` call this command makes. If it fails,
STOP and report it; never fall back to a numbered folder.

{CORE_TEMPLATE}

## Stackra: Linear mapping

Every task line follows the Stackra tasks template:
`- [ ] T012 [P] [US1] <desc> in <path> — covers: FR-003, P-002 — route: <task type> — deps: T010`. Run
`pnpm spec:gate tasks <tasks.md>` until it passes (ids, routes, coverage, deps, waves). Then set
`**Status**: Tasked`, append the Status history line, and run `/speckit.taskstoissues`, which files each task as a
Linear sub-issue through `pnpm spec:linear tasks` and appends ` [STA-n]`.
