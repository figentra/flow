---
"@figentra-oss/flow": minor
---

`figentra-flow train`: release trains for repositories without GitHub's merge queue. `open` makes the train's milestone and label (the version next from changesets); `add` boards a PR only when it is open, on the default branch and green on `figentra-flow/gate` at its exact head; `close` cuts off; `build` merges the members into `train/<version>` with merge commits, ejects a conflicting member and, on a red gate, bisects the members to eject the first breaking one (`train.eject: "manual"` stops instead); `depart` fast-forwards the default branch to a tip that is green on its exact sha, after every `train.after` upstream is published, then opens the next train; `status` reports it all. The settings are the new `train` block of `figentra-flow.config.json`.
