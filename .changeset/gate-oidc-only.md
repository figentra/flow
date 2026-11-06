---
"@figentra-oss/flow": patch
---

With `secrets.oidc`, `fflow gate run` no longer posts `fflow/gate` or the gate comment from a box or a workstation:
it runs the check, records the verdict and says the status comes only from `fflow-approve.yml`'s `verdict` job.
It refuses (exit 2, nothing recorded) when that job is not rendered for the configuration (a runner other than
`github-actions`) or with `--box`. Repositories without `secrets.oidc` keep the box poster. A test pins that no path
writes the gate with a user's token.
