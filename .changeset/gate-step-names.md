---
"@figentra-oss/flow": minor
---

Each gate step prints a mark before it runs (`::gate-step::<seconds> <step>`), so the `fflow/gate` status of a red
run names the step it stopped at (`failed at pnpm lint (exit 1)`) and the log shows when each step began. A log with no
marks keeps the old description.
