---
description: "Task list template (Stackra v2): every task covers spec IDs and names its route"
---

# Tasks: [FEATURE NAME]

**Input**: Design documents from `.agents/specs/sta-n-<slug>/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

## Rules (checked by `pnpm spec:gate tasks <tasks.md>`)

- Line format: `- [ ] T012 [P] [US1] <description> in <path> — covers: FR-003, P-002 — route: spec-task — deps: T010`
  - `T###` ids are unique and permanent; an amendment strikes a task (`~~T012~~ (A-001)`), never renumbers.
  - `covers:` names spec or plan IDs (FR-###, SC-###, EC-##, P-###) that exist; every FR is covered by a task.
  - In a tiered spec (ADR 0502) every task also covers at least one acceptance criterion (AC-###) and names at least
    one file in backticks, and every AC is covered by a task.
  - `route:` is a task type in `.agents/routing.yaml`.
  - `deps:` names earlier tasks; dependencies are acyclic.
  - `[P]` tasks in one phase are a wave: they never share a backticked path.
  - Markers: `[ ]` not started, `[~]` queued, `[-]` in progress, `[x]` done; only `[x]` counts as done.
  - `T012*` marks a task optional: it may stay `[ ]` at Done.
  - A phase may end in a checkpoint, ``- [ ] T013 Checkpoint: `<command>` ``: a required task that runs the command
    and covers nothing; no later phase starts before it is done. It is the last task of its phase and never optional.
- Phases: Setup, Foundational, one per user story (US1…USn), Polish. Each phase heading carries its Linear key once
  `/flow-plan` has filed the tasks (`## Phase 3: US1 … [STA-m]`); task lines carry ` [STA-m]` at the end.
- Tests sit in `__tests__/` beside their subject (ADR 0022) and carry `@covers sta-n:FR-###` (spec-trace).
- Do not keep sample tasks.

## Phase 1: Setup

- [ ] T001 [description] in `path` — covers: FR-001, AC-001 — route: spec-task

## Phase 2: User Story 1 - [Title] (Priority: P1)

**Goal**: [what this story delivers]

**Independent Test**: [how to verify it on its own]

- [ ] T002 [P] [US1] [test first] in `path/__tests__/x.test.ts` — covers: FR-001 — route: tests — deps: T001
- [ ] T003 [US1] [implementation] in `path` — covers: FR-001 — route: spec-task — deps: T002
- [ ] T004* [US1] [optional polish] in `path` — covers: FR-001 — route: spec-task — deps: T003
- [ ] T005 Checkpoint: `pnpm verify`

## Phase N: Polish

- [ ] T0NN [P] Docs listed under Impact "Docs to update" in `apps/docs/src/docs/...` — covers: SC-001 — route: steward-docs
