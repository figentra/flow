---
"@figentra-oss/flow": patch
---

The stackra preset's agents no longer name files that only core has, so a product's validate stops failing on them
(geo, invoicing). A docs page is now a link to docs.stackra.figentra.com instead of an `apps/docs/src/docs/…` path. A
rule is named (the `linear` rule) instead of its `.agents/rules/…` path, which a direct sync renders under
`.claude/rules` anyway. Core's `linear-reconcile.repos.yaml`, the ADR number queue and the ADR template are named as
core's. A test keeps such paths out.
