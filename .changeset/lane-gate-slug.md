---
"@figentra-oss/flow": patch
---

`fflow gate lane` finds a keyless branch's own spec by its slug, as `specDir` and the plan gate do (`chore/cancel-order` → `<key>-cancel-order`), so its tier floor reads that spec's tier instead of failing the branch as "no spec (trivial)". A slug that names several folders still counts as no spec, and a key in the branch name still decides alone.
