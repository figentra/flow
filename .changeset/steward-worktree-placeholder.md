---
"@figentra-oss/flow": patch
---

The stackra preset's git-steward and both presets' worktree rule name `.claude/worktrees/<name>/` instead of the bare
`.claude/worktrees/`, so a repository's agent check (Stackra core's `agents:check`) no longer reports a reference to a
folder that a clean checkout doesn't have.
