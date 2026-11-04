---
"@figentra-oss/flow": minor
---

`fflow sync` renders the preset's surfaces (STA-1945 FR-7, part 2): `.claude/settings.json` (the preset's
`surfaces/settings.json` with Flow's hooks: the guard on `PreToolUse`, its post-write checks, prompt hints and session
context, and the session's `Stop` record and `SessionEnd` WIP commit and push, FR-19), the OpenCode projection
(`opencode.jsonc` and `.opencode/plugins/fflow-guard.mjs`, which puts every OpenCode call to the same guard entry,
an ask as a deny), `.mcp.yaml`, `AGENTS.md` and `CLAUDE.md`, and `lefthook.yml`, wherever the preset has the surface;
with `lefthook.yml` rendered it pins `mise.toml`'s oxfmt and oxlint at the catalog's versions. Each carries the
provenance header where its format allows (strict JSON carries none) and is in `.flow/lock.json`. The stackra preset
gains core's settings and OpenCode configuration as surfaces, and the neutral preset a bare `settings.json`, so a
neutral repository now gets `.claude/settings.json` and `lefthook.yml` too; a preset without `surfaces/` renders what
it did before. A profile's `hooks` selects Flow's hooks by id (`guard`, `post-write`, `prompt-hints`,
`session-context`, `session-save`, `session-stop`); the guard is mandatory and always rendered.
`fflow guard --print-settings` prints the same hooks. `sync` now deletes every owned file the lock lists that it no
longer renders and nobody edited (an agent, rule, skill, surface or hook file a narrower profile or preset drops), not
only `flow-*` skills and commands; an edited one is kept, stays in the lock, and `check` names it until it is deleted
by hand. `sync` never touches the spec folders (`.agents/specs/`). The configuration gains `mcp`, `lefthook` and
`agentsMd` (`facts`). A surface replaces a repository's own file of the same name on its first `sync`.
