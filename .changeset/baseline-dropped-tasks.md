---
"@figentra-oss/flow": patch
---

The baseline gate no longer reports a task as missing when its task name (the part after `#`) was dropped from
`baseline.tasks`: `gate baseline save` now writes the configured `baseline.tasks` into `baseline.json`, and `check`
skips a missing task only when its name is in main's saved list but not in the PR's. Dropping `test` keeps Baseline
green against a main baseline that still has `pkg#test`. A configured task the PR did not run, a dependency task
nobody configured (such as `pkg#gen`), and anything against a main baseline saved before this release, are still
missing until main saves a new baseline (STA-1945).
