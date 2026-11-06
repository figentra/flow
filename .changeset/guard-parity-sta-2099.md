---
"@figentra-oss/flow": patch
---

The stackra preset's guard is level with core's again (core 2ea3f21e). The runway deploy rule also reads
`runway.ts` / `runway.js` run by `node` or `tsx`, the runway secrets sync and a script that calls `runRunway`;
`stackra promote` is a deploy like `stackra deploy`; and a new `gate-change` rule denies, for every role, approving
a waiting deployment (REST `pending_deployments`, GraphQL `approveDeployments`, a protection rule's callback) and
writing an environment, ruleset or branch protection through `gh api`. Reading them stays allowed. The guard bundle
`fflow sync` writes picks the change up.

The OpenCode guard plugin now runs the guard as an unattended executor (`STACKRA_EXECUTOR=1`), as core's OpenCode
guard does: the stackra tables apply the `executor` rules (`npx`, `pnpm dlx`, `eas`, `wrangler secret|--remote`,
`encore env set|create`, `secrets:import --confirm`) and core's executor layer (`curl`, `wget`, `gh`, network git,
`git branch -D`, `git worktree remove|prune`, `docker compose down -v`, `encore deploy|env|secret`, every `pnpm bot:*`
and `pnpm linear` but the exact `pnpm bot:git -- fetch origin` and `pnpm bot:git -- push [--force-with-lease] origin
HEAD`, and `figentra bot|pr merge|linear|secrets`), and refuse an edit outside the session's worktree or in the main
checkout (unless `STACKRA_ALLOW_MAIN=1`). Claude Code's hook is unchanged.
