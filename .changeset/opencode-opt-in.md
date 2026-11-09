---
"@figentra-oss/flow": patch
---

The OpenCode files, `opencode.jsonc` and `.opencode/**` with the guard plugin, are opt-in like `.claude/settings.json`,
under the config's new `surfaces.opencode`. `opencode.jsonc` allows broadly and then denies, so a product that does not
use OpenCode should not get it unasked. Unset, a repository keeps them only where its lock already records
`opencode.jsonc`, so core and the template keep theirs.

A first sync now refuses to replace any rendered file the repository wrote itself, not only AGENTS.md and README.md.
That covers `.mcp.yaml` and `.github/CODEOWNERS`; opting in to a surface is the repository's answer for that file, and sync logs what it drops. The refusal names what the render would drop
(an `.mcp.yaml`'s servers, a file's lines) and where it belongs instead: `mcp` in the config, or an extend override for
CODEOWNERS. When an owned file was edited since the last sync, sync still renders it as before, and now says which
lines go and where they belong.
