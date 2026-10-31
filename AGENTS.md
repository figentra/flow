# Vellum: agent guide

One pnpm workspace, one package: `packages/vellum` (`@stackra/vellum`, binary `vellum`). Published only to the Stackra
registry (ADR 0453); never npmjs.

| Path                             | What                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/vellum/bin/vellum.mjs` | the dispatcher: `vellum <command>` runs `src/commands/<command>.mjs`'s `run(args)`                                                                 |
| `packages/vellum/src/commands`   | `init`, `sync`, `gate`, `trace`, `parse`, `linear`; each exports `run(args)` → exit code                                                           |
| `packages/vellum/src/lib`        | `spec-parse` (pure parsers), `linear` and `net` (the Linear client and network layer)                                                              |
| `packages/vellum/assets`         | `specify/` (what `init` installs), `presets/stackra` (the preset source), the rendered `claude/skills/speckit-*` and `opencode/commands/speckit.*` |

## Rules

- Commands run in the repository they act on: `ROOT` is the working directory.
- Plain ESM JavaScript with JSDoc, no runtime dependencies; `tsc` checks it (`checkJs`) and emits the declarations.
- Tests are `node:test` files in `src/__tests__/`, next to their subjects; no network, no real Linear call.
- `assets/` are byte-for-byte copies of what `specify` renders in Stackra core; change them by re-copying, not by hand.
- Secrets: `vellum linear` reads `LINEAR_AGENT_TOKEN` or `LINEAR_API_KEY` from the environment, which the calling
  repository's `infisical run` wrapper provides. Never read, print or commit a token.
- Done = `pnpm verify` green. Conventional commits; a changeset for every package change.
