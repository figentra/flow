# Figentra Flow: the path to 100%

**Owner:** the FLOW session (STA-1966 / STA-1945 / STA-2038) · **Written:** 2026-11-03 · **Status:** proposed

"100%" means: every task in every Figentra repository runs end to end in Flow (spec → approval → plan → worktree →
build → gate → review → land → release → ship), resumably, with no side doors and no hand-kept state; every finding of
the owner's three CLI try-outs is fixed; every repository runs on 0.3.0's governed preset; and GitHub runs only the
Release workflow plus the one required `fflow/gate` check.

## Phase 0 — Owner stops (unblock everything)

| #   | Action                                                                                                                   | Who   | Unblocks                 |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ----- | ------------------------ |
| 0.1 | Merge core #303 (main's docs break), then #290 (the console engine, gate 97/97)                                          | owner | the console prerelease   |
| 0.2 | Prerelease `@stackra/console` from CI                                                                                    | owner | Phase 3 wave F (CLI)     |
| 0.3 | Approve amendments A-1 to A-3 and answer Q4 (release model), Q5 (where stage workflows run), Q6 (where the record lives) | owner | tasks.md, all of Phase 3 |
| 0.4 | `fflow land 74` — the merge bot's first real run                                                                         | owner | the spec on main         |

## Phase 1 — Foundation (no dependency on 0.3.0's approval; in flight now)

| #   | PR                                                                                                                                                                  | Repo | State             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------- |
| 1.1 | Hygiene: mise-first hooks (no install on the Mac), self-dependency and approve pin on 0.2.3 (STA-2039)                                                              | flow | box check running |
| 1.2 | Core calls `fflow`, not the deprecated `figentra-flow` alias (STA-2039)                                                                                             | core | box check running |
| 1.3 | The five shipped specs (sta-1729, 1746, 1856, 1871, 1942) brought to the current standard and marked Done                                                           | flow | next              |
| 1.4 | Baseline "newly reached": a task that newly passes is a gain; a downstream task that newly runs and fails is newly reached, not a regression (os#114; FR-22's base) | flow | next              |

## Phase 2 — tasks.md (after 0.3)

`/flow-tasks` writes 0.3.0's tasks.md from the spec (FR-1 to FR-30, AC-1 to AC-34): every task with `covers:`, its
files (from the plan's folder trees, A-3), its route and deps, grouped into the waves below. `fflow gate tasks` green.

## Phase 3 — Build, in waves (each PR: `fflow start` → build → box gate → review → land; parallel within a wave)

| Wave                                  | PRs (plan numbers)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Depends on |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **A — the spine**                     | 1 Governance core (lock v2, provenance, `check`/`diff`/`validate`/`update`, `--workspace`) · 10 Record and lifecycle (`.flow/record`, `next`, `resume`, the stop hook that pushes, side-door guard rules) · 17 Markers and evidence (`task start`/`task done`, four markers, optional and checkpoint tasks)                                                                                                                                                                                                                         | tasks.md   |
| **B — rules for documents**           | 2 Overrides and policies · 3 Profiles · 19 Templates (Discovery, Sources, standards table, diagrams, per-component tree and interfaces) · 20 Document gates (placeholders, open questions, vague words, scope and contract drift, content-bound approvals)                                                                                                                                                                                                                                                                          | A          |
| **C — the rendered setup**            | 4 Guard engine (R3, core's hooks ported with test parity, wired in every repo) · 5 Surfaces (`.claude/settings.json`, OpenCode, `.mcp.yaml`, mise-first `lefthook.yml`, AGENTS.md, CLAUDE.md) · 6 Core's content into the preset (28 agents, 48 skills, rules, reference, routing, models) · 7 Third-party skills by licence, and `doctor`                                                                                                                                                                                          | A, 2, 3    |
| **D — the manual glue**               | 11 Stacks (merge-up after a squash, retarget, `land --stack`) · 12 Queues (`fflow adr reserve`) · 13 Hooks on the testbed (`Hooks-Run:` trailer) · 16 Baseline-aware merge bot                                                                                                                                                                                                                                                                                                                                                      | A, 1.4     |
| **E — Claude inside the stages**      | 14 Stage workflows (`plan` splits into PR-sized tasks and waves; `review` parallel reviewers plus verifiers; `gate` fans out across boxes) · 18 Waves and the parallel build (up to 5 subagents, resume from markers) · 15 Sessions, to-do and ledger (live session detection, the session-names ADR, `fflow todo`, `fflow ledger`)                                                                                                                                                                                                 | A, D       |
| **F — the CLI on the console engine** | 9 Every `fflow` command on `@stackra/console`, none left passthrough: help and unknown-command handling, doctor as a grouped checklist (credentials a warning on a fresh repo), status tables with every problem named (`--verbose`) and live sessions, `init` writes a starter config and explains what it rendered, `sync` right after `init` just works, one file count, `spec paths` falls back to the spec folder, no circular `gate dir` hint, no raw git or pnpm output outside `--verbose`, brand look, `--json` everywhere | 0.2        |
| **G — the report**                    | 8 Divergence report (`status --divergence`) and the docs (README, AGENTS.md, preset docs, Flow ADRs)                                                                                                                                                                                                                                                                                                                                                                                                                                | B, C       |

## Phase 4 — Test and prove

1. **Per PR:** unit tests beside each subject (`node --test`), the packed-tarball e2e, `pnpm verify` on a box.
2. **Acceptance suite:** AC-13 to AC-34 as one e2e suite on the testbed (resume after a killed session, a three-PR
   stack, two parallel ADR reservations, a checkout without install, a red main with a green PR, a hand-ticked task,
   a spec edited after approval, scope drift).
3. **Owner try-out, round 4:** the three earlier rounds' steps replayed on a fresh repository and on os; every finding
   gone (a scripted checklist the owner runs).
4. **Dogfood:** one real issue run end to end entirely through Flow (STA-298), and the rest of 0.3.0's own PRs landed by
   Flow (wave E onwards).

## Phase 5 — Release and rollout

1. **0.3.0 release** (Q4's model; production approval stays the owner's).
2. **Migration (FR-10), one PR per step, core green at each:** core repoints to the preset and deletes its copies; every
   repository re-syncs (`fflow sync --workspace`, the 18 repos of the census, including velora, mezzora, jute and
   academorix once their lockfiles land).
3. **Switch-over (plan step 6, after the testbed is up):** per repository, per-PR workflows off and `fflow/gate` the one
   required check; flow first, then core, template, os and the products.

## Phase 6 — After 100% (recorded, not blocking)

STA-1797 (`train depart` through an auto-merged PR); STA-1917 (preview links, after runway's STA-1907 output); a Claude
Code plugin for outside users; publishing skills and agents as registry items (FR-12's later step).

## Exit criteria (all true = 100%)

- Every FR and AC of STA-1945 (including A-1 to A-3) is covered by a task with passing evidence and a test (`trace ci`).
- `passthroughCommands(fflow)` is empty; the round-4 try-out has no finding.
- Every repository's `fflow check` is green on the 0.3.0 preset; `fflow status --divergence` reports nothing unreviewed.
- On every repository, `fflow/gate` is the only required check and per-PR workflows are off.
- `fflow todo` and `fflow ledger` replace the hand-kept state file.
