# Tasks: fflow owns every repository's agent and tool setup, under a governed preset

**Spec**: `.agents/specs/sta-1945-flow-owns-everything/spec.md` · **Plan**: `plan.md` · **Linear**: STA-1945, STA-2038

**Order**: the waves of `path-to-100.md` (A: PRs 1, 10, 17; B: 2, 3, 19, 20; C: 4, 5, 6, 7; D: 11, 12, 13, 16; E:
14, 18, 15; F: 9; G: 8), then A-4 to A-7's tasks, the proof and the rollout. One phase is one PR; its tasks run in
order, and each is one reviewable change. Every test carries `@covers sta-1945:<id>` for the ids its task covers.

**Ticks**: `[x]` marks a task whose work has merged on main, with the merging PR at the end of its line (#N); a task
built only in part stays `[ ]` (2026-11-04, from the merged PRs #81 to #136). The ticks are hand-set records, not
`task done` evidence (FR-23), which the tester lane adds when it runs the tests.

**Not here**: Phase 1.4 of `path-to-100.md` (baseline "newly reached", os#114) is built outside this spec; PR 16 depends
on it. The owner's stops (Phase 0) and the try-out (Phase 4.3) are the owner's.

## Wave A · PR 1: Governance core

- [x] T001 Lock v2 (`readLock`, `writeLock`, `treeDigest`, `overridesDigest`, `upgradeLock`, `driftOf`, `LockError`) in `packages/figentra-flow/src/lib/lock.mjs` with `packages/figentra-flow/src/__tests__/lock.test.mjs` — covers: FR-2, AC-2, P-004 — route: spec-task — (#87)
- [x] T002 Provenance headers by comment style, none for strict JSON, in `packages/figentra-flow/src/lib/provenance.mjs` with `packages/figentra-flow/src/__tests__/provenance.test.mjs` — covers: FR-3, AC-2, P-006 — route: spec-task — (#87)
- [x] T003 `writeRendered` writes lock v2 and the headers; `installProblems` reads v1 and v2, in `packages/figentra-flow/src/lib/render.mjs` with `packages/figentra-flow/src/__tests__/flow-assets.test.mjs` — covers: FR-2, FR-3, AC-2, P-004, P-006 — route: spec-task — deps: T001, T002 — (#87)
- [x] T004 `sync` refuses a preset whose digest differs from the lock, naming `fflow update`, in `packages/figentra-flow/src/commands/sync.mjs` with `packages/figentra-flow/src/__tests__/sync.test.mjs` — covers: FR-1, FR-2, AC-2, P-002 — route: spec-task — deps: T003 — (#87)
- [x] T005 `fflow check` (owned-file drift with or without a header, preset digest, writes nothing) in `packages/figentra-flow/src/commands/check.mjs` with `packages/figentra-flow/src/__tests__/check.test.mjs` — covers: FR-1, FR-3, AC-1, P-001, P-005 — route: spec-task — deps: T003 — (#87)
- [x] T006 `fflow diff` in `packages/figentra-flow/src/commands/diff.mjs` with `packages/figentra-flow/src/__tests__/diff.test.mjs` — covers: FR-1, AC-1, P-001 — route: spec-task — deps: T003 — (#87)
- [x] T007 `fflow validate` (the config against its schema) in `packages/figentra-flow/src/commands/validate.mjs` with `packages/figentra-flow/src/__tests__/validate.test.mjs` — covers: FR-1, AC-1, P-001 — route: spec-task — (#87)
- [x] T008 `fflow update [--preset <version>]` in `packages/figentra-flow/src/commands/update.mjs` with `packages/figentra-flow/src/__tests__/update.test.mjs` — covers: FR-1, FR-2, AC-2, P-002 — route: spec-task — deps: T004, T006 — (#87)
- [x] T009 `--workspace <dir>` for the five commands in `packages/figentra-flow/src/lib/workspace-run.mjs` with `packages/figentra-flow/src/__tests__/workspace-run.test.mjs` — covers: FR-1, AC-3, P-003 — route: spec-task — deps: T004, T005, T006, T007, T008 — (#87)
- [x] T010 The four commands in the dispatcher and its usage in `packages/figentra-flow/bin/fflow.mjs` with `packages/figentra-flow/src/__tests__/cli.test.mjs` — covers: FR-1, AC-1, AC-3, P-001 — route: spec-task — deps: T009 — (#87)

## Wave A · PR 10: The record and the lifecycle

- [x] T011 Flow's record (`readRecord`, `updateRecord`, `commitRecord`) and its schema in `packages/figentra-flow/src/lib/record.mjs` and `packages/figentra-flow/schema/record.schema.json` with `packages/figentra-flow/src/__tests__/record.test.mjs` — covers: FR-14, AC-13, AC-18, P-019 — route: spec-task — (#88)
- [x] T012 The stage table and `nextStep` in `packages/figentra-flow/src/lib/stages.mjs` with `packages/figentra-flow/src/__tests__/stages.test.mjs` — covers: FR-13, AC-13, P-017 — route: spec-task — deps: T011 — (#88)
- [x] T013 `fflow next` in `packages/figentra-flow/src/commands/next.mjs` with `packages/figentra-flow/src/__tests__/next.test.mjs` — covers: FR-13, AC-13, P-017 — route: spec-task — deps: T012 — (#88)
- [x] T014 `fflow resume` in `packages/figentra-flow/src/commands/resume.mjs` with `packages/figentra-flow/src/__tests__/resume.test.mjs` — covers: FR-13, AC-13, P-017 — route: spec-task — deps: T012 — (#88)
- [x] T015 The stage commands record their stage in `packages/figentra-flow/src/commands/start.mjs`, `packages/figentra-flow/src/commands/spec.mjs`, `packages/figentra-flow/src/commands/gate.mjs`, `packages/figentra-flow/src/commands/land.mjs` and `packages/figentra-flow/src/commands/ship.mjs` — covers: FR-13, FR-14, AC-13, P-019 — route: spec-task — deps: T011 — (#133)
- [ ] T016 `fflow release` opens the version PR, records the owner's ask and dispatches the publish after the Environment approval, in `packages/figentra-flow/src/commands/release.mjs` with `packages/figentra-flow/src/__tests__/release.test.mjs` — covers: FR-13, AC-39, P-036 — route: release — deps: T011
- [x] T017 The stop hook `fflow session stop` (WIP commit, push as the bot, session appended) in `packages/figentra-flow/src/commands/session.mjs` with `packages/figentra-flow/src/__tests__/session.test.mjs` — covers: FR-19, FR-14, AC-18, P-019 — route: spec-task — deps: T011 — (#88)
- [x] T018 The side-door rules (worktree outside `.claude/worktrees/`, push to the default branch, `gh pr merge`, `LEFTHOOK=0`) in `packages/figentra-flow/src/commands/guard.mjs` with `packages/figentra-flow/src/__tests__/guard.test.mjs` — covers: FR-13, AC-38, P-018 — route: spec-task — (#88)
- [x] T019 `next`, `resume` and `session` in the dispatcher in `packages/figentra-flow/bin/fflow.mjs` — covers: FR-13, AC-13 — route: spec-task — deps: T013, T014, T017 — (#88)

## Wave A · PR 17: Markers and evidence

- [x] T020 `parseTasks` reads `[ ] [~] [-] [x]`, optional `T012*` and `Checkpoint:` in `packages/figentra-flow/src/lib/spec-parse.mjs` with `packages/figentra-flow/src/__tests__/spec-parse.test.mjs` — covers: FR-23, FR-25, AC-27, P-028, P-030 — route: spec-task — (#89)
- [x] T021 `gate tasks` and `checkStage` accept optional and checkpoint tasks in `packages/figentra-flow/src/commands/gate.mjs` with `packages/figentra-flow/src/__tests__/gate.test.mjs` — covers: FR-25, AC-27, P-030 — route: spec-task — deps: T020 — (#89)
- [x] T022 Evidence (`runEvidence`, `secretLooking`) in `packages/figentra-flow/src/lib/evidence.mjs` with `packages/figentra-flow/src/__tests__/evidence.test.mjs` — covers: FR-23, AC-23, P-028 — route: spec-task — (#89)
- [x] T023 `fflow task start` and `task done` in `packages/figentra-flow/src/commands/task.mjs` with `packages/figentra-flow/src/__tests__/task.test.mjs` — covers: FR-23, AC-23, AC-24, P-028 — route: spec-task — deps: T011, T020, T022 — (#89)
- [x] T024 `check` refuses a hand tick and resets a task whose documents changed in `packages/figentra-flow/src/commands/check.mjs` with `packages/figentra-flow/src/__tests__/check.test.mjs` — covers: FR-23, AC-22, AC-24, P-028 — route: spec-task — deps: T005, T023 — (#133)
- [x] T025 `trace` and `status` count evidence, and `status` lists skipped optional tasks, in `packages/figentra-flow/src/commands/trace.mjs` and `packages/figentra-flow/src/lib/snapshot.mjs` with `packages/figentra-flow/src/__tests__/trace.test.mjs` — covers: FR-23, FR-25, AC-27, P-028, P-030 — route: spec-task — deps: T023 — (#89)
- [x] T026 The tasks template's markers, optional and checkpoint tasks in `packages/figentra-flow/assets/flow/presets/stackra/templates/tasks-template.md` and `packages/figentra-flow/assets/flow/presets/neutral/templates/tasks-template.md` — covers: FR-25, AC-27, P-030 — route: spec-task — deps: T021 — (#89)
- [x] T027 `task` in the dispatcher in `packages/figentra-flow/bin/fflow.mjs` — covers: FR-23, AC-23 — route: spec-task — deps: T023 — (#89)

## Wave B · PR 2: Overrides and policies

- [x] T028 The override schema and loader (four kinds, review dates, legacy whole-file read as `replace`) in `packages/figentra-flow/src/lib/overrides.mjs` and `packages/figentra-flow/schema/override.schema.json` with `packages/figentra-flow/src/__tests__/overrides.test.mjs` — covers: FR-4, AC-4, P-007 — route: spec-task — deps: T003 — (#115)
- [x] T029 Render applies overrides and the header names the override in `packages/figentra-flow/src/lib/render.mjs` with `packages/figentra-flow/src/__tests__/flow-assets.test.mjs` — covers: FR-4, FR-3, AC-4, P-007, P-006 — route: spec-task — deps: T028 — (#115)
- [x] T030 Mandatory policies and the tighten-only rule in `packages/figentra-flow/src/lib/policies.mjs` with `packages/figentra-flow/src/__tests__/policies.test.mjs` — covers: FR-5, AC-5, P-008 — route: spec-task — deps: T028 — (#115)
- [x] T031 `validate` refuses bad and policy-breaking overrides in `packages/figentra-flow/src/commands/validate.mjs` with `packages/figentra-flow/src/__tests__/validate.test.mjs` — covers: FR-4, FR-5, AC-4, AC-5, P-007, P-008 — route: spec-task — deps: T007, T030 — (#115)
- [x] T032 `check` warns 14 days before a review date and fails after it, and fails on a policy that is off, in `packages/figentra-flow/src/commands/check.mjs` with `packages/figentra-flow/src/__tests__/check.test.mjs` — covers: FR-4, FR-5, AC-1, AC-4, P-007 — route: spec-task — deps: T024, T030 — (#115)
- [x] T033 `.flow/overrides/**` joins the owner-only paths and CODEOWNERS in `packages/figentra-flow/src/lib/owner-only.mjs` with `packages/figentra-flow/src/__tests__/owner-only.test.mjs` — covers: FR-4, AC-4, P-007 — route: spec-task — (#115)

## Wave B · PR 3: Profiles

- [x] T034 `resolveProfile` and `selects` in `packages/figentra-flow/src/lib/profiles.mjs` with `packages/figentra-flow/src/__tests__/profiles.test.mjs` — covers: FR-6, AC-6, P-009 — route: spec-task — (#114)
- [x] T035 Profiles in both presets (stackra per D3, neutral `default`) in `packages/figentra-flow/assets/flow/presets/stackra/preset.yml` and `packages/figentra-flow/assets/flow/presets/neutral/preset.yml` — covers: FR-6, AC-6, P-009 — route: spec-task — deps: T034 — (#114)
- [x] T036 The config's `profile` in `packages/figentra-flow/src/lib/config.mjs` and `packages/figentra-flow/schema/flow.config.schema.json` with `packages/figentra-flow/src/__tests__/config.test.mjs` — covers: FR-6, AC-6, P-009 — route: spec-task — (#114)
- [x] T037 Render selects by profile and the lock records it in `packages/figentra-flow/src/lib/render.mjs` with `packages/figentra-flow/src/__tests__/profiles.test.mjs` — covers: FR-6, FR-2, AC-6, AC-2, P-009 — route: spec-task — deps: T029, T034, T036 — (#114)

## Wave B · PR 19: Templates

- [x] T038 The spec template's Discovery and Sources, measurable success, non-functional EARS lines, the small tier's one-page design with tree and interfaces, and worked examples, in `packages/figentra-flow/assets/flow/presets/stackra/templates/spec-template.md` and `packages/figentra-flow/assets/flow/presets/neutral/templates/spec-template.md` — covers: FR-26, FR-27, AC-43, P-031 — route: spec-task — (#93)
- [x] T039 The plan template's trade-off, research, standards table, diagrams, per-component tree, interfaces, behaviour and failure modes, partial-failure ordering and open questions, in `packages/figentra-flow/assets/flow/presets/stackra/templates/plan-template.md` and `packages/figentra-flow/assets/flow/presets/neutral/templates/plan-template.md` — covers: FR-27, AC-43, P-031 — route: spec-task — (#93)
- [x] T040 `/flow-specify` asks for Discovery and Sources in `packages/figentra-flow/assets/flow/presets/stackra/commands/flow-specify.md` and `packages/figentra-flow/assets/flow/presets/neutral/commands/flow-specify.md` — covers: FR-26, AC-43, P-031 — route: spec-task — deps: T038 — (#93)
- [x] T041 The asset test asserts each template's sections per tier in `packages/figentra-flow/src/__tests__/flow-assets.test.mjs` — covers: FR-26, FR-27, AC-43, P-031 — route: tests — deps: T038, T039 — (#93)

## Wave B · PR 20: Document gates

- [x] T042 Placeholder and open-question refusal at an approval stop in `packages/figentra-flow/src/commands/gate.mjs` with `packages/figentra-flow/src/__tests__/gate.test.mjs` — covers: FR-28, AC-30, P-032 — route: spec-task — deps: T021 — (#97)
- [x] T043 Sources required at Clarified (`checkSources`) in `packages/figentra-flow/src/commands/gate.mjs` with `packages/figentra-flow/src/__tests__/gate.test.mjs` — covers: FR-26, AC-28, P-032 — route: spec-task — deps: T042 — (#97)
- [x] T044 Each plan component's folder tree and interfaces (`checkComponents`) in `packages/figentra-flow/src/commands/gate.mjs` with `packages/figentra-flow/src/__tests__/gate.test.mjs` — covers: FR-27, AC-29, P-032 — route: spec-task — deps: T043 — (#97)
- [x] T045 The vague-word lists and `checkVague` in `packages/figentra-flow/assets/flow/presets/stackra/quality-words.yml`, `packages/figentra-flow/assets/flow/presets/neutral/quality-words.yml` and `packages/figentra-flow/src/commands/gate.mjs` — covers: FR-29, AC-31, P-033 — route: spec-task — deps: T044 — (#97)
- [x] T046 Scope drift in `gate ci` in `packages/figentra-flow/src/lib/scope-drift.mjs` with `packages/figentra-flow/src/__tests__/scope-drift.test.mjs` — covers: FR-30, AC-32, P-034 — route: spec-task — deps: T020 — (#97)
- [x] T047 Contract drift in `trace` in `packages/figentra-flow/src/lib/contract-drift.mjs` and `packages/figentra-flow/src/commands/trace.mjs` with `packages/figentra-flow/src/__tests__/contract-drift.test.mjs` — covers: FR-30, AC-33, P-034 — route: spec-task — deps: T025 — (#134)
- [x] T048 Content-bound approvals: the approval records its document digest, and an edit re-opens the stage, in `packages/figentra-flow/src/lib/record.mjs` and `packages/figentra-flow/src/commands/check.mjs` with `packages/figentra-flow/src/__tests__/check.test.mjs` — covers: FR-30, FR-23, AC-34, P-034 — route: spec-task — deps: T011, T032 — (#133)
- [x] T049 Wire scope drift into `gate ci` in `packages/figentra-flow/src/commands/gate.mjs` with `packages/figentra-flow/src/__tests__/gate.test.mjs` — covers: FR-30, AC-32, P-034 — route: spec-task — deps: T045, T046 — (#97)
- [x] T128 A small spec's one-page design keeps its folder tree and interfaces from Planned (`checkSmallDesign`) in `packages/figentra-flow/src/commands/gate.mjs` with `packages/figentra-flow/src/__tests__/gate.test.mjs` and `packages/figentra-flow/src/__tests__/flow-assets.test.mjs` — covers: FR-27, AC-29, P-032 — route: spec-task — deps: T044 — (#109)
- [x] T129 Each task names only files of the plan's folder trees, or of a small spec's design (`checkTaskTrees`, in `gate tasks` and from Tasked), failing big and warning otherwise, in `packages/figentra-flow/src/lib/scope-drift.mjs` and `packages/figentra-flow/src/commands/gate.mjs` with `packages/figentra-flow/src/__tests__/scope-drift.test.mjs` and `packages/figentra-flow/src/__tests__/gate.test.mjs` — covers: FR-30, AC-32, P-034 — route: spec-task — deps: T049, T128 — (#109)

## Wave C · PR 4: The guard engine (R3)

- [x] T050 Shell words and hook IO, ported, in `packages/figentra-flow/src/guard/words.mjs` and `packages/figentra-flow/src/guard/io.mjs` — covers: FR-7, AC-9, P-012 — route: spec-task — (#98)
- [x] T051 Event dispatch and table loading (`decide`, `main`, `loadTables`) in `packages/figentra-flow/src/guard/engine.mjs` and `packages/figentra-flow/src/guard/tables.mjs` — covers: FR-7, FR-5, AC-9, P-012 — route: spec-task — deps: T050, T034 — (#98)
- [x] T052 Bash rules and core's bash and inbox tables in `packages/figentra-flow/src/guard/bash.mjs`, `packages/figentra-flow/assets/flow/presets/stackra/guard/bash-rules.mjs` and `packages/figentra-flow/assets/flow/presets/stackra/guard/inbox.mjs` with `packages/figentra-flow/src/__tests__/guard-bash.test.mjs` — covers: FR-7, FR-11, AC-9, P-012 — route: spec-task — deps: T051 — (#98)
- [x] T053 Path rules and core's path table in `packages/figentra-flow/src/guard/paths.mjs` and `packages/figentra-flow/assets/flow/presets/stackra/guard/path-rules.mjs` with `packages/figentra-flow/src/__tests__/guard-paths.test.mjs` — covers: FR-7, FR-11, AC-9, P-012 — route: spec-task — deps: T051 — (#98)
- [x] T054 The plan gate in `packages/figentra-flow/src/guard/plan-gate.mjs` with `packages/figentra-flow/src/__tests__/plan-gate.test.mjs` — covers: FR-7, FR-11, AC-9, P-012 — route: spec-task — deps: T051 — (#98)
- [x] T055 Session context in `packages/figentra-flow/src/guard/session-context.mjs` with `packages/figentra-flow/src/__tests__/session-context.test.mjs` — covers: FR-7, AC-9, P-012 — route: spec-task — deps: T051 — (#98)
- [x] T056 Post-write checks in `packages/figentra-flow/src/guard/post-write.mjs` with `packages/figentra-flow/src/__tests__/post-write-checks.test.mjs` — covers: FR-7, FR-11, AC-9, P-012 — route: spec-task — deps: T051 — (#98)
- [x] T057 Prompt hints and reviewer agents in `packages/figentra-flow/src/guard/prompt-hints.mjs`, `packages/figentra-flow/assets/flow/presets/stackra/guard/hints.mjs` and `packages/figentra-flow/assets/flow/presets/stackra/guard/reviewer-agents.mjs` with `packages/figentra-flow/src/__tests__/prompt-hints.test.mjs` — covers: FR-7, FR-11, AC-9, P-012 — route: spec-task — deps: T051 — (#98)
- [x] T058 The neutral preset's guard tables (worktree, side doors, generic secrets) in `packages/figentra-flow/assets/flow/presets/neutral/guard/bash-rules.mjs` and `packages/figentra-flow/assets/flow/presets/neutral/guard/path-rules.mjs` — covers: FR-7, FR-13, AC-38, P-018 — route: spec-task — deps: T052, T053 — (#98)
- [x] T059 The differential test over the ported corpus in `packages/figentra-flow/src/__tests__/guard-differential.test.mjs` — covers: FR-7, FR-11, AC-9, P-012 — route: tests — deps: T052, T053, T054, T055, T056, T057 — (#98)
- [x] T060 The hook entry, and `fflow guard` delegating to the engine with the side doors as engine rules, in `packages/figentra-flow/bin/fflow-guard.mjs` and `packages/figentra-flow/src/commands/guard.mjs` with `packages/figentra-flow/src/__tests__/guard.test.mjs` — covers: FR-7, FR-13, AC-9, AC-38, P-012, P-018 — route: spec-task — deps: T018, T058, T059 — (#98)

## Wave C · PR 5: Surfaces

- [x] T061 `.claude/settings.json` (guard via `node`, the Stop hook) in `packages/figentra-flow/src/lib/render-settings.mjs` and `packages/figentra-flow/assets/flow/presets/stackra/surfaces/settings.json` with `packages/figentra-flow/src/__tests__/render-settings.test.mjs` — covers: FR-7, FR-19, AC-7, AC-18, P-010 — route: spec-task — deps: T060, T017 — (#135)
- [x] T062 The OpenCode projection and guard plugin in `packages/figentra-flow/src/lib/render-opencode.mjs`, `packages/figentra-flow/assets/flow/presets/stackra/surfaces/opencode.jsonc` and `packages/figentra-flow/assets/flow/presets/stackra/surfaces/opencode/plugins/fflow-guard.mjs` with `packages/figentra-flow/src/__tests__/render-opencode.test.mjs` — covers: FR-7, AC-7, P-010 — route: spec-task — deps: T060 — (#135)
- [x] T063 `.mcp.yaml` from the preset's servers plus the config's, secrets by name, in `packages/figentra-flow/src/lib/render-mcp.mjs` and `packages/figentra-flow/assets/flow/presets/stackra/surfaces/mcp.yaml` with `packages/figentra-flow/src/__tests__/render-mcp.test.mjs` — covers: FR-7, AC-7, P-010 — route: spec-task — (#112)
- [x] T064 `lefthook.yml` mise first with `--no-error-on-unmatched-pattern` (all ignored passes, exit 2 on a parse error fails), and `pinTools` for `mise.toml`, in `packages/figentra-flow/src/lib/render-lefthook.mjs` and `packages/figentra-flow/assets/flow/presets/stackra/surfaces/lefthook.yml` with `packages/figentra-flow/src/__tests__/render-lefthook.test.mjs` — covers: FR-7, AC-8, P-011 — route: spec-task — (#112, #113)
- [x] T065 The lefthook skips (commitlint absent, pre-push on the registry 401 only, oxlint without the workspace install) in `packages/figentra-flow/src/lib/render-lefthook.mjs` with `packages/figentra-flow/src/__tests__/render-lefthook.test.mjs` — covers: FR-7, AC-8, P-011 — route: spec-task — deps: T064 — (#112)
- [x] T066 AGENTS.md and CLAUDE.md from shared blocks plus the repository's facts in `packages/figentra-flow/src/lib/render-agents-md.mjs` and `packages/figentra-flow/assets/flow/presets/stackra/surfaces/agents-md/agents.md` with `packages/figentra-flow/src/__tests__/render-agents-md.test.mjs` — covers: FR-7, AC-7, P-010 — route: spec-task — (#112)
- [x] T067 The neutral preset's surfaces in `packages/figentra-flow/assets/flow/presets/neutral/surfaces/settings.json` and `packages/figentra-flow/assets/flow/presets/neutral/surfaces/lefthook.yml` — covers: FR-7, AC-7, P-010 — route: spec-task — deps: T061, T064 — (#135)
- [x] T068 Render calls the surfaces, deletes dropped owned files and never touches `.agents/specs/`; the config gains `mcp`, `lefthook`, `agentsMd`; in `packages/figentra-flow/src/lib/render.mjs`, `packages/figentra-flow/src/lib/config.mjs` and `packages/figentra-flow/schema/flow.config.schema.json` — covers: FR-7, AC-7, P-010 — route: spec-task — deps: T037, T061, T062, T063, T065, T066, T067 — (#135)

## Wave C · PR 6: Core's content into the preset

- [x] T069 Core's 28 role agents in `packages/figentra-flow/assets/flow/presets/stackra/agents/` — covers: FR-7, AC-7, P-010 — route: spec-task — deps: T068 — (#100)
- [x] T070 Core's 48 skills, shipped in the preset (D2), in `packages/figentra-flow/assets/flow/presets/stackra/skills/` — covers: FR-12, AC-7, P-010 — route: spec-task — deps: T068 — (#100)
- [x] T071 Core's 15 rules, 29 reference docs, routing and models in `packages/figentra-flow/assets/flow/presets/stackra/rules/`, `packages/figentra-flow/assets/flow/presets/stackra/reference/`, `packages/figentra-flow/assets/flow/presets/stackra/routing.yaml` and `packages/figentra-flow/assets/flow/presets/stackra/models.yaml` — covers: FR-7, AC-7, P-010 — route: spec-task — deps: T068 — (#100)
- [x] T072 `renderReference` for reference, routing and models in `packages/figentra-flow/src/lib/render.mjs` — covers: FR-7, AC-7, P-010 — route: spec-task — deps: T071 — (#100)
- [ ] T073 The profile splits of core's content, and the tarball size stated in the PR, in `packages/figentra-flow/assets/flow/presets/stackra/preset.yml` — covers: FR-6, FR-12, AC-6, AC-7, P-009 — route: spec-task — deps: T069, T070, T071
- [x] T074 Every profile renders, with the expected counts, in `packages/figentra-flow/src/__tests__/preset-content.test.mjs` — covers: FR-11, FR-12, AC-7, P-010, P-016 — route: tests — deps: T072, T073 — (#100)

## Wave C · PR 7: Third-party skills and doctor

- [x] T075 Licence check, install into a temp folder, digest pin and `machineOnlyProblems` in `packages/figentra-flow/src/lib/skills.mjs` with `packages/figentra-flow/src/__tests__/skills.test.mjs` — covers: FR-8, FR-11, AC-10, P-013 — route: spec-task — deps: T001 — (#111)
- [x] T076 FR-8's list with D1's `machineOnly` marks in `packages/figentra-flow/assets/flow/presets/stackra/third-party.yml` — covers: FR-8, AC-10, P-013 — route: spec-task — deps: T075 — (#111)
- [x] T077 `sync` installs into the git-ignored `.agents/skills/.vendor/` and locks `skills`, in `packages/figentra-flow/src/lib/render.mjs` — covers: FR-8, FR-2, AC-10, P-013 — route: spec-task — deps: T072, T075 — (#111)
- [x] T078 `check` refuses a committed machine-only skill in `packages/figentra-flow/src/commands/check.mjs` with `packages/figentra-flow/src/__tests__/check.test.mjs` — covers: FR-8, AC-10, P-013 — route: spec-task — deps: T048, T075 — (#111)
- [x] T079 `doctor` lists machine-only skills with their source in `packages/figentra-flow/src/commands/doctor.mjs` with `packages/figentra-flow/src/__tests__/doctor.test.mjs` — covers: FR-8, AC-10, P-013 — route: spec-task — deps: T076 — (#111)

## Wave D · PR 11: Stacks

- [x] T080 `mergeUp` with the parent-identical resolution in `packages/figentra-flow/src/lib/stack.mjs` with `packages/figentra-flow/src/__tests__/stack.test.mjs` — covers: FR-16, AC-14, P-022 — route: spec-task — (#82)
- [ ] T081 `fflow stack add|show|up` (record the chain, merge up, retarget, continue) in `packages/figentra-flow/src/commands/stack.mjs` and `packages/figentra-flow/bin/fflow.mjs` — covers: FR-16, AC-14, P-022 — route: spec-task — deps: T080, T011
- [ ] T082 `land --stack` lands the top PR with the combined change and closes the rest in `packages/figentra-flow/src/commands/land.mjs` with `packages/figentra-flow/src/__tests__/land.test.mjs` — covers: FR-16, AC-14, P-022 — route: spec-task — deps: T080, T015

## Wave D · PR 12: Queues

- [x] T083 The queue lock (`withQueueLock`, stale after 15 minutes, released in `finally`) in `packages/figentra-flow/src/lib/queue.mjs` with `packages/figentra-flow/src/__tests__/queue.test.mjs` — covers: FR-17, AC-15, P-023 — route: spec-task — (#102)
- [x] T084 `fflow adr reserve` returning the number only once it is on the default branch, with the presets' `queues:`, in `packages/figentra-flow/src/commands/adr.mjs`, `packages/figentra-flow/assets/flow/presets/stackra/preset.yml` and `packages/figentra-flow/bin/fflow.mjs` with `packages/figentra-flow/src/__tests__/adr.test.mjs` — covers: FR-17, AC-15, P-023 — route: spec-task — deps: T083, T073 — (#102)

## Wave D · PR 13: Hooks on the testbed

- [x] T085 `canRunLocally`, `runHooks` on a box for the staged tree, and the `Hooks-Run:` trailer in `packages/figentra-flow/src/lib/hooks-run.mjs` with `packages/figentra-flow/src/__tests__/hooks-run.test.mjs` — covers: FR-18, AC-16, P-024 — route: spec-task — (#103)
- [x] T086 `fflow hooks run <stage>` in `packages/figentra-flow/src/commands/hooks.mjs` and `packages/figentra-flow/bin/fflow.mjs` — covers: FR-18, AC-16, P-024 — route: spec-task — deps: T085 — (#103)
- [ ] T087 lefthook's jobs run through `fflow hooks run` in `packages/figentra-flow/src/lib/render-lefthook.mjs` with `packages/figentra-flow/src/__tests__/render-lefthook.test.mjs` — covers: FR-18, FR-7, AC-16, AC-8, P-024 — route: spec-task — deps: T065, T086
- [ ] T088 `gate ci` refuses a commit with neither local hooks nor the trailer in `packages/figentra-flow/src/commands/gate.mjs` with `packages/figentra-flow/src/__tests__/gate.test.mjs` — covers: FR-18, AC-16, P-024 — route: spec-task — deps: T049, T085

## Wave D · PR 16: The baseline-aware merge bot

- [ ] T089 The gate posts the baseline comparison on a red main, newly reached listed, in `packages/figentra-flow/src/commands/gate-run.mjs` with `packages/figentra-flow/src/__tests__/gate-run.test.mjs` — covers: FR-22, AC-17, P-027 — route: spec-task
- [ ] T090 `land` merges on a baseline-green gate and refuses a new failure in `packages/figentra-flow/src/commands/land.mjs` with `packages/figentra-flow/src/__tests__/land.test.mjs` — covers: FR-22, AC-17, P-027 — route: spec-task — deps: T082, T089

## Wave E · PR 14: Stage workflows

- [x] T091 `fflow plan <key> --input | --record` with the size budget and coverage check in `packages/figentra-flow/src/commands/plan.mjs` with `packages/figentra-flow/src/__tests__/plan.test.mjs` — covers: FR-15, AC-21, P-020 — route: spec-task — deps: T021, T011 — (#104)
- [x] T092 The plan workflow writes tasks.md; `flow-tasks` removed from VERBS, in `packages/figentra-flow/assets/flow/presets/stackra/commands/flow-plan.md`, `packages/figentra-flow/assets/flow/presets/neutral/commands/flow-plan.md` and `packages/figentra-flow/src/lib/render.mjs` — covers: FR-15, AC-21, P-020 — route: spec-task — deps: T091, T077 — (#104)
- [x] T093 `fflow review <pr> --input | --record` in `packages/figentra-flow/src/commands/review.mjs` with `packages/figentra-flow/src/__tests__/review.test.mjs` — covers: FR-15, AC-40, P-021 — route: spec-task — deps: T011 — (#104)
- [x] T094 The review workflow (four parallel reviewers, a verifier per finding) in `packages/figentra-flow/assets/flow/presets/stackra/commands/flow-review.md` and `packages/figentra-flow/assets/flow/presets/neutral/commands/flow-review.md` — covers: FR-15, AC-40, P-021 — route: spec-task — deps: T093 — (#104)
- [x] T095 `land` refuses a PR with a confirmed blocking finding in `packages/figentra-flow/src/commands/land.mjs` with `packages/figentra-flow/src/__tests__/land.test.mjs` — covers: FR-15, AC-40, P-021 — route: spec-task — deps: T090, T093 — (#104)
- [x] T096 Package shards and one `fflow/gate` status across boxes in `packages/figentra-flow/src/lib/shards.mjs` and `packages/figentra-flow/src/commands/gate-run.mjs` with `packages/figentra-flow/src/__tests__/shards.test.mjs` — covers: FR-15, AC-41, P-021 — route: spec-task — deps: T089 — (#104)
- [x] T097 The gate fan-out workflow in `packages/figentra-flow/assets/flow/presets/stackra/commands/flow-gate.md` and `packages/figentra-flow/assets/flow/presets/neutral/commands/flow-gate.md` — covers: FR-15, AC-41, P-021 — route: spec-task — deps: T096 — (#104)
- [x] T098 `plan` and `review` in the dispatcher in `packages/figentra-flow/bin/fflow.mjs` — covers: FR-15, AC-21, AC-40 — route: spec-task — deps: T091, T093 — (#104)

## Wave E · PR 18: Waves and the parallel build

- [x] T099 `waves` and `nextWave` in `packages/figentra-flow/src/lib/waves.mjs` with `packages/figentra-flow/src/__tests__/waves.test.mjs` — covers: FR-24, FR-25, AC-25, P-029, P-030 — route: spec-task — deps: T020 — (#105)
- [ ] T100 `fflow plan` writes the wave graph in `packages/figentra-flow/src/commands/plan.mjs` with `packages/figentra-flow/src/__tests__/plan.test.mjs`, deferred until T091 (PR 14) has added the command — covers: FR-24, AC-25, P-029 — route: spec-task — deps: T091, T099
- [x] T101 `fflow task wave <key>` in `packages/figentra-flow/src/commands/task.mjs` with `packages/figentra-flow/src/__tests__/task.test.mjs` — covers: FR-24, AC-25, P-029 — route: spec-task — deps: T023, T099 — (#105)
- [x] T102 The build workflow (at most 5 subagents, stop at the wave boundary) in `packages/figentra-flow/assets/flow/presets/stackra/commands/flow-build.md` and `packages/figentra-flow/assets/flow/presets/neutral/commands/flow-build.md` — covers: FR-24, AC-25, P-029 — route: spec-task — deps: T101 — (#105)
- [x] T103 `next` and `resume` restart a wave at its first unfinished task in `packages/figentra-flow/src/lib/stages.mjs` and `packages/figentra-flow/src/commands/resume.mjs` with `packages/figentra-flow/src/__tests__/resume.test.mjs` — covers: FR-24, FR-13, AC-26, P-029, P-017 — route: spec-task — deps: T014, T099 — (#105)

## Wave E · PR 15: Sessions, to-do and ledger

- [x] T104 `liveSessions` and `nameProblem` (Flow ADR 0001) in `packages/figentra-flow/src/lib/sessions.mjs` with `packages/figentra-flow/src/__tests__/sessions.test.mjs` — covers: FR-20, AC-19, P-025 — route: spec-task — (#106)
- [x] T105 `status` shows live sessions by name, state, worktree and stage, and warns, in `packages/figentra-flow/src/lib/snapshot.mjs` and `packages/figentra-flow/src/commands/status.mjs` with `packages/figentra-flow/src/__tests__/status.test.mjs` — covers: FR-20, AC-19, P-025 — route: spec-task — deps: T025, T104 — (#106)
- [x] T106 `allRecords` across branches and the workspace in `packages/figentra-flow/src/lib/records.mjs` with `packages/figentra-flow/src/__tests__/records.test.mjs` — covers: FR-21, AC-20, AC-42, P-026 — route: spec-task — deps: T011 — (#106)
- [x] T107 `fflow todo` in `packages/figentra-flow/src/commands/todo.mjs` with `packages/figentra-flow/src/__tests__/todo.test.mjs` — covers: FR-21, AC-20, P-026 — route: spec-task — deps: T106, T016 — (#106)
- [x] T108 `fflow ledger [--since <date>]` in `packages/figentra-flow/src/commands/ledger.mjs` with `packages/figentra-flow/src/__tests__/ledger.test.mjs` — covers: FR-21, AC-42, P-026 — route: spec-task — deps: T106 — (#106)
- [x] T109 `todo` and `ledger` in the dispatcher in `packages/figentra-flow/bin/fflow.mjs` — covers: FR-21, AC-20, AC-42 — route: spec-task — deps: T107, T108 — (#106)

## Wave F · PR 9: The CLI on the console engine

- [x] T110 Tables, checklist, error block, `--json`, the plain renderer and `@stackra/console` (a runtime dependency, NFR-1) in `packages/figentra-flow/src/lib/output.mjs` and `packages/figentra-flow/package.json` with `packages/figentra-flow/src/__tests__/output.test.mjs` — covers: FR-31, AC-35, AC-37, P-035 — route: spec-task — (#90)
- [x] T111 Banner, grouped commands, `--help` that runs nothing, the closest-match suggestion in `packages/figentra-flow/src/lib/help.mjs` and `packages/figentra-flow/bin/fflow.mjs` with `packages/figentra-flow/src/__tests__/help.test.mjs` — covers: FR-31, AC-36, P-035 — route: spec-task — deps: T110 — (#90)
- [ ] T112 Every command's failure through the error block, the repository checked first, raw output only under `--verbose`, in `packages/figentra-flow/src/lib/cli.mjs` with `packages/figentra-flow/src/__tests__/cli.test.mjs` — covers: FR-31, AC-35, P-035 — route: spec-task — deps: T110
- [x] T113 `doctor` as the grouped checklist with its summary line and `--json` in `packages/figentra-flow/src/commands/doctor.mjs` with `packages/figentra-flow/src/__tests__/doctor.test.mjs` — covers: FR-31, AC-37, P-035 — route: spec-task — deps: T079, T110 — (#90)
- [x] T114 `status` tables, every problem under `--verbose`, and `--json` in `packages/figentra-flow/src/commands/status.mjs` with `packages/figentra-flow/src/__tests__/status.test.mjs` — covers: FR-31, AC-37, P-035 — route: spec-task — deps: T105, T110 — (#90)
- [x] T115 `init` writes a starter config and syncs; `spec paths` and `gate dir` fall back to the branch slug's folder; `spec --json`; in `packages/figentra-flow/src/commands/init.mjs`, `packages/figentra-flow/src/commands/spec.mjs` and `packages/figentra-flow/src/commands/gate.mjs` with `packages/figentra-flow/src/__tests__/init.test.mjs` — covers: FR-31, AC-37, P-035 — route: spec-task — deps: T088, T110 — (#90)

## Wave G · PR 8: Divergence report and the docs

- [x] T116 `divergence` and `status --divergence` in `packages/figentra-flow/src/lib/divergence.mjs` and `packages/figentra-flow/src/commands/status.mjs` with `packages/figentra-flow/src/__tests__/divergence.test.mjs` — covers: FR-9, AC-11, P-014 — route: spec-task — deps: T114 — (#134)
- [ ] T117 The Flow ADR for the governance model (lock, provenance, overrides, mandatory policies) in `docs/adr/0002-governed-preset.md` — covers: FR-2, FR-3, FR-4, FR-5, AC-4, AC-5 — route: adr
- [ ] T118 README, AGENTS.md and the preset docs, with the migration steps, in `packages/figentra-flow/README.md` and `AGENTS.md` — covers: FR-10, AC-12, P-015 — route: steward-docs — deps: T116
- [ ] T119 The 0.3.0 changeset made final in `.changeset/flow-0-3-0.md` — covers: FR-10, AC-12, P-015 — route: steward-changesets — deps: T118

## Amendment A-4: the L2 lane (ADR 0523)

- [x] T130 The AI verdict accepted from a list of reviewer Apps, an edited verdict void, in `packages/figentra-flow/src/lib/review.mjs` with `packages/figentra-flow/src/__tests__/review.test.mjs` — covers: FR-34, AC-47 — route: spec-task — (#116)
- [x] T131 The narrowed Flow App token minted in process over OIDC (`mint`, `checkRef`, `withToken`, `ROLES`) and the config's `secrets.oidc`, in `packages/figentra-flow/src/lib/app-token.mjs`, `packages/figentra-flow/src/lib/config.mjs` and `packages/figentra-flow/schema/flow.config.schema.json` with `packages/figentra-flow/src/__tests__/app-token.test.mjs` — covers: FR-33, AC-46 — route: spec-task — (#117)
- [x] T132 The `github-actions` verdict from main's `workflow_run` (the `verdict` job, the gate workflow on `pull_request`, the runner adapter) in `packages/figentra-flow/src/lib/verdict.mjs`, `packages/figentra-flow/src/lib/approve-workflow.mjs`, `packages/figentra-flow/src/lib/gate-workflow.mjs` and `packages/figentra-flow/src/adapters/runner/github-actions.mjs` with `packages/figentra-flow/src/__tests__/verdict.test.mjs` — covers: FR-32, FR-35, AC-45, AC-48 — route: spec-task — deps: T131 — (#123)
- [x] T133 The land rules in a pure lib, and the AI review advisory (`reviewWarnings`, the `AI-Review:` line), in `packages/figentra-flow/src/lib/land-rules.mjs`, `packages/figentra-flow/src/lib/spec-status.mjs` and `packages/figentra-flow/src/commands/land.mjs` with `packages/figentra-flow/src/__tests__/land-rules.test.mjs` — covers: FR-34, AC-47 — route: spec-task — deps: T130 — (#125)
- [x] T134 Main's event-driven approve and merge lane (`cancel`, `route`, `approve`, `merge`; the requester, HOLD and freeze checks; `approve.requesters` and `approve.workflows`) in `packages/figentra-flow/src/lib/approve-check.mjs`, `packages/figentra-flow/src/lib/land-route.mjs`, `packages/figentra-flow/src/lib/merge.mjs`, `packages/figentra-flow/src/lib/approve-workflow.mjs` and `packages/figentra-flow/src/lib/product.mjs` with `packages/figentra-flow/src/__tests__/land-lane.test.mjs` — covers: FR-32, FR-35, AC-44, AC-48 — route: spec-task — deps: T131, T133 — (#127)
- [x] T135 `land` requests by the `fflow:land` label or a `/fflow land` comment and waits for `fflow/land` (`--wait`, `--no-wait`, the stack's wait; the L2 design's PR E, open as #128) in `packages/figentra-flow/src/commands/land.mjs` with `packages/figentra-flow/src/__tests__/land.test.mjs` — covers: FR-36, AC-49 — route: spec-task — deps: T134 — (#128)
- [ ] T136 K7: after the owner's App, Infisical and `FIGENTRA_AUTOMATION` setup, Flow's own `flow.config.json` names `secrets.oidc` and the `github-actions` runner, and `fflow sync` re-renders `.github/workflows/fflow-approve.yml` and `.flow/lock.json`; then each consumer's, from its `flow.config.json` — covers: FR-33, AC-46 — route: spec-task — deps: T134, T135
- [ ] T137 Release N+1 retires the approver fallback (`approve-dispatch`, `approveSecrets()`, the presets' approver secret names, land's dispatch and auto-merge) in `packages/figentra-flow/src/lib/approve-workflow.mjs`, `packages/figentra-flow/src/lib/render.mjs`, `packages/figentra-flow/src/commands/land.mjs`, `packages/figentra-flow/assets/flow/presets/stackra/preset.yml` and `packages/figentra-flow/assets/flow/presets/neutral/preset.yml` with `packages/figentra-flow/src/__tests__/land-lane.test.mjs` — covers: FR-36, AC-50 — route: spec-task — deps: T135, T136

## Amendment A-5: Flow as a general product

- [x] T138 Presets as npm packages (the resolution order, the `flow.preset` folder, the range check, the package's version in the lock, `doctor`'s preset row) and `fflow preset add`, in `packages/figentra-flow/src/lib/preset-package.mjs`, `packages/figentra-flow/src/lib/flow-dir.mjs`, `packages/figentra-flow/src/lib/render.mjs`, `packages/figentra-flow/src/commands/sync.mjs`, `packages/figentra-flow/src/commands/doctor.mjs` and `packages/figentra-flow/src/commands/preset.mjs` with `packages/figentra-flow/src/__tests__/preset-package.test.mjs` — covers: FR-37, AC-51, AC-52 — route: spec-task — (#124)
- [x] T139 ADR 0510 amended for presets as packages, no auto-patching and the marketplace path (P0), and for harness adapters (H0), in core's `apps/docs/src/docs/adr/0510-flow-replaces-spec-kit.mdx` — covers: FR-37, FR-39, FR-41, AC-51, AC-54 — route: adr — (core#438, the amendment of 2026-11-04)
- [x] T140 Flow exports the guard modules a preset imports, and the presets' guard files import them by package name, in `packages/figentra-flow/package.json`, `packages/figentra-flow/assets/flow/presets/stackra/guard/bash-rules.mjs`, `packages/figentra-flow/assets/flow/presets/stackra/guard/path-rules.mjs` and `packages/figentra-flow/assets/flow/presets/stackra/guard/hints.mjs` with `packages/figentra-flow/src/__tests__/preset-package.test.mjs` — covers: FR-38, AC-53 — route: spec-task — deps: T138 — (#130)
- [ ] T141 `@stackra/flow-preset` carries the stackra preset and the shared files `init` and `sync` install, in core's `packages/developer/flow-preset/` — covers: FR-39, AC-54 — route: spec-task — deps: T139, T140
- [ ] T142 The Stackra repositories switch `preset` to `@stackra/flow-preset`, each from its `flow.config.json`, and Flow drops `packages/figentra-flow/assets/flow/presets/stackra/` — covers: FR-39, AC-54 — route: spec-task — deps: T141
- [x] T143 Third-party skills not vendored: the upstream skills core vendored listed as `machineOnly` in `packages/figentra-flow/assets/flow/presets/stackra/third-party.yml`, the preset keeping only Figentra's own, with `packages/figentra-flow/src/__tests__/preset-content.test.mjs` — covers: FR-40, AC-55 — route: spec-task — (#100)
- [x] T144 Each allowed-licence skill of `packages/figentra-flow/assets/flow/presets/stackra/third-party.yml` pinned by commit and tree digest on the testbed, and installed by `sync` into `.agents/skills/.vendor/` — covers: FR-40, FR-8, AC-55, AC-10 — route: spec-task — deps: T143 — closed (STA-2097 decision (b), 2026-11-09): each repository commits its permissively licensed copies at `.agents/skills/<id>` with the licence file beside each; every other licence stays `machineOnly` and is not committed

## Amendment A-6: harness adapters

- [x] T145 Capability markers in the clarify and specify commands, the config's `harnesses`, the adapter interface with the text fallback, and the Claude Code and OpenCode adapters, in `packages/figentra-flow/src/adapters/harness/index.mjs`, `packages/figentra-flow/assets/flow/presets/stackra/commands/flow-clarify.md`, `packages/figentra-flow/assets/flow/presets/neutral/commands/flow-clarify.md`, `packages/figentra-flow/src/lib/config.mjs` and `packages/figentra-flow/src/lib/render.mjs` with `packages/figentra-flow/src/__tests__/harness.test.mjs` — covers: FR-41, FR-42, AC-56, AC-57 — route: spec-task — (#126)
- [x] T146 The Copilot, Cursor and Codex adapters (prompt files with provenance headers and lock digests; a dropped harness's unedited files removed) in `packages/figentra-flow/src/adapters/harness/index.mjs` with `packages/figentra-flow/src/__tests__/harness.test.mjs` — covers: FR-42, AC-57 — route: spec-task — deps: T145 — (#126)
- [x] T147 `fflow mcp`'s question tools (`fflow_questions_list`, `fflow_docs_lookup` and the one writer, `fflow_clarification_record`) in `packages/figentra-flow/src/commands/mcp.mjs` and `packages/figentra-flow/src/lib/questions.mjs` with `packages/figentra-flow/src/__tests__/mcp.test.mjs` and `packages/figentra-flow/src/__tests__/questions.test.mjs` — covers: FR-43, AC-58 — route: spec-task — (#126)
- [x] T148 Asynchronous questions through the tracker adapters, and resume on the answer, in `packages/figentra-flow/src/adapters/tracker/linear.mjs`, `packages/figentra-flow/src/adapters/tracker/github-issues.mjs` and `packages/figentra-flow/src/lib/questions.mjs` — covers: FR-44, AC-59 — route: spec-task — deps: T147 — (#131)
- [ ] T149 Flow's harness rendering replaces core's `tools/scripts/agents-sync.mjs`, deleted in core and then in each repository that carries a copy — covers: FR-42, AC-60 — route: spec-task — deps: T142, T146

## Amendment A-7: tests in CI and the gate's fan-out

- [x] T150 The Quality Gate's `test` job runs Flow's tests on every pull request and push to main, and the test policy says so, in `.github/workflows/ci.yml` and `AGENTS.md` — covers: FR-45, AC-61 — route: spec-task — (#122)
- [x] T151 `gate run --shards` refused on any runner but `command`, in `packages/figentra-flow/src/commands/gate-run.mjs` with `packages/figentra-flow/src/__tests__/shards.test.mjs` — covers: FR-46, AC-62 — route: spec-task — (#104)

## Prove (Phase 4 of `path-to-100.md`)

- [ ] T120 The acceptance criteria AC-13 to AC-34, each held by `@covers` tags in the per-command test files rather than one suite: `packages/figentra-flow/src/__tests__/resume.test.mjs`, `stage-record.test.mjs`, `land.test.mjs`, `stack.test.mjs`, `adr.test.mjs`, `queue.test.mjs`, `hooks-run.test.mjs`, `hooks.test.mjs`, `baseline.test.mjs`, `session.test.mjs`, `status.test.mjs`, `sessions.test.mjs`, `todo.test.mjs`, `plan.test.mjs`, `check.test.mjs`, `task.test.mjs`, `evidence.test.mjs`, `waves.test.mjs`, `gate.test.mjs`, `scope-drift.test.mjs` and `contract-drift.test.mjs` in the same folder — covers: FR-11, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-23, AC-24, AC-25, AC-26, AC-27, AC-28, AC-29, AC-30, AC-31, AC-32, AC-33, AC-34, P-016 — route: tests — deps: T049, T103, T109, T115
- [ ] T121 The packed-tarball e2e (init, sync, check, a caught hand edit, no runtime dependency beyond NFR-1's) in `packages/figentra-flow/src/__tests__/packed.e2e.mjs`, run by the `e2e` job of `.github/workflows/ci.yml` — covers: FR-11, FR-1, AC-1, AC-2, P-016 — route: tests — deps: T119
- [ ] T122 `trace ci` clean for this spec against `origin/main`: every FR and AC with a task and a test, recorded in `.agents/specs/sta-1945-flow-owns-everything/tasks.md` — covers: FR-11, AC-12, P-016 — route: tests — deps: T120, T121

## Rollout (FR-10, one PR per step)

- [ ] T123 Release 0.3.0 through `fflow release`, behind the owner's Environment approval, from `packages/figentra-flow/package.json` — covers: FR-10, FR-13, AC-12, AC-39, P-015 — route: release — deps: T122
- [ ] T124 Core repoints lefthook, the plan gate and `.claude` hooks to `fflow`, deletes its guard, spec code and shims with a `@stackra/repo-checks` changeset, and box 1 runs core's old guard tests for the exact commit, in core's `.agents/hooks/` and `.claude/settings.json` — covers: FR-10, AC-12, AC-9, P-015 — route: spec-task — deps: T123
- [ ] T125 Core's ADRs 0503 and 0510 amended for the agent layer in Flow's preset, in core's `apps/docs/src/docs/adr/0503-figentra-flow-runs-the-development-workflow.mdx` and `apps/docs/src/docs/adr/0510-flow-replaces-spec-kit.mdx` — covers: FR-10, AC-12, P-015 — route: adr — deps: T123
- [ ] T126 Every other repository re-syncs on 0.3.0 with its profile, deleting `.specify`, copied hooks, `.opencode` guard copies and vendored skills in the same PR, each from its `flow.config.json` — covers: FR-10, FR-6, AC-12, AC-6, P-015 — route: spec-task — deps: T124
- [ ] T127 Dead files and old names removed: the deprecated `figentra-flow` bin dropped from `packages/figentra-flow/bin/figentra-flow.mjs` and `packages/figentra-flow/package.json`, and the owner given the `~/.local/bin` list — covers: FR-10, AC-12, P-015 — route: spec-task — deps: T126
