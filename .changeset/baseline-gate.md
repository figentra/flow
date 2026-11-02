---
"@figentra-oss/flow": patch
---

The command is now `fflow` (owner, 2026-11-02). `figentra-flow` still works for this release and prints one notice.
`sync` renames `figentra-flow.config.json` to `flow.config.json` once (it refuses when both exist) and replaces the
`figentra-flow-*.yml` workflows with `fflow-approve.yml`; the approval environment is `fflow-approve` with the secrets
`FFLOW_APPROVER_APP_ID` and `FFLOW_APPROVER_PRIVATE_KEY` (set them with the owner's setup script, then delete the old
environment). The package name, `@figentra-oss/flow`, does not change.

`fflow gate baseline` (STA-1942): in a repository whose main is red, the `Baseline` check lets a pull request land
when it makes nothing worse than main: no new failure, no task dropped or skipped, no red `baseline.mustPass` task,
and no more failures than main. A missing baseline fails closed. With `baseline` in the config, `sync` renders
`fflow-baseline.yml`. It is a merge gate, not a release certificate.
