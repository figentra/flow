---
"@figentra-oss/flow": minor
---

Flow's record and the lifecycle, first part (STA-1945 PR 10): `.flow/record/<key>.json` on the task's branch with
its schema (`schema/record.schema.json`); the stage table from `start` to `ship`; `fflow next [<key>]` names a task's
stage and the command that moves it on, reading the record from the key's worktree or branch; `fflow resume <key>`
rebuilds a dead session's worktree from its pushed branch, fast-forwards a stale one (refusing a diverged one) and
re-runs a repeatable stage; `fflow session stop`, the Stop hook, commits the tracked changes as a WIP commit and pushes
it with the record (never an untracked file or one named like a secret, which it lists; hooks always run, and a refusal
is reported as that), named by the session's title (its last `/rename`, ADR 0001) rather than its id, and kept as one
entry across renames by its `session_id`. `fflow guard` now also denies a push to the default branch, `gh pr merge` and
`LEFTHOOK=0` set as a variable, also behind `env`, `command` or a program's path, each naming the Flow command to use
instead.
