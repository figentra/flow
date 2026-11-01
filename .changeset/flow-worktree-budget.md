---
"@figentra-oss/flow": minor
---

`figentra-flow clean` now keeps each repository within a worktree budget: `clean.budget`, default 10.

- **Warning:** `clean` warns when the repository has more worktrees than the budget.
- **Candidates:** `clean` lists worktrees that have been idle for 24 hours or more and whose work is merged or pushed.
- **`clean --budget`:** removes those candidates after preserving what they hold:
  - uncommitted work and a detached HEAD go to a new local `keep/<repo>-<name>` branch (hooks run; a refused commit keeps the tree as it was);
  - ignored files outside the caches go into an archive under `~/Backups/figentra-flow/`.

  It never forces a removal and never deletes a branch.

`doctor` warns, without failing, when the repository is over the budget and when the disk is low (under 10 GB or 10 % free).

`sync` installs a worktree rule from the presets into the agent rules. `init` and `clean` write `.claude/worktrees/README.md`. Both presets' `git-steward` runs the budget.

STA-1871.
