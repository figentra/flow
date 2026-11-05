---
"@figentra-oss/flow": minor
---

Port `spec`, `linear`, `clean`, `ship`, `release` and `app create` from passthrough to declared commands on
`@stackra/console`, so each `--help` lists its arguments and options. Every flag is still accepted and handed to the
same `run`. **Breaking** for scripts parsing `spec … --json` and `release [--preflight] --json`: they now write the
engine's one `{ "ok", "data" }` document, and the command's old document is under `.data` (`data.FEATURE_DIR`,
`data.IMPL_PLAN`, …), as `doctor --json` and `status --json` already do. `spec template <name> --json` writes the
template's text as `data`, one string. The shipped `flow-*` commands read the fields under `data`.
