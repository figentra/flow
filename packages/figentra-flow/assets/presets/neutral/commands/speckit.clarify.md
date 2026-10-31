---
description: Resolve open questions; mark the spec complete only when none remain.
strategy: wrap
---

## Workflow: feature directory (runs first)

Specs live in `.agents/specs/<key>-<slug>/`, keyed by the spec's issue, never in `specs/`. Before anything else run
`figentra-flow gate dir` (add `--key <key>` when the branch name carries no key). It prints the spec folder for the
branch's issue key and writes `.specify/feature.json`. Pass that path as `SPECIFY_FEATURE_DIRECTORY=<path>` in front
of every `.specify/scripts` call this command makes. If it fails, STOP and report it; never fall back to a numbered
folder.

{CORE_TEMPLATE}

## Workflow: completion marker

When no `[NEEDS CLARIFICATION` marker remains anywhere in the spec and `**Issue**` holds a real key, set
`**Clarifications status**: complete`. Otherwise leave it `pending` and list what is still open. Decisions that
belong to the approver come only from them; never answer them yourself.

When it is complete, set `**Status**: Clarified`, append `<date> · Draft → Clarified · <you> · <note>` to
`## Status history`, and verify with `figentra-flow gate plan <spec.md>` and `figentra-flow gate check <folder>`.

## Workflow: approval stop

A `feature` spec stops once, after the spec and plan; a `big` spec stops after the spec (before planning) and after
the plan (before tasks). At a stop, ask the approver named in `**Approver**`: Approve, Revise with notes, Reject. On
Approve, add `— Approved by <who> <YYYY-MM-DD>` to the `**Status**` line and to its Status history line. On Revise,
apply the notes and ask again. On Reject, set `**Status**: Abandoned`. Never record an approval nobody gave; the gate
reads it before tasks and code.
