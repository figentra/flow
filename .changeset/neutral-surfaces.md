---
"@figentra-oss/flow": minor
---

The neutral preset is ready for repositories outside Figentra. It ships `templates/readme-template.md`, a README layout
that names no brand: the same data file (`.flow/readme.yml`) and sections as the stackra layout, with a generic
Development section (the data's `development`, or "install, then run the checks CI runs") and the `fflow` steps, a
Contributing section, Docs, and a licence line with no copyright holder, and no footer. `fflow readme` and `fflow sync`
now render a neutral repository's README instead of refusing. It also ships `surfaces/agents-md/agents.md` (the shared
`AGENTS.md` blocks, with no brand, tracker or tool names of its own) and `surfaces/mcp.yaml`, which lists only `fflow
mcp`, run from the installed package. Nothing else `fflow sync` renders for the neutral preset changes; the preset's
digest does, so a neutral repository's next `fflow update` records the new one.
