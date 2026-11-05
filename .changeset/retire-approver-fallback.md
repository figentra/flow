---
"@figentra-oss/flow": minor
---

Breaking: the approver fallback is retired (the L2 design's PR G, STA-1945 FR-36 and AC-50). `fflow-approve.yml` no
longer has the dispatched `approve-dispatch` job, so it names no `FFLOW_APPROVER_APP_ID` or
`FFLOW_APPROVER_PRIVATE_KEY` secret and has no `workflow_dispatch` trigger; `approveSecrets()` is gone. Without
`secrets.oidc`, `sync` writes no approval workflow, and removes one it wrote before. `land` never dispatches the
approval workflow or turns on auto-merge: when the base's ruleset requires a review the head lacks and the base's
workflow takes no `fflow:land` request, it refuses and names `secrets.oidc`. After every repository syncs, the owner
deletes both secrets from each `fflow-approve` environment (the environment stays) and deletes the
figentra-flow-approver App.
