# Tasks: Figentra Flow keeps worktrees within a budget

**Spec**: `.agents/specs/sta-1871-worktree-hygiene/spec.md` · **Plan**: `plan.md` · **Linear**: STA-1871

Written on 2026-11-03 (STA-2039) from what shipped in 0.2.0; every task below is in the code.

## Build

- [x] T001 The worktree rule in both presets and its rendering by `sync` in `packages/figentra-flow/assets/flow/presets/neutral/rules/worktrees.md`, `packages/figentra-flow/assets/flow/presets/stackra/rules/worktrees.md` and `packages/figentra-flow/src/lib/render.mjs` — covers: FR-1, AC-001, P-001 — route: spec-task
- [x] T002 The worktree folder's README written by `clean` and `init` in `packages/figentra-flow/src/commands/clean.mjs` and `packages/figentra-flow/src/commands/init.mjs` — covers: FR-2, AC-002, P-001 — route: spec-task
- [x] T003 `clean.budget` in the configuration and its schema in `packages/figentra-flow/src/lib/config.mjs` and `packages/figentra-flow/schema/flow.config.schema.json` — covers: FR-3, AC-003 — route: spec-task
- [x] T004 The budget pass: the count, the warning and the candidates, in `packages/figentra-flow/src/commands/clean.mjs` — covers: FR-3, AC-003, P-002 — route: spec-task — deps: T003
- [x] T005 `clean --budget`: preserve on a keep branch, back up ignored files, remove without `--force`, `--dry-run`, in `packages/figentra-flow/src/commands/clean.mjs` — covers: FR-4, AC-004, AC-005, AC-006, P-002, P-003 — route: spec-task — deps: T004
- [x] T006 `doctor`'s budget and disk warnings in `packages/figentra-flow/src/commands/doctor.mjs` — covers: FR-5, AC-007, P-004 — route: spec-task — deps: T004
- [x] T007 Both presets' `git-steward` runs the budget in `packages/figentra-flow/assets/flow/presets/neutral/agents/git-steward.md` and `packages/figentra-flow/assets/flow/presets/stackra/agents/git-steward.md` — covers: FR-6, AC-008, P-005 — route: spec-task — deps: T005

## Verify

- [x] T008 Tests in `packages/figentra-flow/src/__tests__/worktree-budget.test.mjs` — covers: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, AC-001, AC-002, AC-003, AC-004, AC-005, AC-006, AC-007, AC-008, P-001, P-002, P-003, P-004, P-005 — route: tests — deps: T001, T002, T005, T006, T007
- [x] T009 Docs and release note in `packages/figentra-flow/README.md` and `packages/figentra-flow/CHANGELOG.md` (0.2.0) — covers: FR-3, AC-003 — route: steward-docs — deps: T008
