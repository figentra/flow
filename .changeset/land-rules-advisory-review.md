---
"@figentra-oss/flow": minor
---

`land` no longer refuses a change for its AI review (ADR 0523 decision 6). A change in a `review.required` tier
whose verdict on the head is missing, stale or a FAIL now lands with a warning, and the squash commit records the
verdict as `AI-Review: PASS <head>`, `AI-Review: FAIL <head>` or `AI-Review: none`. A blocking finding that
`fflow review --record` confirmed still refuses, and every other rule is unchanged. The land rules (`landRules`,
`gateProblems`, `reviewWarnings`, `squashMessage`, `specAt`, `CONVENTIONAL`, `REVIEW_TIERS` and `MAX_FILES`) move to
`src/lib/land-rules.mjs`, and the spec's status, tier and approval helpers to `src/lib/spec-status.mjs`, so the
approval job can run the same rules without importing a command. `commands/land.mjs` and `commands/gate.mjs`
re-export them, so existing imports keep working.
