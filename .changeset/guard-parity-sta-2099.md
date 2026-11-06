---
"@figentra-oss/flow": patch
---

The stackra preset's guard is level with core's again (core 2ea3f21e). The runway deploy rule also reads
`runway.ts` / `runway.js` run by `node` or `tsx`, the runway secrets sync and a script that calls `runRunway`;
`stackra promote` is a deploy like `stackra deploy`; and a new `gate-change` rule denies, for every role, approving
a waiting deployment (REST `pending_deployments`, GraphQL `approveDeployments`, a protection rule's callback) and
writing an environment, ruleset or branch protection through `gh api`. Reading them stays allowed. The guard bundle
`fflow sync` writes picks the change up.
