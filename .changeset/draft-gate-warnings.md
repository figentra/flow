---
"@figentra-oss/flow": patch
---

`fflow gate check` on a Draft spec now runs the spec checks its approval will run and prints their findings as
`at approval:` warnings (the exit stays 0), so an author sees them before approval. `gate run --help` is pinned to
print the help and dispatch nothing.
