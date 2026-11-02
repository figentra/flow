# Implementation Plan: Figentra Flow's baseline gate lands routine PRs while main is red

**Spec**: `.agents/specs/sta-1942-baseline-gate/spec.md` · **Linear**: STA-1942 · **Date**: 2026-11-02

**Input**: the spec, approved by the owner on 2026-11-02 as a freeze exception (relayed by the leader session). Brought
to the ADR 0502 design sections on 2026-11-03 (STA-2039) from the code that shipped in 0.2.2 and 0.2.3.

## Summary

A pure comparison (`src/lib/baseline.mjs`), a thin command around it (`gate baseline save|check`), and one more
workflow that `sync` renders when the config asks for it. The rest is the owner's: in each red-main repository,
`setup-merge-bot.sh --swap-required "Quality Gate=Baseline"` swaps the required check, keeping its App pin.

## Technical Context

- **Language**: plain ESM JavaScript with JSDoc, checked by `tsc`; Node 24; no runtime dependencies
- **Members**: figentra/flow `packages/figentra-flow` (`@figentra-oss/flow`)
- **Testing**: `node:test` on canned run summaries (trimmed from a real turbo 2.11.9 summary) and a stubbed `api`;
  no network. On the Mac only oxfmt and oxlint run; typecheck and tests run on box 1 and in CI.
- **Storage**: none; the baseline is a GitHub Actions artifact
- **Runtime target**: the `fflow` CLI, run by the rendered workflow on GitHub Actions

## Constitution Check

| Law                                   | Result | Note                                                                    |
| ------------------------------------- | ------ | ----------------------------------------------------------------------- |
| Boundaries (tier direction, ADR 0003) | N/A    | Figentra Flow is its own repository with one package                    |
| Secrets (ADR 0009)                    | PASS   | Flow reads none; setup steps live in the owner-only config              |
| Security                              | PASS   | baselines only from push runs on the default branch; fails closed; FR-6 |
| HTTP and events                       | N/A    | a CLI and a workflow, no endpoint or event                              |
| Tenancy                               | N/A    | no tenant data                                                          |
| Delegation                            | PASS   | one builder; the gate and an independent reviewer land it               |
| Not built yet (ADR 0011)              | PASS   | nothing on the list                                                     |
| Test placement (ADR 0022)             | PASS   | `src/__tests__/`                                                        |
| Versions and catalogs                 | PASS   | no dependency; the workflow's actions are pinned to commits             |
| Deploy modes (ADR 0076)               | PASS   | a developer tool, same everywhere                                       |
| Licence tier (ADR 0077)               | PASS   | free                                                                    |
| Docs and ADRs                         | PASS   | README and the changeset; no ADR needed                                 |

## Deploy modes

| Mode       | Behaviour                                                          |
| ---------- | ------------------------------------------------------------------ |
| SaaS       | same (a developer tool; the workflow runs on GitHub Actions)       |
| On-prem    | same (a developer tool; the workflow runs on GitHub Actions)       |
| Air-gapped | same: `compare` and `save` are offline; `check` needs GitHub's API |

## Correctness properties

- **P-001**: a task counts as passing only when it ran and exited 0, and `compare` passes only when the PR's failed set is a subset of main's, every task main ran also ran in the PR, every `mustPass` task is green and the failure count does not grow — Validates: FR-1, FR-3
- **P-002**: a baseline counts only when a `push` run on the default branch made it at that exact SHA, and with none found `check` fails closed — Validates: FR-2, FR-3
- **P-003**: the workflow is rendered only with `baseline` configured, its setup steps read back exactly as configured, its job is `Baseline`, and the summary calls it a merge gate — Validates: FR-4, FR-5
- **P-004**: every path under `.github/workflows/`, the baseline workflow's included, is owner-only — Validates: FR-6
- **P-005**: `sync` renames the old configuration once and refuses both at once, and the old binary prints one notice — Validates: FR-8

FR-7 is example-only: it is the list of tests.

## Architecture overview

Three pieces, one direction. `src/lib/baseline.mjs` is pure: a reader turns one tool's output into per-task results,
`compare` judges a PR's results against main's, `summaryTable` writes the Markdown, and `findBaseline` walks the base
SHA's ancestors through an injected `api`. `src/commands/gate-baseline.mjs` is the command (`gate.mjs` dispatches
`gate baseline` to it): `save` reads the newest run summary and writes `.fflow-gate/baseline.json`; `check` finds
main's baseline, downloads it with `gh run download` and compares. `src/lib/baseline-workflow.mjs` returns the
workflow text, which `render.mjs` adds to what `sync` writes when the configuration has `baseline`. On a push to the
default branch the workflow saves and uploads the artifact `fflow-baseline-<sha>`; on a pull request it saves and
checks.

## Components and responsibilities

