# Feature Specification: Figentra Flow keeps worktrees within a budget

**Feature Branch**: `figentra/sta-1871-worktree-hygiene`

**Created**: 2026-11-01

**Status**: Planned

**Tier**: feature

**Approver**: owner (requested 2026-11-01, relayed by the leader session)

**Linear**: STA-1871

**Clarifications status**: complete

**Input**: Owner request 2026-11-01. Core reached 153 worktrees and the Mac nearly filled its disk, so worktree hygiene
becomes part of Flow and no repository reaches 100 or more again. This builds on STA-1856, whose `git-steward` role
runs `clean`.

## Impact

- **Apps touched**: none
- **Services touched**: none
- **Packages touched**: `packages/figentra-flow`: `clean`, `doctor`, `init`, `render`, the config schema (`clean.budget`),
  and the presets' `rules/`
- **Cross-service events**: none
- **Tenancy and data**: none. A worktree removed by the budget keeps its uncommitted work on a local `keep/` branch
  and its ignored, non-rebuildable files in a backup archive.
- **Secrets**: none
- **ADR needed**: no (a `clean` mode on Stackra ADR 0503's worktree rules)
- **New dependencies**: none (`tar` and `git` are already on every machine Flow runs on)
- **Deploy modes**: same everywhere (a developer tool)
- **Licence tier**: free
- **Docs to update**: `packages/figentra-flow/README.md`, the changeset
- **Lane**: full
- **Change risk**: R2. `clean --budget` removes worktrees that hold uncommitted work, after preserving it.

## Requirements

- **FR-1** Each preset ships a worktree rule in `rules/worktrees.md`. `sync` renders it into the repository's agent
  rules: `.agents/rules/worktrees.md`, or `.claude/rules/worktrees.md` with `--direct`, overridable from
  `.flow/overrides/rules/`. The rule says:
  - one worktree per active task, only under `.claude/worktrees/`;
  - `land` removes it after the merge;
  - a session removes its own worktree when it ends;
  - never leave a detached HEAD with commits;
  - never delete ignored outputs without a backup.
- **FR-2** `init` writes `.claude/worktrees/README.md` with the same rule in short, for people browsing the folder.
  The folder is git-ignored, so the file is local.
- **FR-3** `clean` counts the repository's linked worktrees against `clean.budget` (default 10). Above the budget it
  warns. Every run lists the budget candidates: worktrees under `.claude/worktrees/` that have been idle for 24 hours
  or more and whose head is merged or pushed, and that are not in use, locked or a tester's.
- **FR-4** `clean --budget` removes the candidates with the sweep's safety:
  - uncommitted work is committed to a new local branch `keep/<repo>-<name>`;
  - a detached HEAD gets that branch too;
  - ignored files outside the caches go into a `tar.gz` under `~/Backups/<NAME>/` first;
  - removal is `git worktree remove` without `--force`;
  - no branch is ever deleted;
  - a step that fails keeps that worktree and says why;
  - `--dry-run` changes nothing.
- **FR-5** `doctor` warns, without failing, when the repository holds more linked worktrees than its budget, and when
  the disk under it has less than 10 GB or less than 10% free.
- **FR-6** The stewards say it. `git-steward` runs `clean`, and `clean --budget` when over budget.
- **FR-7** Tests cover:
  - the rendered rule;
  - the README;
  - the count and the candidates (idle, merged or pushed, in use, recent);
  - preservation of uncommitted work and of a detached HEAD;
  - the backup of ignored files;
  - the kept branch;
  - the dry run;
  - doctor's warnings.

## Status history

- 2026-11-01: Draft → Clarified (owner request relayed by the leader session)
- 2026-11-01: Clarified → Planned — Approved by owner 2026-11-01 (relayed by the leader session)
