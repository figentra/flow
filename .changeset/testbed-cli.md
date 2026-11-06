---
"@figentra-oss/flow": patch
---

The stackra preset's ci-steward and flow-gate name `testbed run` (the `testbed` CLI from `@figentra/testbed`, ADR
0522), as `@stackra/flow-preset` does; the README's runner example says the same. A gate shard stopped by Ctrl-C or
SIGTERM (exit 130) is an infrastructure failure like 73 and 75: it decided nothing about the code, so nothing is posted
and the gate is run again.
