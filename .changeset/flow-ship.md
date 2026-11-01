---
"@figentra-oss/flow": minor
---

`figentra-flow ship <dev|staging>` ships the tip of the default branch by dispatching the product's Runway deploy workflow (`deploy.yml`, input `environment`), so the deploy runs in CI from a commit of main. It refuses production outright: production moves only by `runway promote <sha>`, and the owner approves it.
