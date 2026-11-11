---
"@figentra-oss/flow": patch
---

The rendered `fflow-ci.yml` runs the gate again when a draft pull request is marked ready for review, as core's and
pay's hand-written CI do, so a check that reads the draft flag (core's spec gate) sees the ready state.
