---
"@figentra-oss/flow": minor
---

`fflow mcp --studio` adds the Studio's write surface: `spec_create` writes a Draft spec from the template for an issue
key, naming the person it was created for; `run_start` hands a tasked, approved spec to the build sandbox in the EU or
US region; `run_status` reads a run back. Every call names the person it acts for (`onBehalfOf`, a user or principal
id, never a service), and Flow holds no service key. The build sandbox is a port with an in-memory fake driver for now.
Without `--studio` the server is unchanged.
