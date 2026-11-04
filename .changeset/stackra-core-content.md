---
"@figentra-oss/flow": minor
---

The stackra preset carries Stackra core's agent content (STA-1945, D2): 27 role agents beside the three stewards, 14
more rules beside the worktree rule, 16 of its own skills, the agent reference (`reference/`), `routing.yaml` and `models.yaml`.
`fflow sync` on the stackra preset now renders them: the agents and rules as before, each skill folder file for file
to `.agents/skills/<name>/` (`.claude/skills/<name>/` with `--direct`), and the reference, routing and models to
`.agents/reference/`, `.agents/routing.yaml` and `.agents/models.yaml`, each with its provenance header and recorded in
`.flow/lock.json`. A stackra repository that keeps its own copies of these files gets them owned by Flow on its next
sync. The neutral preset is unchanged. The stackra `preset.yml` splits the agents and skills by profile (FR-6, D3),
and `sync` renders only the config's profile's share: `framework` (the default) gets all of it; `platform`, `product`
and `starter` all but the `compiler-engineer` agent; `brand` twelve agents (the stewards, review, specs, ADRs,
dependencies, design and accessibility, and the security, secrets and incident agents its routing and secrets rule
name) and the `flow-*`, spec and ADR skills, plus the design ones its `third-party.yml` lists. The reference,
routing and models go to every profile. Each of these files is a preset source an override may `replace`
(`skills/<name>/<path>`, `reference/<path>`, `routing.yaml`, `models.yaml`), as the commands, agents and rules are.
`fflow validate` names each agent or skill a profile selects that its preset
lacks, and `sync` refuses a preset skill folder named `flow-*` (it would replace a rendered command) or a preset file
that is not UTF-8 text. The secrets rule is owner-only at its `--direct` path (`.claude/rules/secrets.md`) as well as
at `.agents/rules/secrets.md`. Upstream skills are not vendored (owner, 2026-11-04): the 20 that core
copied in (archify, playwright, turborepo, vitest, pnpm, the Expo and EAS ones and others) are listed in
`third-party.yml` by source and licence, and `fflow doctor` names where to install each.
