<!-- Rendered by fflow from .flow/readme.yml (stackra preset, STA-1879). Edit the data file, then run `fflow readme`. -->

{{#banner}}
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="{{dark}}" />
    <img src="{{light}}" alt="{{name}}" width="640" />
  </picture>
</p>

{{/banner}}
<h1 align="center">{{name}}</h1>

<p align="center"><strong>{{tagline}}</strong></p>

<p align="center">
{{#badges}}
  <a href="{{href}}"><img alt="{{alt}}" src="{{src}}" /></a>
{{/badges}}
</p>

## What it is

{{what}}

## Status

**{{status}}**{{#statusNote}}: {{statusNote}}{{/statusNote}}

The states: **Live** (serving customers), **In progress** (being built), **Planned** (no build yet).

## Quick start

{{quickstart}}

## Architecture at a glance

{{architecture}}

## Development

{{#development}}
{{development}}
{{/development}}
{{^development}}
```bash
pnpm install
pnpm verify
```

`pnpm verify` is the full check: CI and the gate run the same command.
{{/development}}

Changes go through [Figentra Flow](https://github.com/figentra/flow), the `fflow` CLI.

Every branch and pull request carries a Linear `STA-` key.

| Step                          | Command                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| Spec the change               | `/flow-specify`, `/flow-clarify`, `/flow-plan`                |
| Start a worktree for an issue | `fflow start STA-<n>`                                 |
| Run the gate on the branch    | `fflow gate run`                                      |
| Land the pull request         | `fflow land`                                          |
| See specs, worktrees and PRs  | `fflow status`                                        |
| Re-render this README         | `fflow readme`                                        |

## Docs and playground

{{#links}}
- **{{label}}**: <{{url}}>
{{/links}}
{{^links}}
There is no docs site or playground yet. This README is the entry point.
{{/links}}

## Release and changelog

{{#release}}
{{release}}
{{/release}}
{{^release}}
Every change that ships carries a changeset in `.changeset/`.

Merging the version pull request that Changesets opens cuts the release.

The notes are in [Releases][releases] and in each package's `CHANGELOG.md`.

[releases]: {{github}}/releases
{{/release}}

## Security

Report a vulnerability privately, as the [security policy][security] describes.

Never report one in a public issue or pull request.

[security]: {{github}}/security/policy

## Licence

{{#mit}}
Released under the MIT licence. See [LICENSE](LICENSE).
{{/mit}}
{{^mit}}
{{licence}}. Copyright © Figentra Technologies L.L.C. All rights reserved.
{{#licenceFile}}

See [LICENSE](LICENSE).
{{/licenceFile}}
{{/mit}}

---

<p align="center"><sub>{{name}} is made by Figentra Technologies L.L.C · <a href="https://figentra.com">figentra.com</a></sub></p>
