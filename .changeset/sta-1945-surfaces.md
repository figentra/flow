---
"@figentra-oss/flow": minor
---

Flow can render a repository's agent and hook surfaces from its preset (STA-1945 FR-7, part 1). `renderMcp` writes
`.mcp.yaml` from the preset's `surfaces/mcp.yaml` and the configuration's `mcp` servers, and refuses any `env` value
that is not a `$NAME` reference. `renderAgentsMd` writes `AGENTS.md` and a `CLAUDE.md` that imports it, from the
preset's shared blocks and the repository's own facts. `renderLefthook` writes `lefthook.yml` from the preset's jobs and
the configuration's `lefthook` jobs, and wraps every pre-push job so it passes on the registry's 401 alone; `pinTools`
sets `mise.toml`'s oxfmt and oxlint pins to the catalog's versions. The stackra preset's hooks run oxfmt and oxlint as
named mise tools (`mise exec npm:oxfmt -- oxfmt`) and skip them with a note where mise is missing, with no `pnpm exec`
fallback (STA-2039). `stringifyYaml` and `surfaceYaml` are new helpers. `fflow sync` does not call the renderers yet:
part 2 wires them in and adds their configuration keys to the schema.
