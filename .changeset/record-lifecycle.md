---
"@figentra-oss/flow": minor
---

Flow's record and the lifecycle, first part (STA-1945 PR 10): `.flow/record/<key>.json` on the task's branch with
its schema (`schema/record.schema.json`); the stage table from `start` to `ship`; `fflow next [<key>]` names a task's
stage and the command that moves it on; `fflow resume <key>` rebuilds a dead session's worktree from its pushed branch
and re-runs a repeatable stage; `fflow session stop`, the Stop hook, commits the worktree as a WIP commit and pushes
it with the record, named by the session's title (its last `/rename`, ADR 0001) rather than its id. `fflow guard` now also denies a push to the default branch, `gh pr merge` and `LEFTHOOK=0`, each
naming the Flow command to use instead.
