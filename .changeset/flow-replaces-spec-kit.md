---
"@figentra-oss/flow": minor
---

Figentra Flow replaces spec-kit (ADR 0510). Flow owns the templates, the presets and the eight `flow-*` commands
(`/flow-specify`, `/flow-clarify`, `/flow-plan`, `/flow-tasks`, `/flow-analyze`, `/flow-checklist`, `/flow-implement`,
`/flow-converge`); `.specify/` becomes `.flow/` (constitution, overrides, `lock.json`); `figentra-flow spec` replaces
spec-kit's scripts; `sync` renders the skills without `specify`; `gate ci`'s install check replaces the tripwire; bug
specs live in `.agents/specs/bugs/`; and `figentra-flow migrate` moves a spec-kit repository over. Breaking: a
repository on 0.1.x runs `figentra-flow migrate` once.
