---
"@figentra-oss/flow": minor
---

`gate run` with a `command` runner (the testbed) posts `figentra-flow/gate` on the caller's side: the box gets only the
check and returns its exit code, and the gate App's key never reaches it. The poster runs only when `gate run` (or the
gate workflow) starts it.
