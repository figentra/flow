---
description: Cross-check spec, plan and tasks in the spec's .agents/specs folder.
strategy: wrap
---

## Workflow: feature directory (runs first)

Specs live in `.agents/specs/<key>-<slug>/`, keyed by the spec's issue, never in `specs/`. Before anything else run
`figentra-flow gate dir` (add `--key <key>` when the branch name carries no key). It prints the spec folder for the
branch's issue key and writes `.specify/feature.json`. Pass that path as `SPECIFY_FEATURE_DIRECTORY=<path>` in front
of every `.specify/scripts` call this command makes. If it fails, STOP and report it; never fall back to a numbered
folder.

{CORE_TEMPLATE}
