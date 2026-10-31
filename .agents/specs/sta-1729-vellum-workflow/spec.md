# Feature Specification: Vellum runs the whole development workflow

**Feature Branch**: `figentra/sta-1729-vellum-workflow`

**Created**: 2026-10-31

**Status**: Tasked

**Tier**: big

**Approver**: owner (direction, approved 2026-10-31 in `notes/plans/vellum-complete.md`); the leader for the technical
stops under the owner's delegation

**Linear**: STA-1729

**Clarifications status**: complete

**Input**: Owner direction (2026-10-31), the approved plan `stackra/notes/plans/vellum-complete.md`: finish Vellum so all
work runs through one workflow, from spec to release. Vellum moves the work (spec, approval, worktree, gate, land,
release, ship, status, clean); `stackra testbed` runs the checks on the boxes; runway deploys, and only the owner
promotes to production. GitHub keeps the Release workflow and one required check, `vellum/gate`, posted by the gate bot;
branch protection stays on. Land squashes. Worktrees live only at `<repo>/.claude/worktrees/<name>`.

## Impact

- **Apps touched**: none
- **Services touched**: none
- **Packages touched**: Vellum's `packages/vellum` (figentra/vellum); in Stackra core, the ADR, and later the
  `stackra testbed` entry point Vellum calls
- **Cross-service events**: none
- **Tenancy and data**: none
- **Secrets**: by name only: the gate bot's GitHub token (posts `vellum/gate`) and the Linear token, both from the
  calling repository's Infisical wrapper; Vellum never reads, prints or stores a value
- **ADR needed**: yes: ADR 0503 in core, "Vellum runs the development workflow" (amends ADR 0282 and 0502; records
  the one required check and the worktree rule)
- **New dependencies**: none (Vellum stays plain ESM with no runtime dependencies)
- **Deploy modes**: same everywhere (a developer tool)
- **Licence tier**: free
- **Docs to update**: Vellum's README and AGENTS.md; core's spec-lifecycle guide; each repo's AGENTS.md worktree rule
- **Lane**: full
- **Change risk**: R3 (changes how every repository lands code; switches off per-PR CI)

## Scope and phases

