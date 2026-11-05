---
"@figentra-oss/flow": patch
---

`fflow start` creates the key's spec folder in the new worktree when `origin/<default>` has none for it: `spec.md`
from the preset's spec template with the issue key and feature branch filled in, committed with the start record so
the worktree stays clean, and `fflow spec paths` finds it. A bug-lane key (a folder under the bugs dir) and
`--no-spec` (trivial work) get none. `--dry-run` names it. `/flow-specify` edits a `spec.md` start wrote rather than
overwriting it.
