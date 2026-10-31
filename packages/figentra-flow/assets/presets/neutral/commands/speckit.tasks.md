---
description: Generate tasks that trace to the spec's acceptance criteria.
strategy: wrap
---

## Workflow: feature directory (runs first)

Specs live in `.agents/specs/<key>-<slug>/`, keyed by the spec's issue, never in `specs/`. Before anything else run
`figentra-flow gate dir` (add `--key <key>` when the branch name carries no key). It prints the spec folder for the
branch's issue key and writes `.specify/feature.json`. Pass that path as `SPECIFY_FEATURE_DIRECTORY=<path>` in front
of every `.specify/scripts` call this command makes. If it fails, STOP and report it; never fall back to a numbered
folder.

{CORE_TEMPLATE}

## Workflow: task lines

Every task line follows the tasks template: `- [ ] T012 [P] <desc> in `path` — covers: AC-003 — deps: T010`. Run
`figentra-flow gate tasks <tasks.md>` until it passes (ids, coverage, deps, waves). Then set `**Status**: Tasked` and
append the Status history line.
