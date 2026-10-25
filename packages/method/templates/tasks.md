# Implementation Plan

<!--
  TEMPLATE — the Vellum method's spec engine, document 3 of 3.
  Produced by the `spec-tasks` skill from `requirements.md` + `design.md`.

  The checkboxes in this file are LIVE STATE. An execution agent reads and writes
  them as work progresses. Every task line must match this parser exactly:

      /^(\s*)([-*+])\s+\[([ xX\-~])\](\\?\*?)\s+(.+)$/

  Consequences of that regex, which are not negotiable:
    - `[ ]` not started · `[-]` in progress · `[~]` queued · `[x]` completed
    - A `*` marks the task OPTIONAL. It may sit immediately after the closing
      bracket (`- [ ]* 1.3`) or after the task id (`- [ ] 1.3*`); the parser
      accepts both and treats them identically. Prefer the second — it is the
      form every example in this template uses.
      `- [ ] 1.3* Write unit tests for the parser`
    - Top-level tasks may NEVER be optional. Only sub-tasks may carry `*`.
    - Exactly TWO levels of nesting. Decimal numbering: `1`, then `1.1`.
      There is no `1.1.1`.
    - Every LEAF task ends with a traceability trailer on the same line:
      `_Requirements: 1.2, 3.4_` — numeric refs only, `<requirement>.<criterion>`.
      A leaf that tests a Correctness Property also cites it, after that
      trailer: `_Requirements: 2.1, 2.2_ _Properties: 2_` — design.md Property
      numbers only. Every Property must be cited by at least one task.
      Parent tasks carry no trailer; checkpoints carry no trailer.

  Replace every [bracketed placeholder]. Delete every HTML comment.
-->

## Overview

[One paragraph: what this plan builds, in what order, and why that order. Name the
first task that produces something runnable, and say how many waves the graph has.]

**Source documents:** `requirements.md`, `design.md` (both in this spec directory)

**Total leaf tasks:** [N] · **Optional leaf tasks:** [N] · **Waves:** [N]

## Tasks

- [ ] 1. [Parent task — a coherent unit of implementation, not a phase name]
  - [ ] 1.1 [Leaf task: one concrete change, named files, verifiable on its own] _Requirements: 1.1, 1.2_
  - [ ] 1.2 [Leaf task] _Requirements: 1.3_
  - [ ] 1.3* [Optional leaf task — tests for 1.1 and 1.2] _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. [Parent task]
  - [ ] 2.1 [Leaf task] _Requirements: 2.1_
  - [ ] 2.2 [Leaf task] _Requirements: 2.2, 2.3_
  - [ ] 2.3 [Property-based test for Property 2 — NOT optional] _Requirements: 2.1, 2.2_ _Properties: 2_

- [ ] 3. Checkpoint: ensure all tests pass

- [ ] 4. [Parent task]
  - [ ] 4.1 [Leaf task] _Requirements: 3.1_
  - [ ] 4.2 [Leaf task] _Requirements: 3.2, 3.3_

- [ ] 5. Checkpoint: ensure all tests pass

<!--
  A top-level task with no sub-tasks is itself a leaf and carries its own
  trailer:

      - [ ] 6. [Single-change top-level task] _Requirements: 4.1_

  State markers in use, for reference — do not leave these examples in a real plan:

      - [x] 7.1 [completed task] _Requirements: 5.1_
      - [-] 7.2 [task currently in progress] _Requirements: 5.2_
      - [~] 7.3 [task queued for execution] _Requirements: 5.3_
-->

## Task Dependency Graph

<!--
  Rules 1-3 are checked by `npx vellum lint`. Rules 4-6 are yours to apply, and
  nothing re-checks them: a same-file collision inside one wave lints clean, and
  `spec-run` then dispatches those tasks concurrently, editing the same file.

    1. EVERY incomplete leaf task appears in EXACTLY ONE wave. No duplicates,
       no omissions.
    2. Parent tasks are excluded. Checkpoint tasks are excluded.
    3. Wave ids are integers, contiguous, starting at 0.
    4. Two tasks that touch the SAME FILE must be in DIFFERENT waves. This is
       what makes a wave safely parallelisable.
    5. A task sits in a strictly higher wave than everything it depends on.
    6. Know every path a task creates or modifies before you place it — that is
       what rules 4 and 5 are applied against. The graph records wave membership
       and nothing else.
