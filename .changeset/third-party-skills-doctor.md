---
"@figentra-oss/flow": minor
---

Third-party skills (STA-1945 PR 7). A preset's `third-party.yml` lists each skill by source, version, licence and
digest; `fflow sync` installs them into the git-ignored `.agents/skills/.vendor/`, all or none, and pins them in
`.flow/lock.json`'s `skills`. A licence outside MIT, Apache-2.0, BSD and ISC needs the owner's `ownerEntry`, a failed
fetch names the skill with a mirror hint, and a digest that is not the pinned one refuses, with nothing installed. A
`machineOnly` skill is never installed or locked: `fflow check` fails when one is committed to the repository, and
`fflow doctor` lists each with the source to install it from on the machine. The stackra preset marks HeroUI Pro's two
skills, Remotion's six and the owner's own 13 as machine-only.
