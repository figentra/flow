---
"@figentra-oss/flow": minor
---

`fflow check` holds tasks.md to Flow's records (STA-1945 FR-23, T024): it fails on a task ticked `[x]` by hand, with
no passing evidence in the record (AC-22), and on a task in progress whose spec, plan or tasks changed since it
started (AC-24), naming the task and the fix. `check` still writes nothing, so the reset is `fflow task start`'s: it
first sets each such task back to `[ ]` and prints the reason, then starts the task asked for; a hand-ticked task
starts again rather than reading as done.
