---
"@figentra-oss/flow": patch
---

`figentra-flow gate baseline` (STA-1942): in a repository whose main is red, a pull request passes when it fails no
task that passed on main. With `baseline` in the config, `sync` renders `figentra-flow-baseline.yml`; its `Baseline`
job runs the repository's tasks once with turbo's `--summarize`, saves the results as main's baseline on a push, and on
a pull request compares them with the baseline of the base commit or its nearest ancestor, failing closed when there is
none.
