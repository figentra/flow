---
"@figentra-oss/flow": minor
---

`fflow adr reserve <slug> --issue <key>` reserves the next ADR number through Flow's queue (STA-1945 FR-17). It takes
the `adr` queue lock (the branch `flow/queue/adr`, made through the GitHub API; a lock older than 15 minutes is taken
over with a notice), appends the entry to the numbers file the preset's new `queues.adr` names
(`apps/docs/adr/numbers.yaml` in the stackra preset), opens a PR, gates and lands it with `fflow land`, and prints the
number only once it is on the default branch. Two sessions reserving at once get different numbers. A reservation
that does not land prints no number and names its PR; the lock is always released. It replaces core's
`pnpm adr:reserve`, whose losing PR conflicted.
