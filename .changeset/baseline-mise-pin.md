---
"@figentra-oss/flow": patch
---

`sync` pins mise: a `jdx/mise-action` step in `baseline.setup` that names no `version` gets `2026.11.4`, and the
event lanes' decrypt step installs that version too. An unpinned mise-action downloads the newest mise, and a 504 from
that release turned every repository's CI red. A step that sets its own `version` keeps it.
