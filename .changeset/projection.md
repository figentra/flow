---
"@figentra-oss/flow": minor
---

A non-direct sync projects `.agents/` into each assistant's folders when the config sets `projection: true`. That covers
the agents in each dialect, the linked skills, hooks and templates, the reviewer list and `.mcp.json`. `fflow check`
then owns the projection, as it does after a direct sync. A repository keeps its rendered rules and skills under
`.agents/` and still drops its own projector script (core keeps ADR 0016's layout while retiring `agents-sync`).
