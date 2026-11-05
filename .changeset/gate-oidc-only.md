---
"@figentra-oss/flow": patch
---

With `secrets.oidc`, `fflow gate run` no longer posts `fflow/gate` or the gate comment from a box or a workstation:
it runs the check, records the verdict and says the status comes only from `fflow-approve.yml`'s `verdict` job.
Repositories without `secrets.oidc` keep the box poster. A test pins that no path writes the gate with a user's token.
