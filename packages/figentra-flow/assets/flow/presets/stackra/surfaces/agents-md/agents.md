# {{name}}

{{#tagline}}
{{tagline}}
{{/tagline}}

{{#what}}
## What it is

{{what}}
{{/what}}

{{#architecture}}
## Architecture

{{architecture}}
{{/architecture}}

{{#facts}}
## This repository

{{facts}}
{{/facts}}

## How work flows

Every change goes through Figentra Flow (`fflow`, the {{preset}} preset). Specs live in `{{specs}}/`.

{{#tracker}}
- Every branch and pull request carries a {{kind}} key{{#team}} (`{{team}}-<n>`){{/team}}; branches are
  `{{branchPrefix}}/<key>-<slug>`.
{{/tracker}}
- Spec the change with `/flow-specify`, `/flow-clarify` and `/flow-plan` (it writes the tasks too), then build it
  with `/flow-implement`.
- Work in a worktree under `.claude/worktrees/<name>/`, made with `fflow start <key>`; never next to the repository.
- Land with `fflow land <pr>`: it waits for the gate and removes the worktree after the merge.

## Rules

- Commits are Conventional Commits with a `Refs: <key>` line. Never `--no-verify`, never `LEFTHOOK=0`.
- Secrets are named, never written: no value in a file, a commit, a log or a message.
- The git hooks run the mise-pinned oxfmt and oxlint (`mise exec npm:oxfmt -- oxfmt <files>`), so a commit needs no
  install; where mise is missing they are skipped and CI checks.
- This file, `CLAUDE.md`, `lefthook.yml`, `.mcp.yaml` and the agent setup are rendered by `fflow sync`. Do not edit
  them: change `.flow/overrides/` or `flow.config.json`, run `fflow sync`, and `fflow check` shows any drift.
