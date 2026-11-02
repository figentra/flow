# Tasks: Figentra Flow lands through a bot approval and auto-merge, with three steward roles

**Spec**: `.agents/specs/sta-1856-merge-stewards/spec.md` · **Plan**: `plan.md` · **Linear**: STA-1856

Written on 2026-11-03 (STA-2039) from what shipped in 0.2.0; every task below is in the code.

## Build

- [x] T001 The owner-only list, the package findings and CODEOWNERS text in `packages/figentra-flow/src/lib/owner-only.mjs` — covers: FR-1, FR-7, AC-001, AC-002, AC-013, P-001 — route: spec-task
- [x] T002 Required checks counted only from their trusted source in `packages/figentra-flow/src/lib/required-checks.mjs` — covers: FR-2, FR-4, AC-004, AC-008, P-002 — route: spec-task
- [x] T003 `land`: the owner-only refusal, the approval dispatch and auto-merge at the head, waiting on running checks, and finishing a merged PR, in `packages/figentra-flow/src/commands/land.mjs` — covers: FR-1, FR-2, FR-3, AC-001, AC-003, AC-004, AC-005, AC-006, AC-007, P-001, P-002, P-003 — route: spec-task — deps: T001, T002
- [x] T004 The approval check in `packages/figentra-flow/src/lib/approve-check.mjs` — covers: FR-4, AC-008, AC-009, AC-010, P-001, P-004 — route: spec-task — deps: T001, T002
- [x] T005 The approval workflow text and its names in `packages/figentra-flow/src/lib/approve-workflow.mjs` and `packages/figentra-flow/src/lib/product.mjs` — covers: FR-4, AC-011 — route: spec-task — deps: T004
- [x] T006 `sync` renders the agents, the workflow and CODEOWNERS (the last two only with `apps.owner`), in `packages/figentra-flow/src/lib/render.mjs` and `packages/figentra-flow/src/lib/config.mjs` — covers: FR-4, FR-5, FR-7, AC-011, AC-012, AC-013, P-005 — route: spec-task — deps: T005
- [x] T007 The stewards in `packages/figentra-flow/assets/flow/presets/neutral/agents/git-steward.md`, `packages/figentra-flow/assets/flow/presets/neutral/agents/ci-steward.md`, `packages/figentra-flow/assets/flow/presets/neutral/agents/tracker-steward.md`, `packages/figentra-flow/assets/flow/presets/stackra/agents/git-steward.md`, `packages/figentra-flow/assets/flow/presets/stackra/agents/ci-steward.md` and `packages/figentra-flow/assets/flow/presets/stackra/agents/linear-steward.md` — covers: FR-5, AC-012, P-005 — route: spec-task

## Verify

- [x] T008 `land` tests in `packages/figentra-flow/src/__tests__/land.test.mjs` — covers: FR-1, FR-2, FR-3, FR-6, AC-001, AC-003, AC-004, AC-005, AC-006, AC-007, P-001, P-002, P-003 — route: tests — deps: T003
- [x] T009 Approval check tests against a stubbed GitHub in `packages/figentra-flow/src/__tests__/approve-check.test.mjs` — covers: FR-4, FR-6, AC-008, AC-009, AC-010, P-001, P-004 — route: tests — deps: T004
- [x] T010 Owner-only, workflow, CODEOWNERS and steward rendering tests in `packages/figentra-flow/src/__tests__/stewards.test.mjs` — covers: FR-1, FR-5, FR-6, FR-7, AC-002, AC-011, AC-012, AC-013, P-001, P-005 — route: tests — deps: T006, T007
- [x] T011 Docs and release note in `packages/figentra-flow/README.md`, `AGENTS.md` and `packages/figentra-flow/CHANGELOG.md` (0.2.0) — covers: FR-2, AC-005 — route: steward-docs — deps: T008
