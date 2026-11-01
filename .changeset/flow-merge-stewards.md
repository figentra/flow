---
"@figentra-oss/flow": minor
---

`figentra-flow land` now refuses owner-only paths: workflows and actions, secrets and their guards, the catalog, the Flow configuration, repo settings, and billing and legal files. When the base's ruleset requires an approving review, `land` no longer merges: it dispatches the new `figentra-flow-approve.yml` workflow and turns on auto-merge at the head, never using an admin path. Running `land` on an already-merged PR finishes it: it sets the tracker issue to Done, removes the worktree and the branch, and comments. `sync` renders that workflow; before approving as the preset's App, it re-checks the paths, the head, the author and the required checks. `sync` also renders each preset's steward agents: `git-steward` and `ci-steward` in both presets, plus `tracker-steward` (neutral) or `linear-steward` (stackra). STA-1856.
