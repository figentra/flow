# Tasks: Figentra Flow runs release trains

**Spec**: `.agents/specs/sta-1746-flow-release-trains/spec.md` · **Plan**: `plan.md` · **Linear**: STA-1746

## Build

- [x] T001 The `train` block in the configuration and its schema in `packages/figentra-flow/src/lib/config.mjs`, `packages/figentra-flow/schema/figentra-flow.config.schema.json` and `figentra-flow.config.json` — covers: FR-9, AC-015, P-004 — route: spec-task
- [x] T002 `gateProblems` and `connect` shared from `land` in `packages/figentra-flow/src/commands/land.mjs` — covers: FR-2, FR-6, AC-003, AC-010 — route: spec-task
- [x] T003 `train open`, `add` and `close` in `packages/figentra-flow/src/commands/train.mjs` — covers: FR-1, FR-2, FR-3, AC-001, AC-002, AC-003, AC-004, AC-005, AC-014, P-001 — route: spec-task — deps: T001, T002
- [x] T004 `train build` with bisect and manual eject, and `train eject`, in `packages/figentra-flow/src/commands/train.mjs` — covers: FR-4, FR-5, AC-006, AC-007, AC-008, AC-009, AC-014, P-002 — route: spec-task — deps: T003
- [x] T005 `train depart` and `train.after` in `packages/figentra-flow/src/commands/train.mjs` — covers: FR-6, FR-7, AC-004, AC-010, AC-011, AC-012, AC-014, P-003 — route: spec-task — deps: T003
- [x] T006 `train status` and the dispatcher in `packages/figentra-flow/src/commands/train.mjs` and `packages/figentra-flow/bin/figentra-flow.mjs` — covers: FR-8, AC-013, P-004 — route: spec-task — deps: T003
- [x] T007 Tests in `packages/figentra-flow/src/__tests__/train.test.mjs` — covers: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, AC-001, AC-002, AC-003, AC-004, AC-005, AC-006, AC-007, AC-008, AC-009, AC-010, AC-011, AC-012, AC-013, AC-014, AC-015 — route: spec-task — deps: T004, T005, T006
- [x] T008 Docs and release note in `packages/figentra-flow/README.md`, `AGENTS.md` and `.changeset/flow-release-trains.md` — covers: FR-9, AC-015 — route: spec-task — deps: T006

## Verify

- [ ] T009 Box gate green on figentra/flow (`pnpm verify`) for `packages/figentra-flow/src/__tests__/train.test.mjs` — covers: FR-9, AC-014 — route: spec-task — deps: T007
- [ ] T010 Dry-run on core with the 0.2.2 items (STA-1739, STA-1740, STA-1727) using `packages/figentra-flow/src/commands/train.mjs` — covers: FR-1, FR-2, AC-001, AC-003, AC-014 — route: spec-task — deps: T009
