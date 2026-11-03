---
"@figentra-oss/flow": minor
---

The spec gate checks documents, not only their shape (STA-1945, FR-26 to FR-30). A tiered spec past Draft needs a
`### Sources` section that cites every live FR, alone or in a range ("FR-1 to FR-12"). At an approval stop (Clarified
for a big spec, Planned for a feature or big one) spec.md and plan.md may hold no template placeholder, no empty
`(mandatory)` section and no open question. A feature or big plan gives each component under `## Components` a folder
tree (a `text` block) and its interface declarations (a block in the repository's language). FR and AC lines that use a
term of the preset's new `quality-words.yml` fail a big spec and warn on the others. `gate ci` reports each changed file
that no task of the branch's own spec names as scope drift (tests, changesets and lockfiles aside): a failure on a big
spec, a warning otherwise. `checkStage` takes `words` and a `warn` callback; the new checks are exported from `./gate`.
