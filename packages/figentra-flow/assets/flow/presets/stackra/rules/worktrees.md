---
title: Worktrees
always: true
description: One worktree per active task under .claude/worktrees/, removed when the work ends, never at the cost of work or outputs
---

# Worktrees

A repository keeps a handful of worktrees. Core once reached 153 of them and nearly filled the Mac's disk (STA-1871).
Every worktree holds its own dependencies and builds, and stale ones hide the work that matters.

## Rules

1. **One worktree per active task, only under `.claude/worktrees/<name>/`.** Never next to the repository.
   Make it with `pnpm exec fflow start STA-n`.
2. **`fflow land` removes it after the merge.** After an auto-merge, `land <n>` again finishes the PR.
3. **A session removes its own worktree when it ends.**
   - First commit and push the work.
   - Then run `git worktree remove <path>`, never `--force`.
   - Leave a worktree that another session is using alone.
4. **Never leave a detached HEAD with commits.** Put the commits on a branch first: `git switch -c <branch>`.
5. **Never delete ignored outputs without a backup.** `.env` files, `ios/` and `android/` folders, and builds you
   cannot rebuild get archived before the worktree goes.

## The budget

`clean.budget` in `flow.config.json` sets the most linked worktrees a repository should hold (default 10).
Above it, `fflow clean` and `fflow doctor` warn.

`fflow clean --budget` removes worktrees that have been idle for 24 hours or more and whose head is merged or
pushed. Before removing one:

- uncommitted work and a detached HEAD go to a new local `keep/<repo>-<name>` branch, committed with the hooks running;
- ignored files outside the caches go into an archive under `~/Backups/fflow/`.

It removes without `--force` and never deletes a branch. Run it with `--dry-run` first. `git-steward` owns it.