The plan's build order is the phase order. Each phase is its own task group and lands on its own; this spec is
approved once and the plan is written per phase (each phase's design is a plan.md section approved at its stop).

1. **Worktree rule:** `vellum start`, `vellum clean`, the worktree guard, `.claude/worktrees/` in every repository's
   `.gitignore`, and moving today's outside worktrees in.
2. **`vellum gate`:** wraps `stackra testbed` and the repository's verify, posts the `vellum/gate` commit status and
   writes the report.
3. **`vellum land`:** squash merge on a green gate and recorded approvals, Linear Done, worktree removed.
4. **`vellum status`:** every spec, worktree, gate and PR in flight across the repositories.
5. **`vellum release` and `vellum ship`:** changesets, the registry publish (with the 0.2.0 tag backfill), and runway
   deploy to dev and staging.
6. **GitHub switch-over:** per-PR workflows off, `vellum/gate` required, the Release workflow kept; repo by repo.
7. **Sessions (later, owner 2026-10-31, ADR 0503 decision 7):** a spec records its assigned session; `vellum status`
   shows each session's spec, worktree and gate; the two-build-session cap is reported.
8. **Later:** `vellum migrate` from `.specify/` to `.vellum/`.

## Requirements

- **FR-1** `vellum start <STA-n> [--slug s]` creates the branch `figentra/sta-n-<slug>` from the default branch's
  remote tip and its worktree at `<repo>/.claude/worktrees/sta-n-<slug>`, and moves the Linear issue to In Progress.
- **FR-2** A worktree is created only by `vellum start`: the guard refuses `git worktree add` to any path outside
  `<repo>/.claude/worktrees/`.
- **FR-3** Every repository ignores `.claude/worktrees/`; `vellum init` and `vellum clean --fix-ignore` add it.
- **FR-4** `vellum clean` removes a worktree only when it is clean and saved (its head on a remote ref, or every commit
  landed by patch), and either its issue is Done or Canceled or, without an issue key, it has been idle for at least
  2 hours; it keeps tester worktrees, trees holding ignored files outside the usual caches, and every tree it cannot
  prove saved, and reports the space it frees.
- **FR-5** `vellum gate` runs the full check set on a testbed box and posts `vellum/gate` (success or failure, with
  the report URL) on the head commit with the gate bot's token.
- **FR-6** `vellum land` merges only with a green `vellum/gate` on the head and the spec's approvals recorded, as one
  squash commit with a conventional message, then moves Linear to Done and removes the worktree.
- **FR-7** `vellum status` lists, for every repository in the workspace list, its specs, worktrees, gates and PRs.
- **FR-8** `vellum release` versions with changesets and publishes to the Stackra registry only; `vellum ship` deploys
  with runway to dev and staging; production stays `runway promote` by the owner.
- **FR-9** Builders run only oxfmt and oxlint on the Mac; every other check runs on a box.
- **FR-10** Work follows ADR 0503 decision 7: a leader session plans, assigns, tracks and approves technical stops;
  feature- and big-tier work runs in its own sub-session and `vellum start` worktree; the tester gates and lands; at
  most two build sessions run at once unless the owner says otherwise; a peer message is never the owner's approval. A
  spec records its session in `**Session**`, and `vellum status` shows it.

## Acceptance criteria

- **AC-001**: WHEN a builder runs `vellum start STA-n` in a repository THE CLI SHALL create branch `figentra/sta-n-<slug>` and its worktree at `<repo>/.claude/worktrees/sta-n-<slug>` and move STA-n to In Progress
- **AC-002**: IF the worktree folder or the branch already exists THEN THE CLI SHALL refuse and name it, changing nothing
- **AC-003**: WHEN an agent runs `git worktree add` to a path outside `<repo>/.claude/worktrees/` THE guard SHALL deny it and name `vellum start`
- **AC-004**: WHEN `vellum clean` runs THE CLI SHALL remove each worktree that is clean, landed or abandoned, and pushed, and report every other one with the reason it stays
- **AC-005**: IF a worktree is a tester worktree (`g-*`, `*-gate`, `land-*`, `tpl-core`, `c6-lock*`, `template-wt-lean`), is dirty, or holds unpushed commits THEN THE CLI SHALL keep it
- **AC-006**: WHEN `vellum clean --fix-ignore` runs in a repository whose `.gitignore` lacks `.claude/worktrees/` THE CLI SHALL add the line
- **AC-007**: WHEN `vellum clean --adopt` runs THE CLI SHALL move each clean, non-tester worktree outside `.claude/worktrees/` inside with `git worktree move`, and list the tester ones for stackra-f4 and the ones it cannot move
- **AC-008**: WHEN `vellum gate` finishes on a box THE CLI SHALL post `vellum/gate` on the head commit with the result and the report link
- **AC-009**: IF the gate's head commit is not the branch's current tip THEN THE CLI SHALL not post a success
- **AC-010**: WHEN `vellum land` runs with a green `vellum/gate` and the approvals recorded THE CLI SHALL squash-merge, set Linear Done and remove the worktree
- **AC-011**: IF the gate is missing, red or on an older commit, or an approval is missing THEN THE CLI SHALL refuse to land and say which
- **AC-012**: WHEN `vellum status` runs THE CLI SHALL list every repository's specs by status, worktrees, gates and open PRs
- **AC-013**: WHEN `vellum release` runs THE CLI SHALL version with changesets and publish only to the Stackra registry, then tag and create GitHub releases
- **AC-014**: WHEN `vellum ship <env>` runs for dev or staging THE CLI SHALL call runway deploy for that environment
- **AC-015**: IF `vellum ship production` is asked for THEN THE CLI SHALL refuse and name `runway promote` by the owner
- **AC-016**: WHILE a repository is switched over THE repository SHALL require only `vellum/gate` on main and keep only the Release workflow
- **AC-018**: WHEN `vellum clean` decides whether a worktree is saved THE CLI SHALL count it saved when its head is on a remote ref or `git cherry origin/<default> HEAD` lists no `+` commit
- **AC-019**: WHILE a worktree has a detached HEAD THE CLI SHALL treat it like any other: removable when it is clean, idle and saved
- **AC-020**: IF a worktree's branch carries no issue key THEN THE CLI SHALL require it to be clean, saved and idle for at least 2 hours, measured from the HEAD reflog's modification time, instead of a Linear state
- **AC-021**: WHEN `vellum clean` removes worktrees THE CLI SHALL report the disk space it freed
- **AC-022**: IF a worktree holds an ignored file outside the usual caches (such as `.env`, `ios/` or `android/`) THEN THE CLI SHALL keep it and name the files
- **AC-017**: WHEN `vellum land --stack` runs on a stack of PRs THE CLI SHALL land them bottom-up in order, each only after its own green `vellum/gate` on its rebased head
- **AC-027**: IF a running process (a session, a dev server, a shell) has its working folder inside a worktree, or running processes cannot be listed THEN THE CLI SHALL neither remove nor adopt it, and SHALL adopt a stray tree only after it has been idle for 2 hours
- **AC-028**: IF a repository keeps no preset source of its own and its installed `.specify` preset differs from the one bundled in Vellum THEN THE spec gate (`vellum gate ci`) SHALL fail and name the drifted file
- **AC-029**: WHEN `vellum land` has squash-merged a branch THE CLI SHALL record its merge commit, and `vellum clean` SHALL count that branch's worktree as saved once the merge commit is on the default branch
- **AC-030**: IF the default branch's ruleset does not require `vellum/gate` and `--manual-ok` is not passed THEN THE CLI SHALL refuse to land and name phase 6
- **AC-031**: IF a PR whose spec is small, feature or big has no counted `AI-REVIEW: PASS <head> base=<base>` from the `stackra-reviewer` App (by App identity, unedited, not by the PR's author or the head commit's author or committer) THEN THE CLI SHALL refuse to land it and name the ignored verdicts
- **AC-034**: IF a repository names no GitHub credentials (a wrapper script it has, or `gh-user` on purpose) THEN THE CLI SHALL refuse every GitHub call and never fall back to the caller's own `gh` login; `vellum status --offline` makes none
- **AC-023**: WHEN a spec carries a `**Session**` line THE CLI SHALL read it as the spec's assigned session and show it in `vellum status`
- **AC-024**: WHEN `vellum status` runs THE CLI SHALL list each session with its spec, worktree and the `vellum/gate` result of the worktree's head
- **AC-025**: IF a feature- or big-tier spec past Clarified has no `**Session**` THEN THE CLI SHALL report it in `vellum gate check` as a finding
- **AC-026**: WHILE more than two build sessions hold an In Progress spec and the owner has not raised the cap THE CLI SHALL report the excess in `vellum status`

## Clarifications (the leader's answers at the spec stop, 2026-10-31)

- **Q1. Worktree name.** `<repo>/.claude/worktrees/sta-n-<slug>` (the plan); the slug comes from the Linear title
  unless `--slug` is given. **Answer: yes.** `vellum clean` and `--adopt` skip every tester worktree name: `g-*`,
  `*-gate`, `land-*`, `tpl-core`, `c6-lock*` and `template-wt-lean`.
- **Q2. Base and install.** `vellum start` branches from `origin/<default>` after a fetch through the repository's bot
  wrapper, and does not run `pnpm install` (the Mac runs only oxfmt and oxlint; `--install` opts in). **Answer: yes.**
- **Q3. The guard.** Vellum ships `vellum guard` (reads the agent's PreToolUse JSON, denies `git worktree add` outside
  `.claude/worktrees/`, allows everything else). Wiring it into each repository's `.claude/settings.json`, and the same
  rule into core's `.agents/hooks/_rules.mjs`, is guard configuration: the owner applies it, as with the STA-1721 hook
  patch. Vellum prints the exact settings entry. **Answer: yes;** the leader takes the wiring to the owner.
- **Q4. Today's outside worktrees.** `vellum clean --adopt` moves the clean ones in; a dirty one or one with unpushed
  work is listed for its owner. **Answer: yes, but** `os-lines-gate`, `stackra/pro-gate` and
  `stackra/template-wt-lean` belong to the tester: `--adopt` lists them for stackra-f4 and never moves them. Only the
  OS scratchpad worktrees and other non-tester ones move.
- **Q5. Which repositories.** A workspace list in `~/.config/vellum/workspace.yaml` (path and GitHub slug per repo),
  written once by `vellum init --workspace`; `vellum status` and `vellum clean --all` read it. **Answer: yes.**
- **Q6. The gate bot.** `vellum gate` posts the status with the stackra-bot GitHub App token from the calling
  repository's wrapper (`pnpm bot:gh` today, the `figentra` CLI later). No human or agent token posts `vellum/gate`.
  **Answer: yes.**
- **Q7. Land on a stacked PR.** `vellum land` refuses a PR whose base is not the default branch; land the lower one
  first. **Answer: yes,** and a later `vellum land --stack` lands a stack bottom-up, each layer after its own green
  gate (AC-017).
- **Q8. Where the spec lives.** This spec and its plan stay in Vellum's `.agents/specs/`; the ADR is in core.
  **Answer: yes.**
- **Phase 1 also** adds `.claude/worktrees/` to `.gitignore` in billing, invoicing, brand, vellum, stackra/notes and
  stackra/pro.
- **Later phases** fold in stackra-f4's `notes/plans/vellum-final-plan.md` (ownership, the move list, old-Vellum
  verdicts, the agent-config model) when it lands.

