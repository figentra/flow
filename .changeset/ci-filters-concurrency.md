---
"@figentra-oss/flow": minor
---

The rendered CI takes `ci.filters`, turbo filters added to every gen, task and integration run (core leaves out its mobile apps), and `ci.concurrency`, a per-task turbo `--concurrency` that runs that task in a step of its own (core caps typecheck at 2 so the runner keeps its memory). Without either option the workflow renders unchanged.
