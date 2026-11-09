<!-- Rendered by fflow from .flow/readme.yml (neutral preset). Edit the data file, then run `fflow readme`. -->

{{#banner}}
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="{{dark}}" />
    <img src="{{light}}" alt="{{name}}" width="640" />
  </picture>
</p>

{{/banner}}
{{^banner}}
<h1 align="center">{{name}}</h1>

{{/banner}}
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

The states: **Live** (in use), **In progress** (being built), **Planned** (no build yet).

## Quick start

{{quickstart}}

## Architecture at a glance

{{architecture}}

## Development

{{#development}}
{{development}}
{{/development}}
{{^development}}
Install the dependencies with the repository's package manager, then run the same checks CI runs before you open a
pull request.
{{/development}}

Changes go through `fflow`, a spec-first workflow.

| Step                          | Command                                        |
| ----------------------------- | ---------------------------------------------- |
| Spec the change               | `/flow-specify`, `/flow-clarify`, `/flow-plan` |
| Start a worktree for an issue | `fflow start <key>`                            |
| Run the gate on the branch    | `fflow gate run`                               |
| Land the pull request         | `fflow land`                                   |
| See specs, worktrees and PRs  | `fflow status`                                 |
| Re-render this README         | `fflow readme`                                 |

## Contributing

Issues and pull requests are welcome. Open an issue before a large change, so the approach is agreed before the work
starts.

Each branch and pull request names its issue's key, each commit is a Conventional Commit, and a pull request lands
once its checks pass and its review is approved.

## Docs

{{#links}}
- **{{label}}**: <{{url}}>
{{/links}}
{{^links}}
This README is the entry point.
{{/links}}

## Release and changelog

{{#release}}
{{release}}
{{/release}}
{{^release}}
The release notes are in [Releases][releases].

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
{{licence}}.
{{#licenceFile}}

See [LICENSE](LICENSE).
{{/licenceFile}}
{{/mit}}
