---
"@figentra-oss/flow": minor
---

`fflow` runs on `@stackra/console` 0.6.1, the one CLI engine of every Figentra CLI (STA-1945 FR-31, STA-1966), taken
as an optional peer: Flow adds no runtime dependency, and without `@stackra/console` and `@stackra/validation` (from the
Stackra registry, `@stackra:registry` mapped in `.npmrc`) every command runs as before, `doctor` and `status` printing
the same checklist and tables as plain text; `fflow guard` never loads the engine. With it, `fflow`
alone prints the banner, the version and the commands by group; `fflow <command> --help` prints its usage and runs
nothing; a mistyped command names the closest one and exits 2; a failure is one error block with the fix and a docs
link, and a configuration refusal still exits 2. `doctor` is a grouped checklist (Machine, Repo, Flow, GitHub) with a
summary line, and a repository with no `origin` and no `credentials` block is information, not a warning. `status` prints tables for
specs, worktrees, PRs and sessions, listing every spec problem under `--verbose`. Breaking for scripts: `doctor --json`,
`status --json` and `status --metrics --json` now write `{ "ok", "data" }`, with the check rows, the `fflow.status/1`
snapshot and the metrics as `data`.
`init` writes a starter `flow.config.json` when there is none. `spec paths` and `gate dir` fall back to the spec folder
whose slug is exactly a keyless branch's last segment, and their hints name `gate dir --key <key>` instead of sending you in a loop. The
other commands keep their flags and output, routed through the engine as passthrough until they are ported.
