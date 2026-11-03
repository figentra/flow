---
"@figentra-oss/flow": minor
---

Waves and the parallel build (STA-1945 FR-24). New `fflow task wave <key> [--json]` prints the build's next wave and
sets its `[ ]` tasks to `[~]` (queued): each task comes after its `deps`, no two tasks of a wave share a path, a wave
holds at most five tasks, and a checkpoint runs alone after every task above it, with nothing below it starting
before. A wave that still holds a failed or unfinished task is printed again, so the next one never starts; an
optional task left `[ ]` does not hold it. A dependency cycle is refused. `fflow next` and `fflow resume` now read the
build from tasks.md's markers: they name the wave a dead session left, restarting at its first unfinished task, and
the gate once every wave is done. Both presets ship a new `flow-build` command, the build workflow: it asks
`task wave`, starts the wave's tasks, runs them as parallel subagents, commits each, runs `task done` for each, and
stops at the wave boundary when one fails.
