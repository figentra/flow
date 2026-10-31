---
"@stackra/vellum": minor
---

Worktrees live only in `<repo>/.claude/worktrees/` (Stackra ADR 0503). `vellum start <STA-n>` makes the branch `figentra/sta-n-<slug>` from the default branch and its worktree there, and moves the issue to In Progress. `vellum clean` removes finished worktrees without force: clean, saved (on a remote or landed by patch), issue Done or Canceled, or idle 2 hours without a key, and no ignored files outside the caches; it reports each kept tree with its reason and the space freed, `--adopt` moves stray trees in, `--fix-ignore` adds `.claude/worktrees/` to `.gitignore`, and `--all` acts on the workspace list that `vellum init --workspace` writes. `vellum guard` is the PreToolUse hook that refuses `git worktree add` anywhere else.
