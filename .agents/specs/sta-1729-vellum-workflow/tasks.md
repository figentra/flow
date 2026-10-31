# Tasks: Vellum runs the whole development workflow

**Spec**: `.agents/specs/sta-1729-vellum-workflow/spec.md` · **Plan**: `plan.md` · **Linear**: STA-1729

Phase 1 is designed and approved; the later phases are placeholders, refined when each phase's design is approved.

## Phase 1: the worktree rule

- [x] T001 Git helpers (main checkout, default branch, worktree list, saved by remote or cherry, reflog idle time, ignored files) in `packages/vellum/src/lib/git.mjs` — covers: FR-1, FR-4, AC-018, AC-019 — route: spec-task
- [x] T002 Workspace list read and write in `packages/vellum/src/lib/workspace.mjs` and `packages/vellum/src/commands/init.mjs` — covers: FR-7, AC-012 — route: spec-task
- [x] T003 `vellum start` in `packages/vellum/src/commands/start.mjs` — covers: FR-1, AC-001, AC-002 — route: spec-task — deps: T001
- [x] T004 `vellum clean` with adopt and fix-ignore in `packages/vellum/src/commands/clean.mjs` — covers: FR-3, FR-4, AC-004, AC-005, AC-006, AC-007, AC-018, AC-019, AC-020, AC-021, AC-022, AC-027 — route: spec-task — deps: T001, T002
- [x] T005 `vellum guard` and its printed settings entry in `packages/vellum/src/commands/guard.mjs` — covers: FR-2, AC-003 — route: spec-task
- [x] T006 The commands on the dispatcher in `packages/vellum/bin/vellum.mjs` — covers: FR-1, FR-2, FR-4, AC-001, AC-003, AC-004 — route: spec-task — deps: T003, T004, T005
- [x] T007 [P] Tests in `packages/vellum/src/__tests__/start.test.mjs`, `packages/vellum/src/__tests__/clean.test.mjs`, `packages/vellum/src/__tests__/guard.test.mjs` and `packages/vellum/src/__tests__/workspace.test.mjs` — covers: FR-1, FR-2, FR-3, FR-4, AC-001, AC-002, AC-003, AC-004, AC-005, AC-006, AC-007, AC-012, AC-018, AC-019, AC-020, AC-021, AC-022 — route: spec-task — deps: T003, T004, T005, T002
- [x] T008 [P] Docs and release note in `packages/vellum/README.md`, `AGENTS.md` and `.changeset/vellum-worktree-rule.md` — covers: FR-1, FR-2, FR-4, AC-001 — route: spec-task — deps: T006
- [x] T009 Vellum ignores its worktrees in `.gitignore` — covers: FR-3, AC-006 — route: spec-task
- [ ] T010 The five other repositories ignore their worktrees in each `.gitignore` (billing, invoicing, brand, stackra/notes, stackra/pro) — covers: FR-3, AC-006 — route: spec-task — deps: T004

## Publish path (W0, leader 2026-10-31: ahead of phase 2)

- [ ] T015 The Release workflow calling Stackra core's Runway npm provider, and the `changeset:version` script, in `.github/workflows/release.yml` and `package.json` — covers: FR-8, AC-013 — route: spec-task

## Phase 2: the gate (design pending)

- [ ] T020 `vellum gate` over `stackra testbed`, posting `vellum/gate` in `packages/vellum/src/commands/gate.mjs` — covers: FR-5, FR-9, AC-008, AC-009 — route: spec-task

## Phase 3: land (design pending)

- [ ] T030 `vellum land` and `--stack` in `packages/vellum/src/commands/land.mjs` — covers: FR-6, AC-010, AC-011, AC-017 — route: spec-task

## Phase 4: status (design pending)

- [ ] T040 `vellum status` in `packages/vellum/src/commands/status.mjs` — covers: FR-7, AC-012 — route: spec-task

## Phase 5: release and ship (design pending)

- [ ] T050 `vellum release` and `vellum ship` in `packages/vellum/src/commands/release.mjs` and `packages/vellum/src/commands/ship.mjs` — covers: FR-8, AC-013, AC-014, AC-015 — route: spec-task

## Phase 6: GitHub switch-over (design pending)

- [ ] T060 Per-PR workflows off and `vellum/gate` required, repository by repository, in `.github/workflows/` — covers: FR-5, AC-016 — route: spec-task

## Phase 7: sessions (design pending)

- [ ] T070 `**Session**` in the spec gate and sessions in `vellum status` in `packages/vellum/src/commands/gate.mjs` and `packages/vellum/src/commands/status.mjs` — covers: FR-10, AC-023, AC-024, AC-025, AC-026 — route: spec-task — deps: T040
