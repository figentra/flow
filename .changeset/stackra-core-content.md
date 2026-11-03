---
"@figentra-oss/flow": minor
---

The stackra preset carries Stackra core's agent content (STA-1945, D2): 27 role agents beside the three stewards, 14
more rules beside the worktree rule, 38 skills, the agent reference (`reference/`), `routing.yaml` and `models.yaml`.
`fflow sync` on the stackra preset now renders them: the agents and rules as before, each skill folder file for file
to `.agents/skills/<name>/` (`.claude/skills/<name>/` with `--direct`), and the reference, routing and models to
`.agents/reference/`, `.agents/routing.yaml` and `.agents/models.yaml`, each with its provenance header and recorded in
`.flow/lock.json`. A stackra repository that keeps its own copies of these files gets them owned by Flow on its next
sync. The neutral preset is unchanged. The stackra `preset.yml` splits the agents and skills by profile (FR-6, D3),
and `sync` renders only the config's profile's share: `framework` (the default) gets all of it; `platform`, `product`
and `starter` all but the `compiler-engineer` agent; `brand` nine agents (the stewards, review, specs, ADRs,
dependencies, design and accessibility) and seventeen skills (the eight `flow-*`, specs, ADRs, diagrams, pnpm and the
design ones). The reference, routing and models go to every profile. `fflow validate` names each agent or skill a
profile selects that its preset lacks, and `sync` refuses a preset skill folder named `flow-*` (it would replace a
rendered command) or a preset file that is not UTF-8 text. The package grows from about 0.3 MB to about 2.2 MB packed,
most of it the `archify` skill.
