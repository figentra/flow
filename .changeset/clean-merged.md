---
"@figentra-oss/flow": minor
---

`fflow clean` now treats a worktree as finished as soon as its work is merged: either its pull request merged at the
tree's head, or its branch's own commits are already in the default branch. It no longer waits for the issue to close
or for two idle hours, and it removes the branch too. Every other rule still keeps a tree, with the reason: in use,
locked, uncommitted changes, a tester's name, ignored files outside the caches (`.env`, `ios/`, `android/`, proof
outputs), or the repository's git hooks running a program from inside it. `fflow clean --merged` removes only merged trees, and lists only the merged trees it keeps. With
`clean.whenMerged: true`, the guard starts that run in the background each time a session starts, no more than once
every ten minutes. Its report goes to `.claude/worktrees/clean-merged.log`.
