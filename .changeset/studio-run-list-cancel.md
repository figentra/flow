---
"@figentra-oss/flow": minor
---

The Studio's MCP surface (`fflow mcp --studio`) gains `run_list`, a spec's build runs newest first with an optional
status and a cursor (at most 100 per page, 20 by default), and `run_cancel`, which stops a queued or running run and
records who cancelled it. Both act on behalf of a person (`onBehalfOf`), never a service; the build-sandbox port
gains `list` and `cancel`, and a run's states gain `cancelled`.
