---
"@figentra-oss/flow": minor
---

`fflow mcp --studio` gains `repo_create`: a new product's private repository `owner/name` from a template repository,
through a repository-host port (the Figentra GitHub App) on behalf of a person, refused for a taken name, a
repository that is not a template and a malformed name or owner. The port's only driver is an in-memory fake until
the GitHub App and its keys exist.
