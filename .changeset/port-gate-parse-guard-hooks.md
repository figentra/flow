---
"@figentra-oss/flow": patch
---

Port `gate`, `parse`, `guard` and `hooks run` from passthrough to declared commands, so their `--help` lists their
arguments and options. Each still runs the same command with the same flags.
