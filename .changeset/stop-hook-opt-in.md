---
"@figentra-oss/flow": patch
---

The `Stop` hook (`session-save`) is now rendered only when `session.pushAtEnd` is `true`, like the `SessionEnd`
hook. Alone it wrote `.flow/record/<key>.json` every turn with nothing to commit it, so every task worktree was left
dirty and `git worktree remove` refused it.
