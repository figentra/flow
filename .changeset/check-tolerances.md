---
"@figentra-oss/flow": patch
---

`fflow check` tolerates two things a consumer carries today (STA-2131). A skill the preset's `third-party.yml` lists
may be committed at `.agents/skills/<id>` when its licence lets a repository carry it: an allowed licence, the
owner's `ownerEntry`, or the owner's own skills. HeroUI Pro's and Remotion's are still problems, as is a listed skill
elsewhere or a folder whose front-matter `name` is another skill. The rules block stackra/core's `agents-sync`
appends to the end of `AGENTS.md` is read away when it is the file's one trailing block; any other `AGENTS.md`
change, text between two blocks among them, is still drift. The stackra preset's `third-party.yml` header says so.
