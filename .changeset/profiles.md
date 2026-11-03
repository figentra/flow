---
"@figentra-oss/flow": minor
---

Profiles (STA-1945 PR 3). A preset's `preset.yml` declares `profiles: { <name>: { agents, skills, hooks } }` and a
`default`, where `"*"` selects all; `flow.config.json` names one with `profile`, else the preset's default applies.
`sync` renders only the selected profile's agents and `flow-*` skills, and `.flow/lock.json` records the profile's
name. An unknown profile is refused, naming the preset's profiles. `neutral` has one profile, `default`; `stackra` has
`framework` (the default), `platform`, `product`, `brand` and `starter`, which all select everything until the
preset's content is split. A preset without `profiles` has one implicit `default` that selects all.
