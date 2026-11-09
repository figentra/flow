---
"@figentra-oss/flow": minor
---

`fflow sync --direct` now projects `.agents/` into each assistant's folders itself, the work a repository's own
`agents:sync` script did (STA-2098 H6). Each agent is generated as a Claude Code agent and an OpenCode agent in its own
dialect, the model from the agent's tier and `.agents/models.yaml`, with OpenCode denies derived from its tools. Skills,
hooks and templates are linked, `.agents/hooks/_reviewer-agents.mjs` lists the reviewer agents, and `.mcp.json` is
rendered from `.mcp.yaml`. A real file is never overwritten. `fflow check` and `gate ci` report the projection's drift
for a repository that syncs direct. The preset's agents are now rendered to `.agents/agents/` in both modes, and the
projection writes `.claude/agents/`; an override that targets `.claude/agents/<id>.md` targets `.agents/agents/<id>.md`.
