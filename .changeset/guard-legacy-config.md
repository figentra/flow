---
"@figentra-oss/flow": patch
---

The guard engine also refuses an agent's write to `figentra-flow.config.json`, the configuration's legacy name, which
is still read and so still picks the preset. When the configuration does not load (both names at once, or JSON that
does not parse), the guard tables fail to load and every tool call is denied, instead of quietly falling back to the
neutral preset's tables. `fflow help` now describes `guard` as the guard engine rather than the worktree hook.
