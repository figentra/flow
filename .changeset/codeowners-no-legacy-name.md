---
"@figentra-oss/flow": patch
---

The rendered `.github/CODEOWNERS` no longer names `/figentra-flow.config.json`. `sync` renames that pre-0.2.2 file before
it writes CODEOWNERS, so the line only showed a retired name; `land` and the approval check still treat the old file as
owner-only.
