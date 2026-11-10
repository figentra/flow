---
"@figentra-oss/flow": patch
---

The rendered `fflow-baseline.yml` takes `baseline.filters`, or `ci.filters` when it names none, on its default install and its tasks, so a member the gate leaves out (a Uniwind Pro mobile app with a licence quota, say) stays out of the baseline too. An `install` the config writes is kept as written. Without filters the workflow renders unchanged.
