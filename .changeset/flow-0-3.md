---
"@figentra-oss/flow": minor
---

Figentra Flow 0.3: spec-driven development for agent teams, for any repository. 1.0 follows once the 12 repositories
run the preset package and the GitHub Actions gate (leader, 2026-11-04). The breaking changes since 0.2.3, each
described in its own changeset:

- `fflow land` asks main's land lane (label `fflow:land`) and waits when the base's approval workflow has the event
  lane; the dispatch and auto-merge path remains for one release.
- AI review is advisory: `land` records `AI-Review:` in the squash and no longer refuses without a PASS.
- `fflow sync` owns the presets' surfaces (`.claude/settings.json`, `opencode.jsonc`, `.mcp.yaml`, `AGENTS.md`,
  `CLAUDE.md`, `lefthook.yml`) and deletes the owned files it no longer renders when nobody edited them.
- `fflow check` refuses a hand-ticked task and an approval whose documents changed.
- `doctor --json` and `status --json` write `{ ok, data }` (the console engine).
- The stackra preset ships no vendored third-party skills; it lists them by source.
- A preset may be an npm package (`fflow preset add`), and `@stackra/flow-preset` replaces the bundled `stackra`
  preset in a later release.

The stackra preset's `npx` MCP servers are pinned to exact versions instead of `@latest`.
