---
"@stackra/vellum": patch
---

`vellum gate run` and `vellum land` refuse a change that adds or changes build or tool output (`.cache/`, `node_modules/`, `dist/`, `.turbo/`, `coverage/` at any depth) or a file over 5 MB, naming each file; both are `artifacts` in `vellum.config.json`.
