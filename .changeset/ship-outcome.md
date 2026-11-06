---
"@figentra-oss/flow": minor
---

`fflow ship` records what a Runway deploy did (STA-2137). In a repository with a `runway.yaml` it follows the run the
dispatch started (by workflow, branch, sha and creation time) for up to `--wait` minutes (default 10), downloads the
run's `runway-outcome` artifact through the configured GitHub credentials, reads the deploy manifest
(`deploy-<env>.json`) from the zip in memory, and appends to the record's new `ships` list the environment, deployed
revision, run URL and conclusion, KV rows and uploads written, and any smoke or rollback field. The `ship` stage is
done only on success, active while the run is pending (exit 4) and failed otherwise; a run without the artifact is
`no outcome artifact`. `fflow status` shows a Ships table (re-reading a pending run) and `fflow ledger` the outcome.
Repositories without `runway.yaml` ship as before.
