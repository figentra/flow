---
"@figentra-oss/flow": patch
---

`init`, `sync`, `migrate`, `trace`, `adr`, `start` and `mcp` are ported from passthrough to the console engine
(STA-1945 SC-2): each declares its arguments and options, so `fflow <command> --help` lists them, and hands them to
the command's own `run` as before. Two differences: a flag a command does not declare is now refused (exit 2) instead
of ignored, and `fflow trace trace <dir> --json` writes the engine's `{ "ok", "data" }` document with the matrix as
`data`. `trace` also takes `--base <ref>` besides `--base=<ref>`, and `start` and `init` take `--opt=value`.
