---
"@figentra-oss/flow": minor
---

`fflow` runs on `@stackra/console` 0.7.1, the one CLI engine of every Figentra CLI (STA-1945 FR-31, STA-1966).
`@stackra/console` and `@stackra/validation` are now runtime dependencies (ADR 0506 decision 8, owner 2026-11-03),
replacing NFR-1's "no runtime dependency, an optional peer"; they come from the Stackra registry, read without a token
(`@stackra:registry` mapped in `.npmrc`). Only the CLI layer loads them: the governance core (gate, approve, land,
record, lock, baseline) imports nothing from `@stackra/*`, and `fflow guard`, the agent hook, dispatches before the
engine loads. `fflow` alone prints the banner, the version and the commands by group; `fflow <command> --help` prints
its usage and runs nothing; a mistyped command names the closest one and exits 2; a failure is one error block with
the fix and a docs link, and a configuration refusal still exits 2. `doctor` is a grouped checklist (Machine, Repo,
Flow, GitHub) with a summary line, and a repository with no `origin` and no `credentials` block is information, not a
warning. `status` prints tables for specs, worktrees, PRs and sessions, listing every spec problem under `--verbose`.
**Breaking** for scripts reading `--json`: `doctor --json`, `status --json` and `status --metrics --json` now write
one document, `{ "ok", "data" }`. `doctor --json` drops its `schema: "fflow.doctor/1"` and `checks` fields: the check
rows are `data` (each keeps `id`, `ok`, `detail` and `fix`, replaces `warn` and `info` with `status`, and gains `name` and `group`); `status --json` puts the
`fflow.status/1` snapshot in `data`, and `status --metrics --json` the metrics.
`init` writes a starter `flow.config.json` when there is none. `spec paths` and `gate dir` fall back to the spec folder
whose slug is exactly a keyless branch's last segment, and their hints name `gate dir --key <key>` instead of sending
you in a loop. The other commands keep their flags and output, routed through the engine as passthrough until they
are ported: `app`, `clean`, `gate`, `guard`, `init`, `land`, `linear`, `mcp`, `migrate`, `parse`, `readme`, `release`,
`ship`, `spec`, `start`, `sync`, `team`, `trace` and `train`. `pnpm-lock.yaml` is regenerated on the box with this
dependency change.
