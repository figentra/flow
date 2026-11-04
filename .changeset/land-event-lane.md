---
"@figentra-oss/flow": minor
---

Main's event-driven approve and merge lane (STA-1945, the L2 design's PR D). With `secrets.oidc`, `sync` renders
`fflow-approve.yml` with four more jobs: `cancel` removes the `fflow:land` label on a push; a keyless `route` job wakes
on the label, ready for review, `fflow/gate`'s success, a `/fflow land` or `AI-REVIEW:` comment, a listed workflow's
success (`approve.workflows`) or a 15-minute schedule; `approve` runs `approve-check.mjs` with `MODE=event`; and
`merge` runs the new `merge.mjs`, one run at a time per repository. A land request counts only when the label's
newest adder is a User with write or admin, or an App that `approve.requesters` lists. `approve` runs every approval
rule plus the land rules, approves at most once per head, and keeps one `<!-- fflow/land -->` comment and the
`fflow/land` status (waiting, owner, refused or approved). `merge` squash-merges at the head with `sha` when the Flow
App approved that head and nothing is owner-only, or when `apps.owner` approved it, minting a token per PR
(`merge-workflows` only for an owner-approved workflow change). `FIGENTRA_AUTOMATION` `on` runs both, `merge-only`
only merges, and anything else freezes the lane. Without `secrets.oidc` the workflow is unchanged; the dispatched job
stays as `approve-dispatch` for one release. `specAt` is now async.
