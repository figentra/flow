---
"@figentra-oss/flow": minor
---

`fflow adr reserve <slug> --issue <key> [--owner <who>]` reserves the next ADR number through Flow's queue (STA-1945
FR-17). It takes the `adr` queue lock (the branch `flow/queue/adr`, made through the GitHub API; a lock 15 minutes old
or more is taken over with a notice, and a takeover or create GitHub keeps refusing is an error instead of a wait),
appends the entry to the numbers file the preset's new `queues.adr` names (`apps/docs/adr/numbers.yaml` in the stackra
preset; the neutral preset has no ADR register and declares no queue), opens a PR, gates and lands it with `fflow
land`, and prints the number only once it is on the default branch: stdout carries only the number, so
`n=$(fflow adr reserve …)` works, and the gate and land output goes to stderr. Two sessions reserving at once get
different numbers. A reservation that does not land, including one whose auto-merge is still waiting after 10
minutes, prints no number, names its PR and withdraws it (auto-merge off, PR closed, branch deleted) so it cannot land
later; the lock is always released. `landOne` (the function behind `fflow land`) takes a `refs` issue for a branch that
names none, so the squash names the reservation's issue. It replaces core's `pnpm adr:reserve`, whose losing PR
conflicted.
