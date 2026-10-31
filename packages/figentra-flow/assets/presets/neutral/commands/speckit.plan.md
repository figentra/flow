---
description: Plan the feature; refuses until the spec gate passes.
strategy: wrap
---

## Workflow: feature directory (runs first)

Specs live in `.agents/specs/<key>-<slug>/`, keyed by the spec's issue, never in `specs/`. Before anything else run
`figentra-flow gate dir` (add `--key <key>` when the branch name carries no key). It prints the spec folder for the
branch's issue key and writes `.specify/feature.json`. Pass that path as `SPECIFY_FEATURE_DIRECTORY=<path>` in front
of every `.specify/scripts` call this command makes. If it fails, STOP and report it; never fall back to a numbered
folder.

## Workflow: gate (runs first)

`setup-plan.sh` runs `figentra-flow gate plan` and exits non-zero until the spec has
`**Clarifications status**: complete` and an `**Issue**` key. If it fails, STOP: print its output, tell the user to
run `/speckit.clarify`, and write nothing. Never edit the marker yourself to get past the gate.

{CORE_TEMPLATE}

## Workflow: Planned

For a `feature` or `big` spec, `plan.md` is the design: the gate requires its sections (write "none" under one that
does not apply). Then set `**Status**: Planned`, append the Status history line, and run
`figentra-flow gate check <folder>`. The next step is `/speckit.tasks`.

## Workflow: approval stop

A `feature` spec stops once, after the spec and plan; a `big` spec stops after the spec (before planning) and after
the plan (before tasks). At a stop, ask the approver named in `**Approver**`: Approve, Revise with notes, Reject. On
Approve, add `— Approved by <who> <YYYY-MM-DD>` to the `**Status**` line and to its Status history line. On Revise,
apply the notes and ask again. On Reject, set `**Status**: Abandoned`. Never record an approval nobody gave; the gate
reads it before tasks and code.
