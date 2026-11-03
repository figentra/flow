---
"@figentra-oss/flow": minor
---

The approval check judges a red main against its recorded baseline (STA-1945 FR-22). A required check that fails on the
PR's head and, from its trusted source, concluded `failure` on the commit that left main's nearest baseline too is a
pre-existing failure, not a new one: the PR is approved when the ruleset requires the `Baseline` check and it is green on
the head (it compares each task, a newly reached failure excepted). A check that passed, never ran, or was only
cancelled or timed out on the baseline still refuses, and with no baseline every required check must be green, as
before. Every other refusal is unchanged. The approval names the baseline's SHA and the checks it tolerated.

The tolerance is per check, so a red-main repository's ruleset may require beside `Baseline` only checks that run no
more than its `baseline.tasks`; any other required check must be green on main. `fflow/gate` runs the whole check
command and is never tolerated, so such a repository requires `Baseline` instead of it. The rendered `fflow-approve.yml`
is unchanged; it already reads actions, checks and statuses.
