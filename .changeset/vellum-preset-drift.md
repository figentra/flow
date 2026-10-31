---
"@stackra/vellum": patch
---

`vellum gate ci`'s tripwire compares a repository's installed `.specify` preset with the preset bundled in Vellum when the repository keeps no `.agents/speckit/presets` of its own, and names each drifted file.
