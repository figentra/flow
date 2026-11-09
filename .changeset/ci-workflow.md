---
"@figentra-oss/flow": minor
---

`fflow sync` now renders the standard CI workflow, `.github/workflows/fflow-ci.yml`, from a new `ci` block in `flow.config.json`, with one required check, `Quality Gate`, over the `Code` job and, when configured, the `Integration` job with its Postgres service. The block sets the turbo tasks for pull requests (run with `--affected`) and for main and the nightly run, gen, commitlint on the pull request title, the turbo remote cache, optional jobs and the OSV-Scanner scan, and falls back to `baseline` for the setup and install steps.
