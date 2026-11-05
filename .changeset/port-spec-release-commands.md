---
"@figentra-oss/flow": patch
---

Port `spec`, `linear`, `clean`, `ship`, `release` and `app create` from passthrough to declared commands on
`@stackra/console`, so each `--help` lists its arguments and options. Every flag is still accepted and handed to the
same `run`. `spec … --json`, `release --json` and `release --preflight --json` now write the engine's one
`{ "ok", "data" }` document, with the command's own document as `data`.
