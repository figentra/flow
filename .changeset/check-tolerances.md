---
"@figentra-oss/flow": patch
---

`fflow check` tolerates two things a consumer carries today (STA-2131): a skill the preset's `third-party.yml` lists
under an allowed licence (or the owner's `ownerEntry`) committed at `.agents/skills/<id>`, and the rules block
stackra/core's `agents-sync` appends to the end of `AGENTS.md`. A listed skill under another licence or elsewhere,
and any `AGENTS.md` change outside that block, are still problems.
