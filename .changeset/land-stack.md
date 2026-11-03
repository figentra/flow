---
"@figentra-oss/flow": minor
---

`fflow land --stack` lands a whole stack with no human step (STA-1945 FR-16). After each squash it merges the default
branch into the next PR (a merge commit and a normal push), resolves each conflict in a file whose default-branch
version is the landed parent's own, stops on any other conflict with the merge aborted and the file named, retargets
the PR when GitHub has not, gates it unless its head is already green, and lands it. Run again after a stop, it
resumes where it stopped, also once GitHub has retargeted the next PR. `--dry-run` now prints the stack's plan.
