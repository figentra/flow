---
"@figentra-oss/flow": patch
---

The OpenCode files, `opencode.jsonc` and `.opencode/**` with the guard plugin, are opt-in like `.claude/settings.json`,
under the config's new `surfaces.opencode`. `opencode.jsonc` allows broadly and then denies, so a product that does not
use OpenCode should not get it unasked. Unset, a repository keeps them only where its lock already records
`opencode.jsonc`, so core and the template keep theirs.
