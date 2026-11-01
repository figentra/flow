---
description: "Task list template: every task covers acceptance criteria and names a file"
---

# Tasks: [FEATURE NAME]

## Rules (checked by `figentra-flow gate tasks <tasks.md>`)

- Line format: `- [ ] T012 [P] <description> in `path` — covers: AC-003 — deps: T010`
  - `T###` ids are unique and permanent; an amendment strikes a task (`~~T012~~`), never renumbers.
  - `covers:` names spec IDs (FR-###, AC-###, SC-###, EC-##) that exist; every FR and every AC is covered by a task.
  - Each task names at least one file in backticks.
  - `deps:` names earlier tasks; dependencies are acyclic.
  - `[P]` tasks in one phase are a wave: they never share a backticked path.
- Do not keep sample tasks.

## Phase 1: Setup

- [ ] T001 [description] in `path` — covers: FR-001, AC-001

## Phase 2: User Story 1 - [Title] (Priority: P1)

- [ ] T002 [P] [test first] in `path` — covers: AC-001 — deps: T001
- [ ] T003 [implementation] in `path` — covers: FR-001 — deps: T002
