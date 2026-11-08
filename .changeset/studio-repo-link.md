---
"@figentra-oss/flow": minor
---

`fflow mcp --studio` gains `repo_link`: it links a repository (`owner/name`) to its tracker project, on behalf of a
person, through a project-link port (the Linear project's links). Linking the same repository again answers the existing
link; an unknown project or repository, a malformed name and a service caller are refused. The port's only driver is
an in-memory fake until the Linear driver is wired with its credentials.
