# Figentra Flow: agent guide

One pnpm workspace, one package: `packages/figentra-flow` (`@figentra-oss/flow`, binary `fflow`; `figentra-flow` is its
deprecated alias). Published from `.github/workflows/release.yml` (the owner's decision of 2026-10-31).

| Path                                   | What                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/figentra-flow/bin/fflow.mjs` | the dispatcher: `fflow <command>` runs `src/commands/<command>.mjs`'s `run(args)`                                                                                                                                                                                                                                                                                                                                |
| `packages/figentra-flow/src/commands`  | `init`, `sync`, `migrate`, `spec`, `gate`, `trace`, `parse`, `linear`, `start`, `clean`, `guard`, `land`, `train`, `team`, `status`, `mcp`, plus `gate-run` (the `run` mode of `gate`); each exports `run(args)` → exit code                                                                                                                                                                                     |
| `packages/figentra-flow/src/lib`       | `spec-parse` (pure parsers), `linear` and `net` (the Linear client), `git` and `workspace` (worktrees), `gate-post` (the box poster, copied into each gate job), `github` (`gh api` through `bot:gh`), `owner-only`, `required-checks`, `approve-check` and `approve-workflow` (the owner-only list, trusted required checks, the approval check the workflow runs from the package, and the workflow, STA-1856) |
| `packages/figentra-flow/assets`        | `flow/presets/{neutral,stackra}` (templates, the ten `flow-*` commands, the steward `agents/`, the `rules/` (the worktree rule, STA-1871), and `preset.yml`'s approval secret names; stackra also carries core's role agents, rules, `skills/`, `reference/`, `routing.yaml` and `models.yaml`, STA-1945), `flow/templates` (checklist, constitution); spec-kit-derived files carry `derived-from` (ADR 0510)    |

## Rules

- Commands run in the repository they act on: `ROOT` is the working directory.
- Plain ESM JavaScript with JSDoc, no runtime dependencies; `tsc` checks it (`checkJs`) and emits the declarations.
- Tests are `node:test` files in `src/__tests__/`, next to their subjects; no network, no real Linear call.
- `assets/flow/` is Flow's own: change a preset's template or command there; `fflow sync` renders it, and the `derived-from` line stays until a file is rewritten from scratch (ADR 0510).
- Secrets: `fflow linear` reads `LINEAR_AGENT_TOKEN` or `LINEAR_API_KEY` from the environment, which the calling
  repository's `infisical run` wrapper provides. Never read, print or commit a token.
- Worktrees live only in `.claude/worktrees/` (Stackra ADR 0503): make one with `fflow start`, remove one with
  `fflow clean`. Worktree tests use the local repository fixture in `src/__tests__/__fixtures__/`.
- Done = CI green after the merge, its `test` job included ("Tests run later" below). Conventional commits; a changeset for every package change.

## Tests run later: merge now, label `needs-testing`

Owner decision 2026-11-03 (STA-2083, replaces "Tests run on the box"): nothing waits on tests before it lands. No box
run before the merge and no waiting on CI: open the pull request and merge it right away
(`gh pr merge --squash --admin`), then add the Linear label `needs-testing` to its STA issue and a
`Needs testing: <what to run>` line to the pull request body. The tester lane later runs those tests on the box
(`stackra testbed run "FLOW STA-n" . "pnpm verify"`) and removes the label. Since 2026-11-04 (owner default O4) CI's
`test` job runs the package's tests on every pull request and push to main; it is not a required check, so a red
`test` never blocks a merge, but it is fixed before the work counts as done. Nothing installs or tests on a
workstation.
