---
"@figentra-oss/flow": minor
---

The `github-actions` runner's verdict now comes from main (STA-1945, the L2 design's PR F). The gate workflow
`fflow init --runner github-actions` writes runs on `pull_request` (opened, synchronize, reopened,
ready_for_review). It has one `check` job with `contents: read`, a credential-free checkout of the head and no
secret. The `post` job, the artifact upload and the `FFLOW_GATE_*` repository secrets are gone.

With that runner and `secrets.oidc`, `fflow sync` adds a `verdict` job to `fflow-approve.yml`. It runs on the gate
workflow's `workflow_run`, in the `fflow-approve` environment, one at a time for each head. It holds `id-token:
write` and no App secret. It runs the new `src/lib/verdict.mjs` from the integrity-checked tarball. That script
checks the run's repository, path, event, head repository and open PR. It reads the `check` job's conclusion (a
missing job is a failure), and it posts `fflow/gate` with a `verdict` (`statuses: write`) Figentra Flow App token
minted over OIDC. A PR that changes `.github/workflows/**` gets `pending` until the owner approves that head. Every
job in that file then runs only on the default branch, and only while `FIGENTRA_AUTOMATION` is `on` or
`merge-only` (unset is frozen). Without the runner or `secrets.oidc`, the file is unchanged byte for byte.

`fflow gate run` on this runner dispatches nothing. It follows the PR's run and maps the gate App's `fflow/gate`
status to 0 or 1, or to 4 when the status is pending or never appears.
