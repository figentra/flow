# Figentra Flow: agent guide

One pnpm workspace, one package: `packages/figentra-flow` (`figentra-flow`, binaries `figentra-flow` and `fflow`). Published publicly on npmjs as
`figentra-flow` from `.github/workflows/release.yml` (the owner's decision of 2026-10-31).

| Path                                           | What                                                                                                                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/figentra-flow/bin/figentra-flow.mjs` | the dispatcher: `figentra-flow <command>` runs `src/commands/<command>.mjs`'s `run(args)`                                                                                                             |
| `packages/figentra-flow/src/commands`          | `init`, `sync`, `gate`, `trace`, `parse`, `linear`, `start`, `clean`, `guard`, `land`, `train`, plus `gate-run` (the `run` mode of `gate`); each exports `run(args)` → exit code                      |
| `packages/figentra-flow/src/lib`               | `spec-parse` (pure parsers), `linear` and `net` (the Linear client), `git` and `workspace` (worktrees), `gate-post` (the box poster, copied into each gate job), `github` (`gh api` through `bot:gh`) |
| `packages/figentra-flow/assets`                | `specify/` (what `init` installs), `presets/stackra` (the preset source), the rendered `claude/skills/speckit-*` and `opencode/commands/speckit.*`                                                    |

## Rules

- Commands run in the repository they act on: `ROOT` is the working directory.
- Plain ESM JavaScript with JSDoc, no runtime dependencies; `tsc` checks it (`checkJs`) and emits the declarations.
- Tests are `node:test` files in `src/__tests__/`, next to their subjects; no network, no real Linear call.
- `assets/` are byte-for-byte copies of what `specify` renders in Stackra core; change them by re-copying, not by hand.
- Secrets: `figentra-flow linear` reads `LINEAR_AGENT_TOKEN` or `LINEAR_API_KEY` from the environment, which the calling
  repository's `infisical run` wrapper provides. Never read, print or commit a token.
- Worktrees live only in `.claude/worktrees/` (Stackra ADR 0503): make one with `figentra-flow start`, remove one with
  `figentra-flow clean`. Worktree tests use the local repository fixture in `src/__tests__/__fixtures__/`.
- Done = `pnpm verify` green. Conventional commits; a changeset for every package change.
