---
"@stackra/vellum": patch
---

`vellum clean` never removes or adopts a worktree that a running process works inside (a session's working folder, a dev server, a shell), found with `lsof` or `/proc`; when neither can be read it keeps every tree. `--adopt` moves a stray tree only after it has been idle for 2 hours.
