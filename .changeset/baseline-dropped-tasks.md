---
"@figentra-oss/flow": patch
---

The baseline gate no longer reports a task as missing when the PR's `baseline.tasks` no longer runs its task name (the
part after `#`): dropping `test` from `baseline.tasks` keeps Baseline green against a main baseline that still has
`pkg#test`. A task whose name is still configured and that the PR did not run is still missing (STA-1945).
