---
"@figentra-oss/flow": minor
---

`fflow ship` records what a Runway deploy did (STA-2137). In a repository with a `runway.yaml` it notes the deploy
workflow's runs before it dispatches, then follows only a new run whose deploy job names the environment (so a ship
never adopts another ship's run), for up to `--wait` minutes (default 10). It downloads the run's
`runway-outcome-<env>` artifact through the configured GitHub credentials and reads it in memory:
`runway-outcome.json` (`runway.outcome/v1`) decides the outcome (`deployed` for the environment and the dispatched
revision is a success; `failed`, `cancelled` or a mismatch is a failure, with the reason), and `deploy-<env>.json` adds
the KV rows and uploads written, held apps and any smoke or rollback field. The entry goes into the record's new `ships`
list. The `ship` stage is done only on success, active while the run is pending (exit 4) and failed otherwise; a run
without the artifact is `no outcome artifact`. A pending ship keeps what it needs to find its run, which `fflow status`
re-reads in its Ships table (Runway repositories only; `status --json` of other repositories is unchanged).
`fflow ledger` shows each ship row's own outcome. Repositories without `runway.yaml` ship as before.
