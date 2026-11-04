# Contributing to Figentra Flow

Thanks for helping. This guide covers bug reports, small fixes and larger changes.

## Before you start

- **Bugs:** open an issue with the Flow version (`fflow --version`), the command you ran, what you expected and what
  happened. A failing command prints an error block. Paste it, with any tokens removed.
- **Security problems:** never in an issue. Follow [SECURITY.md](SECURITY.md).
- **Features and behaviour changes:** open an issue first and describe the problem. Flow is spec-driven, so a larger
  change starts as a spec under `.agents/specs/` that a maintainer approves before the code is written.
- **Small fixes** (a typo, a clear bug with a test) can go straight to a pull request.

## Set up

You need Node.js 24 and pnpm 12. [mise](https://mise.jdx.dev) installs the pinned versions from `mise.toml`.

```sh
git clone https://github.com/figentra/flow.git
cd flow
mise install        # optional: the pinned Node, pnpm, oxfmt and oxlint
pnpm install        # .npmrc maps the @figentra-oss and @stackra scopes to the Figentra registry (read without a token)
pnpm verify         # format check, lint, typecheck, tests and build
```

The repository is one pnpm workspace with one package, `packages/figentra-flow`. It is plain ESM JavaScript with JSDoc
types, checked by `tsc`.

| Command                                 | What it does              |
| --------------------------------------- | ------------------------- |
| `pnpm verify`                           | everything CI runs        |
| `pnpm test`                             | the tests (`node --test`) |
| `pnpm --filter @figentra-oss/flow test` | the package's tests only  |
| `pnpm typecheck`                        | `tsc --noEmit`            |
| `pnpm format` / `pnpm format:check`     | oxfmt                     |
| `pnpm lint`                             | oxlint                    |

## Making a change

1. **Branch from `main`.** Name the branch `<topic>/<short-slug>`, for example `fix/land-refs`.
2. **Write the test first.** Tests live in `packages/figentra-flow/src/__tests__/` and use `node:test`. They create
   temporary git repositories and never reach the network.
3. **Keep the file contract.** Every source file starts with a `Figentra Flow file contract:` comment: its purpose,
   boundary, runtime, governing contract and secrets. Update it when the file's job changes.
4. **Add a changeset** for anything that ships: `pnpm changeset`, then describe the change for users. Docs-only and
   test-only changes need none.
5. **Commit with [Conventional Commits](https://www.conventionalcommits.org):** `fix(land): …`, `feat(sync): …`,
   `docs: …`. Keep body lines to 100 columns.
6. **Open a pull request** against `main`. CI runs the format check, lint, typecheck, build and tests. Say what you
   changed, why, and how you tested it.

The git hooks (lefthook, installed by `pnpm install`) format and lint the staged files. Do not skip them.

## What a maintainer checks

- The change does what the issue or spec asked, and nothing else.
- Tests cover the new behaviour and the error paths.
- Anything Flow renders into other repositories (workflows, hooks, guard rules) stays safe to run on untrusted pull
  requests. See the security design in [SECURITY.md](SECURITY.md).
- Changes to `.github/workflows/`, release and other owner-only paths are reviewed by the repository owner.

## Licence

Flow is released under the [MIT licence](LICENSE). By contributing, you agree that your contribution is released under
the same licence.
