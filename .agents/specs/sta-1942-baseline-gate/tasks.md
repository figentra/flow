# Tasks: Figentra Flow's baseline gate lands routine PRs while main is red

**Spec**: `.agents/specs/sta-1942-baseline-gate/spec.md` · **Plan**: `plan.md` · **Linear**: STA-1942

Written on 2026-11-03 (STA-2039) from what shipped in 0.2.2 and 0.2.3; every task below is in the code.

## Build

- [x] T001 The `turbo` reader, `compare`, `summaryTable` and `findBaseline` in `packages/figentra-flow/src/lib/baseline.mjs` — covers: FR-1, FR-3, FR-4, AC-001, AC-003, AC-004, AC-005, AC-006, AC-007, P-001, P-002 — route: spec-task
- [x] T002 `gate baseline save` and `check`, dispatched from `gate`, in `packages/figentra-flow/src/commands/gate-baseline.mjs` and `packages/figentra-flow/src/commands/gate.mjs` — covers: FR-2, FR-3, FR-4, AC-002, AC-003, AC-006, AC-007, P-002 — route: spec-task — deps: T001
- [x] T003 The workflow text, with the setup steps as block YAML (0.2.3), in `packages/figentra-flow/src/lib/baseline-workflow.mjs` — covers: FR-5, FR-6, AC-008, P-003 — route: spec-task — deps: T002
- [x] T004 `baseline` in the configuration and its schema, and the workflow rendered by `sync`, in `packages/figentra-flow/src/lib/config.mjs`, `packages/figentra-flow/schema/flow.config.schema.json` and `packages/figentra-flow/src/lib/render.mjs` — covers: FR-5, AC-008, P-003 — route: spec-task — deps: T003
- [x] T005 The `fflow` rename: the product names, the config file migration, the old workflows removed and the deprecated binary, in `packages/figentra-flow/src/lib/product.mjs`, `packages/figentra-flow/src/lib/render.mjs`, `packages/figentra-flow/bin/fflow.mjs` and `packages/figentra-flow/bin/figentra-flow.mjs` — covers: FR-8, AC-010, AC-011, P-005 — route: spec-task
- [x] T006 Workflow paths stay owner-only, so the Baseline job cannot be rewritten by the PR it judges, in `packages/figentra-flow/src/lib/owner-only.mjs` — covers: FR-6, AC-009, P-004 — route: spec-task

## Verify

- [x] T007 Tests on canned summaries and a stubbed GitHub in `packages/figentra-flow/src/__tests__/baseline.test.mjs` — covers: FR-1, FR-2, FR-3, FR-4, FR-5, FR-7, FR-8, AC-001, AC-002, AC-003, AC-004, AC-005, AC-006, AC-007, AC-008, AC-010, AC-011, P-001, P-002, P-003, P-005 — route: tests — deps: T001, T002, T003, T004, T005
- [x] T008 The owner-only test for workflow paths in `packages/figentra-flow/src/__tests__/stewards.test.mjs` — covers: FR-6, FR-7, AC-009, P-004 — route: tests — deps: T006
- [x] T009 Docs and release notes in `packages/figentra-flow/README.md` and `packages/figentra-flow/CHANGELOG.md` (0.2.2, 0.2.3) — covers: FR-4, AC-007 — route: steward-docs — deps: T007
