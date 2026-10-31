---
"@figentra-oss/flow": minor
---

Agent rosters: name one in `team` in `figentra-flow.config.json` and `figentra-flow team check` (also run by
`gate ci`) validates it and its role files against the new `schema/team.roster.schema.json` and
`schema/team.role.schema.json`. Flow ships no roles; without `team` nothing changes.
