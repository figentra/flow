---
"@stackra/vellum": minor
---

`vellum gate` carries the spec tiers of Stackra ADR 0502: `**Tier**` (trivial, small, feature, big), the lane check's floor from the diff (migrations, contracts, permissions, money and new members raise it), the approval stops (`Approved by <who> <date>`, feature before Tasked, big before Planned and Tasked, with `**Approver**`), and small specs that keep their plan and tasks in spec.md. The spec template and the clarify and plan commands carry the same fields and the approval stop. Kiro depth (ADR 0502 decision 7): `checkCriteria` (EARS acceptance criteria with AC ids), `checkDesign` (plan.md's nine design sections, or a small spec's short `## Design`), `checkTraceTasks` (each task covers an AC and names a file), AC ids in `covers:`, the tasks lint and `vellum trace`; the spec, plan and tasks templates carry the sections.
