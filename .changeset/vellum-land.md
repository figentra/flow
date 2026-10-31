---
"@stackra/vellum": minor
---

`vellum land` squash-merges a PR only when it is open, clean, based on the default branch, green on `vellum/gate` from the gate App on its exact head, conventionally titled and its spec's approvals are recorded, listing every failing rule otherwise. After the merge it sets Linear Done, records the merge commit so `vellum clean` counts the squashed branch as saved, removes the worktree under `clean`'s rules, deletes the branch and comments. `--stack` lands a stack bottom-up, updating each next PR by a merge and gating it again; `--manual-ok` is required until the repository's ruleset requires `vellum/gate`. `vellum clean` gains `only` and the recorded-merge rule.
