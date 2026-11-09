---
"@figentra-oss/flow": patch
---

`fflow gate baseline check` prints its reason to the job log as well as the run's summary page. Two reasons used to
reach only the summary: no baseline at the base SHA or its nearest ancestors, and the table of tasks the change broke.
So in CI the check looked like a silent exit 1.
