---
"@figentra-oss/flow": minor
---

`ci.int.postgres: false` renders the `Integration` job without the Postgres service container and its database environment, for integration suites that start their own Postgres on the runner's Docker (Stackra's `usePostgres()` through Testcontainers). Without it, the job renders as before.
