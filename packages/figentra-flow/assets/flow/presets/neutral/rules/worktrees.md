---
title: Worktrees
always: true
description: One worktree per active task under .claude/worktrees/, removed when the work ends, never at the cost of work or outputs
---

# Worktrees

A repository keeps a small number of worktrees. Each one costs disk (dependencies and builds), and a pile of stale
ones hides real work.

## Rules

1. **One worktree per active task, only under `.claude/worktrees/<name>/`.** Never put one next to the
   repository. Make it with `fflow start <key>`.
2. **`fflow land` removes the worktree after the merge.** Run `fflow land <n>` again on a PR that auto-merged to
   finish it.
3. **A session removes its own worktree when it ends.** First commit or push the work. Then run
   `git worktree remove <path>`, never with `--force`. Leave a worktree another session is using alone.
4. **Never leave a detached HEAD with commits.** Put the commits on a branch (`git switch -c <branch>`) before
   leaving the worktree.
5. **Never delete ignored outputs without a backup.** Some ignored files can't be rebuilt, such as `.env` files and
   native project folders. Archive them before you remove the worktree.

## The budget

`clean.budget` sets how many linked worktrees a repository may hold; the default is 10. Above it,
`fflow clean` and `fflow doctor` warn.

`fflow clean --budget` removes worktrees that have been idle for 24 hours or more and whose work is merged or pushed.
It never uses `--force` and never deletes a branch. Before removing a worktree, it:

- commits uncommitted work to a new local `keep/<repo>-<name>` branch;
- puts a detached HEAD on that branch too;
- copies ignored files that aren't caches into `~/Backups/`.

Run it with `--dry-run` first. The `git-steward` role runs it.
