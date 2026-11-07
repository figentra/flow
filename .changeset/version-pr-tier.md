---
"@figentra-oss/flow": patch
---

`fflow gate ci` no longer fails a changesets version PR (`changeset-release/main`) or a Renovate branch on the tier
floor: they bump versions and lockfiles and hold no spec. One `isBotBranch` check now serves the branch-shape rule and
the tier floor (STA-2222).
