---
"@figentra-oss/flow": minor
---

`figentra-flow land` now refuses owner-only changes, matched case-insensitively:

- workflows and actions;
- what a deploy, promote or release runs, including the root package.json's scripts;
- secrets and their guards;
- the catalog, including a dependency moved off `catalog:`;
- the Flow configuration;
- repo settings;
- billing and legal files;
- a repository's own `approve.ownerOnly`.

When the ruleset requires an approving review, `land` waits until every required check is green from its trusted source. It then dispatches the new `figentra-flow-approve.yml` and turns on auto-merge at the head instead of merging. It never uses an admin path.

`land` on a PR that merged into the default branch finishes it. It deletes the branch only while it still points at the landed head.

`sync` renders four things:

- The approval workflow. It runs the tested `approve-check.mjs` at the pinned version in the `figentra-flow-approve` environment, which must allow only the default branch. It reads files and checks at the exact head, approves there, and dismisses its own approval if the head moved. The approving App's secrets have their own names.
- A CODEOWNERS for the owner-only paths, when `apps.owner` is set.
- Each preset's steward agents. Both presets ship `git-steward` and `ci-steward`; neutral adds `tracker-steward` and stackra adds `linear-steward`.
- A new `approve` config block that holds `ownerOnly` and the trusted `checks`.

STA-1856.
