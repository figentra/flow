---
"@figentra-oss/flow": minor
---

The spec gate checks documents, not only their shape (STA-1945, FR-26 to FR-29 and FR-30's scope drift). A tiered spec
past Draft needs a `### Sources` section that cites every live FR, alone or in a range ("FR-1 to FR-12"). At an
approval stop (Clarified for a big spec, Planned for a feature or big one) spec.md and plan.md may hold no template
placeholder, no empty `(mandatory)` section and no open question (a struck item, or "None" with a note, is decided). A
feature or big plan gives each component under `## Components` a folder tree (a `text` block) and its interface
declarations (a block in a programming language; a diagram, data, shell or Markdown block does not count). FR, NFR and
AC lines that use a term of the preset's new `quality-words.yml` fail a big spec and warn on the others. `gate ci`
reports each changed file that no task of the branch's own spec names as scope drift (tests, changesets and lockfiles
aside): a failure on a big spec, a warning otherwise. `checkStage` takes `words` and a `warn` callback; the new checks
are exported from `./gate`.

Upgrading: a spec whose last `→ Clarified` Status history line is dated before 2026-11-03 (`DOCUMENT_GATES_SINCE`)
keeps the rules it was approved under, so existing approved and Done specs do not start failing; the Sources,
placeholder, component and vague-word checks apply to specs clarified from then on, and to an older spec once it is
amended and clarified again. Contract drift in `trace` and content-bound approvals (the rest of FR-30) come later.
