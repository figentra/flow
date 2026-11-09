---
"@figentra-oss/flow": patch
---

The stackra preset's `docs-adr-steward` and `incident-commander` agents name the docs member as `<docs>/…`, so a product's
`stackra validate` keeps passing once its docs move from `apps/docs` to the root `docs/` (ADR 0514). A preset test now
refuses any backticked `apps/docs/` path in an agent.
