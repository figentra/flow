---
"@figentra-oss/flow": minor
---

The stackra preset carries Stackra core's agent content (STA-1945, D2): 27 role agents beside the three stewards, 14
more rules beside the worktree rule, 38 skills, the agent reference (`reference/`), `routing.yaml` and `models.yaml`.
`fflow sync` on the stackra preset now renders them: the agents and rules as before, each skill folder file for file
to `.agents/skills/<name>/` (`.claude/skills/<name>/` with `--direct`), and the reference, routing and models to
`.agents/reference/`, `.agents/routing.yaml` and `.agents/models.yaml`, all recorded in `.flow/lock.json`. A stackra
repository that keeps its own copies of these files gets them owned by Flow on its next sync. The neutral preset is
unchanged. The package grows from about 0.3 MB to about 2.2 MB packed, most of it the `archify` skill.
