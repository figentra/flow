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

## Phase 2: the gate (design approved 2026-10-31)

- [x] T020 `vellum gate run`: refusals, the exported clone, the box command, testbed or `--box`, in `packages/vellum/src/commands/gate-run.mjs` and `packages/vellum/src/lib/git.mjs` — covers: FR-5, FR-9, AC-008, AC-009 — route: spec-task
- [x] T021 The box poster: the App token, the tip check, the `vellum/gate` status, the PR comment, redaction, in `packages/vellum/src/lib/gate-post.mjs` — covers: FR-5, AC-008, AC-009 — route: spec-task
- [x] T022 Tests in `packages/vellum/src/__tests__/gate-run.test.mjs` and `packages/vellum/src/__tests__/gate-post.test.mjs`, the README and a changeset — covers: FR-5, AC-008, AC-009 — route: spec-task — deps: T020, T021
- [x] T023 The tripwire compares the installed preset with Vellum's bundled one when the repository keeps no source, in `packages/vellum/src/commands/gate.mjs` — covers: FR-3, AC-028 — route: spec-task

## Phase 3: land (design approved 2026-10-31)

- [x] T030 `vellum land` and `--stack` in `packages/vellum/src/commands/land.mjs`, `packages/vellum/src/lib/github.mjs` and `packages/vellum/src/commands/clean.mjs` — covers: FR-6, AC-010, AC-011, AC-017, AC-029, AC-030 — route: spec-task
- [x] T031 The ADR 0230 AI review as a land rule, ported from core's `pr-merge.mjs`, in `packages/vellum/src/lib/review.mjs` and `packages/vellum/src/commands/land.mjs` — covers: FR-6, AC-031 — route: spec-task — deps: T030
- [x] T032 GitHub calls only with named credentials (`wrapper:<script>` or `gh-user`), refusing otherwise, in `packages/vellum/src/lib/github.mjs` and `packages/vellum/src/commands/land.mjs` — covers: FR-6, AC-034 — route: spec-task — deps: T030
- [ ] T035 `vellum review`: a different agent from the builder reviews the PR's head and posts the verdict through `pnpm bot:review` (design after land), in `packages/vellum/src/commands/review.mjs` — covers: FR-6, AC-031 — route: spec-task — deps: T031

## Phase A: neutral core with adapters (design approved 2026-10-31)

- [x] T080 The product module, `vellum.config.json` with its schema, the credentials and secrets ports and the deprecation path, in `packages/vellum/src/lib/product.mjs`, `packages/vellum/src/lib/config.mjs` and `packages/vellum/src/adapters/credentials.mjs` — covers: FR-11, AC-035, AC-036, AC-040, AC-042 — route: spec-task
- [x] T086 The artifact guard in `vellum gate run` and `vellum land`, configured by `artifacts` in `vellum.config.json`, in `packages/vellum/src/lib/artifacts.mjs` — covers: FR-11, AC-043 — route: spec-task — deps: T080
- [x] T081 The tracker port: `linear` and `github-issues` adapters with the key scheme, used by start, clean, land and the gate's stage report (Jira later, leader 2026-10-31), in `packages/vellum/src/adapters/tracker/index.mjs`, `packages/vellum/src/adapters/tracker/linear.mjs` and `packages/vellum/src/adapters/tracker/github-issues.mjs` — covers: FR-11, AC-037 — route: spec-task — deps: T080
- [ ] T087 The spec gate, trace and parser read issue keys, branches and folders from the key scheme instead of `sta-` and `figentra/`, in `packages/vellum/src/commands/gate.mjs`, `packages/vellum/src/commands/trace.mjs` and `packages/vellum/src/lib/spec-parse.mjs` — covers: FR-11, AC-037 — route: spec-task — deps: T081
- [ ] T082 The runner port: `ssh`, `local`, `command` and `github-actions` with its workflow, in `packages/vellum/src/adapters/runner/github-actions.mjs` — covers: FR-11, AC-038 — route: spec-task — deps: T080
- [ ] T083 Gate and review identities from the configuration and `vellum app create`, in `packages/vellum/src/adapters/apps.mjs` and `packages/vellum/src/commands/app.mjs` — covers: FR-11, AC-039 — route: spec-task — deps: T080
- [ ] T084 The `neutral` preset and preset selection, in `packages/vellum/assets/presets/neutral/preset.yml` and `packages/vellum/src/commands/sync.mjs` — covers: FR-11, AC-041 — route: spec-task — deps: T080
- [ ] T085 `vellum.config.json` in our repositories (core first), in `vellum.config.json` — covers: FR-11, AC-036 — route: spec-task — deps: T081, T082, T083, T084

## Phase 4: status (design pending)

- [ ] T040 `vellum status` in `packages/vellum/src/commands/status.mjs` — covers: FR-7, AC-012 — route: spec-task

## Phase 5: release and ship (design pending)

- [ ] T050 `vellum release` and `vellum ship` in `packages/vellum/src/commands/release.mjs` and `packages/vellum/src/commands/ship.mjs` — covers: FR-8, AC-013, AC-014, AC-015 — route: spec-task

## Phase 6: GitHub switch-over (design pending)

- [ ] T060 Per-PR workflows off and `vellum/gate` required, repository by repository, in `.github/workflows/` — covers: FR-5, AC-016 — route: spec-task

## Phase 7: sessions (design pending)

- [ ] T070 `**Session**` in the spec gate and sessions in `vellum status` in `packages/vellum/src/commands/gate.mjs` and `packages/vellum/src/commands/status.mjs` — covers: FR-10, AC-023, AC-024, AC-025, AC-026 — route: spec-task — deps: T040
