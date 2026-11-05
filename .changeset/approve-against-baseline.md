---
"@figentra-oss/flow": minor
---

The approval check can judge a red main against its recorded baseline (STA-1945 FR-22), and it fails safe: it excuses
nothing unless the config's new `approve.tolerate` lists the check. That list is empty by default. A required check
that fails on the PR's head is a pre-existing failure, not a new one, only when all of these hold: the list names its
context; from its trusted source, it concluded `failure` on the commit that left main's nearest baseline too; and the
ruleset requires the `Baseline` check and it is green on the head (it compares each task, a newly reached failure
excepted). An unlisted check, or one that passed, never ran, or was only cancelled or timed out on the baseline, still
refuses. With no baseline or an empty list every required check must be green, as before. Every other refusal is
unchanged. The approval names the baseline's SHA and the checks it tolerated.

The tolerance is per check, so list only checks that run no more than `baseline.tasks`. `Baseline` and `fflow/gate`
(which runs the whole check command) are never tolerated: the schema refuses a list naming either, `sync` refuses to
render it, and the check refuses it. `sync` renders the list into `fflow-approve.yml` as `TOLERATE`, beside
`OWNER_ONLY_EXTRA`, in the dispatched job and in the event lane's jobs alike, so a `fflow:land` request is judged
the same way. A `TOLERATE` that is not a JSON list of names refuses the approval, and an unset one is the empty
list. Run `fflow sync` after upgrading.