| File                                     | Owns                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/lib/baseline.mjs` (new)             | `READERS.turbo`, `compare(base, pr, { mustPass })`, `summaryTable(result, from)`, `findBaseline`, `ANCESTORS` |
| `src/lib/baseline-workflow.mjs` (new)    | `baselineWorkflow({ tasks, install, setup, branch })`, `BASELINE_DEFAULTS`, the block-YAML setup steps        |
| `src/commands/gate-baseline.mjs` (new)   | `save` and `check`; `gate.mjs` dispatches `baseline` to it                                                    |
| `src/lib/render.mjs`                     | renders the workflow when `baseline` is configured; `migrateLegacy` performs the 0.2.2 rename                 |
| `src/lib/config.mjs` and the schema      | `baseline: { tasks, mustPass, install, setup, branch }`; reads the old config file name with a warning        |
| `src/lib/product.mjs`                    | `NAME` (`fflow`), `BASELINE_WORKFLOW`, `BASELINE_CHECK` ("Baseline"), the `LEGACY_*` names                    |
| `bin/fflow.mjs`, `bin/figentra-flow.mjs` | the binary, and the deprecated alias that prints one notice                                                   |

## Files and folders

- `packages/figentra-flow/src/lib/baseline.mjs` (new)
- `packages/figentra-flow/src/lib/baseline-workflow.mjs` (new)
- `packages/figentra-flow/src/commands/gate-baseline.mjs` (new), `packages/figentra-flow/src/commands/gate.mjs`
- `packages/figentra-flow/src/lib/render.mjs`, `packages/figentra-flow/src/lib/config.mjs`,
  `packages/figentra-flow/src/lib/product.mjs`, `packages/figentra-flow/schema/flow.config.schema.json`
- `packages/figentra-flow/bin/fflow.mjs`, `packages/figentra-flow/bin/figentra-flow.mjs`
- `packages/figentra-flow/src/__tests__/baseline.test.mjs` (new)
- `packages/figentra-flow/README.md`, `packages/figentra-flow/CHANGELOG.md` (0.2.2 and 0.2.3)

## Data models and migrations

`.fflow-gate/baseline.json`: `{ version: 1, sha, reader: "turbo", tasks: { "<pkg>#<task>": "pass" | "fail" | "skip" } }`.
No database. The only migration is the 0.2.2 rename: `sync` moves `figentra-flow.config.json` to `flow.config.json`
(and its `$schema`) and deletes the old `figentra-flow-approve.yml` and `figentra-flow-baseline.yml`.

## Contracts

- CLI: `fflow gate baseline save [--summary <file>] [--reader turbo]` and `fflow gate baseline check --base <sha>`.
  Exit codes: 0 passed, 1 blocked or no baseline, 2 a usage error (an unknown reader, a `--base` that is not 40 hex).
- Artifact: `fflow-baseline-<sha>`, kept 90 days, holding `baseline.json`.
- Search: the ancestors come from `GET /repos/{repo}/commits?sha=<base>&per_page=30`; then, per SHA,
  `GET /repos/{repo}/actions/artifacts?name=…`. A candidate counts only when it isn't expired, its
  `workflow_run.head_sha` is that SHA, its `head_branch` is the default branch, and `GET /actions/runs/{id}` says
  `event: push`. It is downloaded with `gh run download <run> -n <name>`.
- Configuration: `baseline.tasks` (default `lint typecheck test build`), `baseline.mustPass` (task-id globs),
  `baseline.install` (default `pnpm install --frozen-lockfile`), `baseline.setup` (steps, verbatim),
  `baseline.branch` (default `main`).
- The check: the rendered job is named `Baseline`.

## Error handling

`save` exits 1 when there is no run summary or it holds no task, and 2 for an unknown reader. `check` exits 2 for a
`--base` that is not a 40-hex SHA, 1 when `save` has not run, 1 when the artifact cannot be downloaded, and 1, closed,
when no baseline exists within the ancestors searched (the summary says how many). The workflow's task step ends in
`|| true`: failures are judged against main's baseline, not by the run's exit code.

## Security and tenancy

The workflow has `permissions: {}` at the top and, for its one job, `contents: read`, `actions: read` and
`id-token: write` (for a setup step's OIDC login). Checkout keeps no credentials, it uses no `pull_request_target`,
and every action Flow adds is pinned to a commit. Flow reads no secret; the job's `GITHUB_TOKEN` finds and downloads
the artifact. A baseline counts only from a push run on the default branch at the exact SHA, so a PR run cannot plant
one. `mustPass` tasks (tenant isolation, authz, secrets, licence tests) never ride on main's debt. The workflow is
owner-only, so the merge bot never approves a PR that rewrites its own Baseline job. No tenant or personal data.

## Testing strategy

`packages/figentra-flow/src/__tests__/baseline.test.mjs`, on canned summaries and a stubbed GitHub, proves AC-001 (the
reader), AC-002 to AC-007 (`save`, `check`, `compare`, `findBaseline`, the summary), AC-008 (`sync` renders the
workflow only with `baseline`, setup steps verbatim), AC-010 (the rename) and AC-011 (the old binary).
`packages/figentra-flow/src/__tests__/stewards.test.mjs` proves AC-009 (workflow paths are owner-only, in any case).

## Rollout

Release Flow 0.2.2 (0.2.3 writes the setup steps as block YAML). In each red-main repository, the wave PR adds
`baseline` to the config (with that repository's setup steps) and syncs, which renders the workflow. Once main has run
it once (so a baseline exists), the owner runs
`setup-merge-bot.sh --repos <red-main repos> --swap-required "Quality Gate=Baseline" --apply`.
