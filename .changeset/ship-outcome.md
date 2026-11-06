---
"@figentra-oss/flow": minor
---

`fflow ship` records what a Runway deploy did (STA-2137). In a repository with a `runway.yaml` it dispatches with
`return_run_details`, so GitHub answers with the run it started, and writes that run id into the record's new `ships`
list at once. When GitHub names no run, it notes the deploy workflow's runs before it dispatches and finds a new run
created after the dispatch whose deploy job names the environment (a running run with no jobs yet is taken only
provisionally; a completed run naming another environment or none never is), so a ship never adopts another ship's or
the owner's promote run. It follows the run for up to `--wait` minutes (default 10), downloads its
`runway-outcome-<env>` artifact through the configured GitHub credentials and reads it in memory:
`runway-outcome.json` (`runway.outcome/v1`) decides the outcome (`deployed` for the environment and the run's own
revision is a success; `failed`, `cancelled` or a mismatch is a failure, with the reason), and `deploy-<env>.json` adds
the KV rows and uploads written, held apps and any smoke or rollback field. The `ship` stage is done only on success,
active while the run is pending (exit 4) and failed otherwise; a run whose artifact list has no outcome artifact is
`no outcome artifact`, while a GitHub error listing or downloading it keeps the ship pending. `fflow ship <env>
--resolve` dispatches nothing: it re-reads the task record's pending ship and writes its outcome back, committed and
pushed. `fflow status` shows each record's newest ship in its Ships table, re-read but not written (Runway repositories
only; `status --json` of other repositories is unchanged). `fflow ledger` shows each ship row's own outcome.
Repositories without `runway.yaml` ship as before.
