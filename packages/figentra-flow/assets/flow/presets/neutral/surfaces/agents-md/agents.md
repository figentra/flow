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

## Find the task's context

- Start with `fflow context --path <repository-relative-path> --json` (or repository search when Flow is unavailable).
  Read README and applicable ancestor/member AGENTS instructions, including overrides, before editing. Explicitly read
  relevant `.agents/rules/` files; do not assume every client automatically loads links or scoped rules.
- Locate the owning package/service, its current contract and decisions, implementation, example and tests. Follow
  exports, callers, fixtures and generator sources for shared changes. An index is navigation, not verification.
- For collection work use `fflow context --all --query <phrase>`; each checkout keeps its own revision and authority.
  A standalone clone must use its pinned framework/preset guidance, not require a sibling checkout or private notes.
- Read a skill's `SKILL.md` only when its trigger fits; check prerequisites and version compatibility before following it.
- Keep README at meaningful package, service or component-family boundaries. Explain purpose, public entry points,
  a working example and allowed verification. Keep component contracts in types and examples; do not add one README
  or AGENTS file per component, function or ordinary folder. Preserve existing mandatory member guidance.
- Keep cross-cutting capabilities in the existing catalogue/guide: owner of each step, contracts, consumers, relevant
  authorization/failure boundaries and tests. Keep decisions in ADRs, procedures in skills and operational steps in runbooks.
- Distinguish accepted decisions, checkout implementation, passing checks at a revision, releases and deployments.
  Report missing evidence and conflicting sources. Verify only in the environment the repository permits.
