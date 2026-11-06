---
"@figentra-oss/flow": minor
---

The SessionEnd hook that commits the session's work as WIP and pushes it (`fflow session stop`, hook id
`session-stop`) is no longer rendered by default. A repository opts in with `"session": { "pushAtEnd": true }` in
`flow.config.json`; without it no rendered hook commits or pushes, and the Stop hook (`--save-only`) still writes the
session's record locally. Run `fflow sync` after upgrading; add the key first to keep the push at session end.
