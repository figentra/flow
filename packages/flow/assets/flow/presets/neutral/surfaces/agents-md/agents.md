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

Every change goes through `fflow`, a spec-first workflow (the {{preset}} preset). Specs live in `{{specs}}/`.

{{#tracker}}
- Every branch and pull request carries a {{kind}} key{{#team}} (`{{team}}-<n>`){{/team}}; branches are
  `{{branchPrefix}}/<key>-<slug>`.
{{/tracker}}
- Spec the change with `/flow-specify`, `/flow-clarify` and `/flow-plan` (it writes the tasks too), then build it
  with `/flow-implement`.
- Work in a worktree under `.claude/worktrees/<name>/`, made with `fflow start <key>`; never next to the repository.
- Land with `fflow land <pr>`: it waits for the gate and removes the worktree after the merge.

## Rules

- Commits are Conventional Commits with a `Refs: <key>` line. Never skip the git hooks (`--no-verify`).
- Secrets are named, never written: no value in a file, a commit, a log or a message.
- This file, `CLAUDE.md`, `lefthook.yml`, `.mcp.yaml` and the agent setup are rendered by `fflow sync`. Do not edit
  them: change `.flow/overrides/` or `flow.config.json`, run `fflow sync`, and `fflow check` shows any drift.
