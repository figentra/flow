---
"@figentra-oss/flow": minor
---

The rendered CI runs every member, not `--affected`, on a pull request that touches the workspace's build or test inputs (`.github/`, `flow.config.json`, `turbo.json(c)`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, the root `package.json`). A `Scope` step in Code and Integration decides it. `--affected` puts no member in scope for those files, so a change to how the gate tests passed on zero tasks (pay#230).
