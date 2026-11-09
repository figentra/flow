---
"@figentra-oss/flow": patch
---

The rendered gate and baseline workflows pin `actions/checkout` v7.0.1, which runs on Node 24; v4.4.0 ran on Node 20,
which GitHub deprecated. The other pinned actions (setup-node, upload-artifact, create-github-app-token, mise-action)
already run on Node 24.

The approval workflow's app-token step passes `client-id:` instead of `app-id:` (the same value), as
`create-github-app-token` now names it.
