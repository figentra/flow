---
"@figentra-oss/flow": minor
---

Task markers, optional tasks and checkpoints (STA-1945 FR-23, FR-25). A task line in tasks.md carries `[ ]` not
started, `[~]` queued, `[-]` in progress or `[x]` done; only `[x]` counts as done. `T012*` marks a task optional: it
may stay `[ ]` when the spec reaches Done. A phase may end in a checkpoint task, `- [ ] T013 Checkpoint: <command>`,
which covers nothing and names no route or file; `gate tasks` refuses one that is optional, has no command, or is not
the last task of its phase. `parseTasks` (and `fflow parse tasks.md`) now returns each task's `marker`, `optional` and
`checkpoint`. Both presets' tasks templates describe the markers. A new `evidence` module runs a task's check command
and records its exit code, duration, HEAD, a clean tree and an output digest, and refuses a command that carries or
prints a secret; `fflow task start` and `task done` build on it next.
