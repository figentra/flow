---
"@figentra-oss/flow": patch
---

`ci.checks` and `ci.after` add a repository's own required steps to the rendered Code job (a format check, a PR-key
check before the tasks; a validate after them), so they stay under Quality Gate. Every check, gen and task step in Code
now runs with `!cancelled()`, keeping its own condition, so a failing check no longer hides the steps after it; the job
still fails.
