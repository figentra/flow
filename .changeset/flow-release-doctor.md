---
"@figentra-oss/flow": minor
---

`figentra-flow release` reports what the next release would publish (pending changesets and next versions, the version PR, the Release workflow's last run and its notices, the registry's versions) and publishes nothing; `figentra-flow doctor` checks Node, git, the configuration, the `.flow/` install, the ignored worktree folder, the roster and the credentials.

`figentra-flow init` now adds `.claude/worktrees/` to the repository's `.gitignore`, as FR-3 says (only `clean --fix-ignore` did).
