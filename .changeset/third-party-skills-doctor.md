---
"@figentra-oss/flow": minor
---

Third-party skills (STA-1945 PR 7). A preset's `third-party.yml` lists each skill by source, version (a full commit
id), licence and digest; `fflow sync` installs them into the git-ignored `.agents/skills/.vendor/`, all or none and
before it writes anything else, and pins them in `.flow/lock.json`'s `skills`. A licence outside MIT, Apache-2.0, BSD
and ISC needs the owner's `ownerEntry`, a failed fetch names the skill with a mirror hint, a digest that is not the
pinned one refuses, and a vendor folder that is a symbolic link refuses, with nothing installed. A `machineOnly` skill
is never installed or locked: `fflow check` fails when one is committed to the repository (by folder name or its
`SKILL.md` name), and `fflow doctor` lists each with where to install it (`~/.claude/skills/<id>/`) and its source. The
stackra preset marks HeroUI Pro's two skills, Remotion's six and the owner's own 13 as machine-only.
