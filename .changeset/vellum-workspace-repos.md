---
"@stackra/vellum": patch
---

`vellum init --workspace` no longer lists a linked worktree (whose `.git` is a file) as a repository, so `vellum clean --all` does not walk the same repository twice.
