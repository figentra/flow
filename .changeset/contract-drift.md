---
"@figentra-oss/flow": minor
---

`fflow trace drift <dir>` reports contract drift (STA-1945 FR-30, AC-33): each function a plan's component declares in
its interface blocks (a small spec's `## Design` when there is no plan) must exist in a file of that component's folder
trees with the same name, parameters and return. A missing function, one with another signature, and an interface
block with code but no readable function declaration are each reported, and the command exits 1. `fflow trace ci`
runs the same check on a Done spec, except one last clarified before 2026-11-03 (`DOCUMENT_GATES_SINCE`), which was
not written for it. JavaScript, TypeScript, Python `def` and Go `func` declarations are read; classes, types and
constants are not checked yet. `contractDrift(plan, read)` lives in `src/lib/contract-drift.mjs`.
