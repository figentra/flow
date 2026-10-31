---
"@stackra/vellum": minor
---

The tracker port: `vellum.config.json`'s `tracker` chooses `linear` (by team, with a branch prefix and the token's environment names) or `github-issues` (keys `gh-<n>`). Issue keys, branch names and worktree folders come from it, `start`, `clean` and `land` read and move issues through it, and the spec gate's stage comments use it instead of `pnpm linear`; a tracker failure is now a printed warning. `clean.keep` lists the worktree names `clean` never touches. Without a config file the Linear `STA` scheme and the earlier tester names are kept, with a warning, until the next minor version.
