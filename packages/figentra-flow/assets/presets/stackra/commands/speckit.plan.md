---
description: Plan the feature; refuses until the spec gate passes.
strategy: wrap
---

## Stackra: feature directory (runs first)

Specs live in `.agents/specs/sta-<n>-<slug>/` (ADR 0120 D1), never in `specs/`. Before anything else run
`pnpm spec:gate dir` (add `--key STA-n` when the branch name carries no key). It prints the
spec folder for the branch's Linear key and writes `.specify/feature.json`. Pass that path as
`SPECIFY_FEATURE_DIRECTORY=<path>` in front of every `.specify/scripts` call this command makes. If it fails,
STOP and report it; never fall back to a numbered folder.

## Stackra: gate (runs first)

`setup-plan.sh` runs `figentra-flow gate plan` and exits non-zero until the spec has
`**Clarifications status**: complete`, a `**Linear**: STA-n` key and a fully answered `## Impact`
section. If it fails, STOP: print its output, tell the user to run `/speckit.clarify`, and write
nothing. Never edit the marker yourself to get past the gate.

{CORE_TEMPLATE}

## Stackra: Planned

`plan.md` follows the Stackra plan template: every Constitution Check row is PASS or N/A with a reason, the three
deploy modes have rows, and every FR is validated by a `P-###` property (or the FR says `example-only`). Then set
`**Status**: Planned`, append the Status history line, and run `pnpm spec:gate check <folder>`.
The next step is `/speckit.tasks`.

## Stackra: approval stop (ADR 0502)

A `feature` spec stops once, after the spec and plan; a `big` spec stops after the spec (before planning) and after
the plan (before tasks). At a stop, ask the approver named in `**Approver**` with the question tool: Approve, Revise
with notes, Reject; to the owner, plan.md is "the design" (its nine sections, ADR 0502). On Approve, add `— Approved by <who> <YYYY-MM-DD>` to the `**Status**` line and to its Status
history line. On Revise, apply the notes and ask again. On Reject, set `**Status**: Abandoned`. Never record an
approval nobody gave; the gate and the plan-gate hook read it before tasks and code.
