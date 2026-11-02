<!-- Rendered by fflow from .flow/readme.yml (stackra preset, STA-1879). Edit the data file, then run `fflow readme`. -->

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/figentra/brand/raw/069bb209e8f2b79fe8378c8845030ec767da04c7/brands/flow/3d/stills/flow-3d-og-dark-en.png" />
    <img src="https://github.com/figentra/brand/raw/069bb209e8f2b79fe8378c8845030ec767da04c7/brands/flow/3d/stills/flow-3d-og-light-en.png" alt="Figentra Flow" width="640" />
  </picture>
</p>

<h1 align="center">Figentra Flow</h1>

<p align="center"><strong>Spec-driven development for agent teams: specs, approval stops, tasks, the gate, landing and releases.</strong></p>

<p align="center">
  <a href="https://github.com/figentra/flow/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/figentra/flow/actions/workflows/ci.yml/badge.svg?branch=main" /></a>
  <a href="https://github.com/figentra/flow/releases/latest"><img alt="Release" src="https://img.shields.io/badge/release-%40figentra--oss%2Fflow-blue" /></a>
  <a href="https://github.com/figentra/flow/blob/main/LICENSE"><img alt="Licence: MIT" src="https://img.shields.io/badge/licence-MIT-green" /></a>
  <a href="https://github.com/figentra/flow#status"><img alt="Status: In progress" src="https://img.shields.io/badge/status-In%20progress-orange" /></a>
  <a href="https://github.com/figentra/flow/blob/main/packages/figentra-flow/README.md"><img alt="Docs" src="https://img.shields.io/badge/docs-read-0a7bd6" /></a>
</p>

## What it is

Figentra Flow (`fflow`, alias `fflow`) is the spec CLI for Stackra repositories. It owns spec-driven
development end to end (ADR 0510), from `/flow-specify` to the landed change: the presets and templates, the eight
`flow-*` commands it renders for Claude Code and OpenCode, the `.flow/` folder, the gate on a box, landing, release
trains and releases. Adapters choose the tracker, runner, credentials and secrets per repository. Its `init` and
`sync` also install the files every Figentra repository shares, this README layout among them.

## Status

**In progress**: 0.1.0 is published and every Stackra repository runs it.

The states: **Live** (serving customers), **In progress** (being built), **Planned** (no build yet).

## Quick start

```sh
pnpm add -D @figentra-oss/flow    # from the Figentra registry: @figentra-oss:registry in .npmrc
pnpm exec fflow init      # .flow/ and the flow-* skills
pnpm exec fflow doctor    # checks Node, git, the configuration and the credentials
```

## Architecture at a glance

One pnpm workspace with one package, `packages/figentra-flow`: plain ESM JavaScript with JSDoc and no runtime
dependencies.

| Path                                  | What                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/figentra-flow/bin`          | the `fflow` dispatcher                                               |
| `packages/figentra-flow/src/commands` | one module per command (`init`, `sync`, `gate`, `land`, `train`, `release`…) |
| `packages/figentra-flow/src/adapters` | the tracker and runner adapters                                              |
| `packages/figentra-flow/assets/flow`  | the `neutral` and `stackra` presets and the base templates                   |
| `packages/figentra-flow/schema`       | the `flow.config.json` schema                                       |

## Development

```bash
pnpm install
pnpm verify
```

`pnpm verify` is the full check: CI and the gate run the same command.

Changes go through [Figentra Flow](https://github.com/figentra/flow), the `fflow` CLI.

Every branch and pull request carries a Linear `STA-` key.

| Step                          | Command                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| Spec the change               | `/flow-specify`, `/flow-clarify`, `/flow-plan`, `/flow-tasks` |
| Start a worktree for an issue | `fflow start STA-<n>`                                 |
| Run the gate on the branch    | `fflow gate run`                                      |
| Land the pull request         | `fflow land`                                          |
| See specs, worktrees and PRs  | `fflow status`                                        |
| Re-render this README         | `fflow readme`                                        |

## Docs and playground

- **Docs**: <https://github.com/figentra/flow/blob/main/packages/figentra-flow/README.md>

## Release and changelog

Every change that ships carries a changeset in `.changeset/`.

Merging the version pull request that Changesets opens cuts the release.

The notes are in [Releases][releases] and in each package's `CHANGELOG.md`.

[releases]: https://github.com/figentra/flow/releases

## Security

Report a vulnerability privately, as the [security policy][security] describes.

Never report one in a public issue or pull request.

[security]: https://github.com/figentra/flow/security/policy

## Licence

Released under the MIT licence. See [LICENSE](LICENSE).

---

<p align="center"><sub>Figentra Flow is made by Figentra Technologies L.L.C · <a href="https://figentra.com">figentra.com</a></sub></p>
