---
"@figentra-oss/flow": minor
---

The spec gate holds a small spec's design and every task to the folder trees (STA-1945, FR-27's small tier and FR-30's
first clause). From Planned, a small spec's one-page `## Design` needs a folder tree (a `text` block) and its interface
declarations (a block in a programming language), as a feature or big plan's components do. From Tasked, and in
`gate tasks`, each task may name only files that the plan's folder trees hold (the trees under its Components and
Files and folders headings; a small spec's trees are in its `## Design`). A tree line nests under the folder lines
above it, and an entry may use `*`, `**` or `{a,b}`. The spec folder, tests, changesets and lockfiles are exempt, as are
backticked names that are not paths. A task naming any other file fails a big spec and warns on the others.
`checkSmallDesign`, `checkTaskTrees` and `TREE_GATES_SINCE` are exported from `./gate`.

Upgrading: a spec whose last `→ Clarified` Status history line is dated before 2026-11-04 (`TREE_GATES_SINCE`) was
tasked without the tree rule and keeps passing without it. This covers the five Done specs and STA-1945, whose tasks
also name files in other repositories. The small-design rule follows `DOCUMENT_GATES_SINCE` (2026-11-03), as the plan's
component rule does.
