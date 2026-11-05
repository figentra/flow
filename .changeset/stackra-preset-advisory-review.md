---
"@figentra-oss/flow": patch
---

The stackra preset's reviewer agents post an advisory `Review (advisory): PASS|FAIL <sha>` comment through
`pnpm bot:gh` instead of `pnpm bot:review`, since the stackra-reviewer App is retired (ADR 0523 decision 6);
nothing counts the comment. `flow-review` and `docs-spec-flow` say the same. Flow's own config drops `apps.review`.