## Status history

- 2026-10-31: Draft (questions sent to the leader for the spec stop)
- 2026-10-31: Draft → Clarified — Approved by leader 2026-10-31 (technical stop under ADR 0502; Q1 to Q8 answered)
- 2026-10-31: Clarified → Planned — Approved by leader 2026-10-31 (phase 1, with three revisions to `vellum clean`: AC-018 to AC-022)
- 2026-10-31: Planned → Tasked (tasks for phase 1; later phases are placeholders)
- 2026-10-31: Tasked (scope added) — Approved by owner 2026-10-31 ("Yes, record it", relayed by the leader): the sessions phase, FR-10 and AC-023 to AC-026; designed at its own plan stop
- 2026-10-31: Tasked (revised) — Approved by leader 2026-10-31 (AC-027: never remove or adopt a tree a live session works in; adopt only after 2 h idle)
- 2026-10-31: phase 2 Planned — Approved by leader 2026-10-31 (the gate design: a dedicated Stackra Gate App, `vellum gate ci` where Vellum is installed, `--box` now, no secret in any log)
- 2026-10-31: Tasked (revised) — Approved by leader 2026-10-31 (AC-028: the tripwire compares the installed preset with Vellum's bundled one once core keeps no copy, W2)
- 2026-10-31: phase 3 Planned — Approved by leader 2026-10-31 (land: merge-updated stacks, `stackra-gate[bot]` as defence in depth, any session, `--manual-ok` until phase 6 (AC-030), AC-029 kept)
- 2026-10-31: phase 3 Planned (revised) — Approved by leader 2026-10-31 (AC-031: the ADR 0230 AI review is a land rule for small, feature and big, ported from core's pr-merge.mjs; `vellum review` follows land)
- 2026-10-31: Tasked (revised) — Approved by leader 2026-10-31 (AC-034: GitHub calls only with named credentials, never a silent personal `gh` fallback; the adapter phase moves the setting into `vellum.config`)
