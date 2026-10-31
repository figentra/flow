---
description: Execute tasks.md from the spec's .agents/specs folder.
strategy: wrap
---

## Stackra: feature directory (runs first)

Specs live in `.agents/specs/sta-<n>-<slug>/` (ADR 0120 D1), never in `specs/`. Before anything else run
`pnpm spec:gate dir` (add `--key STA-n` when the branch name carries no key). It prints the
spec folder for the branch's Linear key and writes `.specify/feature.json`. Pass that path as
`SPECIFY_FEATURE_DIRECTORY=<path>` in front of every `.specify/scripts` call this command makes. If it fails,
STOP and report it; never fall back to a numbered folder.

{CORE_TEMPLATE}

## Stackra: status

Refuse to start unless the spec's `**Status**` is Tasked or Implementing and the branch is Linear-named
(`pnpm spec:gate branch`). On the first ticked task set `**Status**: Implementing` (Status history
line). Every test you write carries a `// @covers sta-n:FR-###` line (a line comment: JSDoc lint rejects unknown tags). When every task is `[x]` (or struck by an
amendment), `pnpm spec:trace ci` passes and the Impact docs are touched, set `**Status**: Done`.