-->

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "4.1", "4.2"] }
  ]
}
```

## Execution Log

<!--
  Appended by `spec-implement`, one row per attempt — never rewritten, never reordered.
  This is the only part of a spec that can contradict a completion claim. Without it,
  `[x]` is a character an executor wrote about its own work, confirmed by reading the
  character it just wrote.

  Each row's Criteria must be a subset of that task's own `_Requirements:_` trailer —
  claiming a criterion the task does not carry is what a fabricated entry looks like.
  `npx vellum lint` does not check these rows in this version; `npx vellum verify` is what
  contradicts a `[x]`, by requiring the Evidence Entry `npx vellum task complete` records.

  Delete the example row. Keep the header.
-->

| Task | Criteria | Command                                    | Exit | Evidence |
| ---- | -------- | ------------------------------------------ | ---- | -------- |
| 1.1  | 1.1, 1.2 | pnpm turbo run test --filter=@scope/member | 0    | a3f9c21  |

`Evidence` is the commit sha on success. On a failure row it carries the one-line
diagnosis after `no commit — `, so a twice-failed task is distinguishable from one
nobody attempted — otherwise a resume replays the identical failure against a fresh
executor with no memory of the first.

## Notes

### Checkbox states

| Marker | Meaning                                               | Who sets it                                                   |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------- |
| `[ ]`  | Not started                                           | initial state, written by `spec-tasks`                        |
| `[~]`  | Queued — selected for the current wave, not yet begun | the orchestrator (`spec-run`), before dispatching the wave    |
| `[-]`  | In progress                                           | the executing agent, on starting the task                     |
| `[x]`  | Completed                                             | the executing agent, after the task's own verification passes |

The file is the single source of truth for progress. Do not track progress
anywhere else. Write each task on one line; a Markdown formatter (`prettier
--prose-wrap always`, say) may later wrap a long task onto indented continuation
lines. Vellum reads a wrapped task, trailers included, as the one line it was,
and re-wrapping keeps the approval — changing a word does not.

### Optional tasks

A `*` marks a task the plan can ship without: unit tests, property-based tests,
extra fixtures, nice-to-haves. It may sit immediately after the closing bracket
(`- [ ]* 1.3 …`) or after the task id (`- [ ] 1.3* …`); the parser accepts both
and treats them identically. Prefer the second — it is what every example in this
template uses, and it attaches the marker to the thing that is optional.

**A task that cites a Property is never optional.** Property tests verify the
design's Correctness Properties, and `npx vellum verify` fails when a Property
is cited only by optional, undone tasks. Even if a Property test appears to be
"extra verification", omit the `*` marker on any task that carries
`_Properties: N, …_`.

**A top-level task is never optional.** If a whole top-level task could be skipped,
it does not belong in the plan.

Optional tasks are still real work and still carry a `_Requirements:_` trailer.

### Traceability

Every leaf task ends with `_Requirements: <n>.<m>, …_`, referring to numbered
acceptance criteria in `requirements.md`. Numeric references only — no titles, no
quoted criterion text, no links. Union of every leaf trailer must cover every
criterion in `requirements.md`; a criterion no task references is either an
oversight or a documented deferral in `design.md` Open Questions.

A leaf that tests a Correctness Property cites it with a second trailer after the
first: `_Properties: <N>, …_`, the Property numbers from `design.md`. Every
Property must be cited by at least one task: `npx vellum verify` reports each one no
task cites as `PROPERTY_NOT_CITED`, and `npx vellum lint` reports a citation of a
Property `design.md` does not define as `TASK_PROPERTY_UNDEFINED`.

### Checkpoints

A `Checkpoint` task appears every few top-level tasks, and always before a task
that builds on a large batch of prior work. Its body is `Ensure all tests pass`
or a similarly concrete verification. Checkpoints have no sub-tasks, no
`_Requirements:_` trailer, and no entry in the dependency graph. A checkpoint
is still a Required Task: its verification run is recorded with
`npx vellum task complete`, and `npx vellum verify` requires that evidence. A parent task
needs none of its own; it is complete when its required sub-tasks are, or, when all
its sub-tasks are optional, when every one of them is. Vellum sets a parent's marker:
`[-]` when a sub-task starts, `[x]` when it is complete.

### What is NOT in this plan

This plan contains coding tasks only — writing, modifying, and testing code in
this repository. The following are out of scope by rule and must never appear as
tasks:

- user acceptance testing, sign-off sessions, stakeholder demos
- deployment, release, environment provisioning, rollout, feature-flag flips
- gathering performance metrics, load testing in a live environment, benchmarking runs
- manual end-to-end runs, manual QA passes, exploratory testing
- training, onboarding, writing user documentation or runbooks
- business process changes, policy updates, vendor negotiation
- marketing, launch communication, pricing
