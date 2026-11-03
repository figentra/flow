---
"@figentra-oss/flow": minor
---

Task markers, optional tasks, checkpoints and task evidence (STA-1945 FR-23, FR-25). A task line in tasks.md carries
`[ ]` not started, `[~]` queued, `[-]` in progress or `[x]` done; only `[x]` counts as done. `T012*` marks a task
optional: it may stay `[ ]` when the spec reaches Done, and `status` lists it as skipped. A phase may end in a
checkpoint task, `- [ ] T013 Checkpoint: <command>`, which covers nothing and names no route or file; `gate tasks`
refuses one that is optional, has no command, carries `covers:`, `route:` or `role:`, or is not the last task of its
phase. `parseTasks` (and `fflow parse tasks.md`) now returns each task's `marker`, `optional` and `checkpoint`. Both
presets' tasks templates describe the markers.

New `fflow task start <key> <T###>` sets `[-]` on a Tasked or Implementing spec with its approvals and records the
start (the session named by `--session` or `FFLOW_SESSION`, HEAD, the documents' digest) in Flow's record.
`fflow task done <key> <T###> --command <cmd>` runs the check command (timed out after an hour), records the command, exit code, duration, HEAD, a clean tree and an output
digest, and sets `[x]` only on exit 0 at a clean HEAD that the command did not move; a failed attempt stays `[-]` and
is kept. A command that carries a secret or prints one (`env`, `printenv`, `export`, a `.env` file, `echo` of a
secret-named variable) is refused before it runs. `fflow trace` counts a ticked task as done only with passing
evidence once the spec has a record, and fails a Done spec that has a hand tick.
