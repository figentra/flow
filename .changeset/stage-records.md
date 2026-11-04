---
"@figentra-oss/flow": minor
---

The stage commands write Flow's record (STA-1945 FR-14, T015), so `fflow next` always knows the stage: `fflow start`
records `start` (or `worktree` for a spec already Tasked) on the new branch, committed and pushed; `fflow spec
setup-plan` ends the spec stage the same way; `fflow gate run` writes the verdict on the gated sha (`gate` done or
failed) without committing it, since a commit would move the head off the gated sha, and no longer counts the record as
an uncommitted change; `fflow land` records `land` done with the PR in the task's worktree after the merge (committed
there, never pushed; a failure only warns, exit 3); `fflow ship` records `ship` done in a landed task's checkout. Off a
task's branch nothing is recorded, and a record that cannot be committed or pushed is a warning, never the stage's
failure. `endStage` in the record library is the shared step.
