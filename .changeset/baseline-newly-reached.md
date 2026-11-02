---
"@figentra-oss/flow": minor
---

The baseline gate reports gains and newly reached failures (STA-1945, the backlog rule from os#114). A task that failed
on main and passes on the PR is a gain. A task that never ran on main because an upstream task of its own package
failed, and now runs and fails, is newly reached: it is listed with the task that unblocked it and is not a new
failure or debt. A regression, or a failure in an unrelated package, still blocks. `save` now records each task's
upstream tasks in `baseline.json` (`needs`), `check --json` prints the result, and the result's `fixed` is now `gains`.
