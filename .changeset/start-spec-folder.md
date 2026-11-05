---
"@figentra-oss/flow": patch
---

`fflow start` creates the key's spec folder in the new worktree when it has none: `spec.md` from the preset's spec
template with the issue key and feature branch filled in, so `fflow spec paths` finds it. `--dry-run` names it.
