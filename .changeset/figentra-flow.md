---
"@figentra-oss/flow": minor
---

The first release of Figentra Flow (`figentra-flow`, alias `fflow`): spec-driven development from the spec to the landed change.

- **Specs:** `init` and `sync` install spec-kit with a preset, and `gate` and `trace` hold every spec, plan, task list and test in step (spec tiers, approval stops, EARS criteria, a nine-section design).
- **Worktrees:** `start` makes the branch and the worktree in `.claude/worktrees/` and moves the issue to In Progress; `clean` removes finished worktrees without force; `guard` keeps every worktree there.
- **The gate:** `gate run` checks the pushed head on a runner, and the box posts `figentra-flow/gate` as your gate App.
- **Land:** `land` squash-merges only on a green gate on the exact head, the recorded approvals and the independent AI review; it sets the issue Done, removes the worktree and deletes the branch, and `--stack` lands a stack bottom-up.
- **Configuration:** `figentra-flow.config.json` (with its schema) chooses the credentials, the tracker (Linear or GitHub Issues), the secrets source (environment or Infisical), the gate and review Apps, the worktrees `clean` keeps, and the artifact guard.
