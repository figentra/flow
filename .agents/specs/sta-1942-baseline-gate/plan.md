# Implementation Plan: Figentra Flow's baseline gate lands routine PRs while main is red

**Spec**: `.agents/specs/sta-1942-baseline-gate/spec.md` · **Linear**: STA-1942 · **Date**: 2026-11-02

**Input**: the spec, approved by the owner on 2026-11-02 as a freeze exception (relayed by the leader session).

## Summary

A pure comparison (`src/lib/baseline.mjs`), a thin command around it (`gate baseline save|check`), and one more
workflow that `sync` renders when the config asks for it. The rest is the owner's: in each red-main repository,
`setup-merge-bot.sh --swap-required "Quality Gate=Baseline"` swaps the required check, keeping its App pin.

## Technical Context

- **Language**: plain ESM JavaScript with JSDoc, checked by `tsc`; Node 24; no runtime dependencies
- **Testing**: `node:test` on canned run summaries (trimmed from a real turbo 2.11.9 summary) and a stubbed `api`;
  no network. On the Mac only oxfmt and oxlint run; typecheck and tests run on box 1 and in CI.

## Components

| File                                   | Change                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/lib/baseline.mjs` (new)           | `READERS.turbo`, `compare(base, pr)`, `summaryTable(result)`, `findBaseline({ api, … })` |
| `src/lib/baseline-workflow.mjs` (new)  | `baselineWorkflow({ tasks, install, setup, branch })`, the workflow text                 |
| `src/commands/gate-baseline.mjs` (new) | `save` and `check`; `gate.mjs` dispatches `baseline` to it                               |
| `src/lib/render.mjs`                   | renders the workflow when `baseline` is configured                                       |
| `src/lib/config.mjs` and the schema    | `baseline: { tasks, install, setup, branch }`                                            |
| `src/lib/product.mjs`                  | `BASELINE_WORKFLOW`, `BASELINE_CHECK` ("Baseline")                                       |

## Contracts

- Artifact: `figentra-flow-baseline-<sha>`, kept 90 days, holding `baseline.json`:
  `{ version: 1, sha, reader: "turbo", tasks: { "<pkg>#<task>": "pass" | "fail" } }`.
- Search: the ancestors come from `GET /repos/{repo}/commits?sha=<base>&per_page=30`; then, per SHA,
  `GET /repos/{repo}/actions/artifacts?name=…`. A candidate counts only when it isn't expired, its
  `workflow_run.head_sha` is that SHA, its `head_branch` is the default branch, and `GET /actions/runs/{id}` says
  `event: push`. It is downloaded with `gh run download <run> -n <name>`.
- Defaults: `tasks` = `lint typecheck test build`, `install` = `pnpm install --frozen-lockfile`, `branch` = `main`.

## Constitution Check

| Law                       | Result | Note                                                                    |
| ------------------------- | ------ | ----------------------------------------------------------------------- |
| Secrets (ADR 0009)        | PASS   | Flow reads none; setup steps live in the owner-only config              |
| Security                  | PASS   | baselines only from push runs on the default branch; fails closed; FR-6 |
| Not built yet (ADR 0011)  | PASS   | nothing on the list                                                     |
| Test placement (ADR 0022) | PASS   | `src/__tests__/`                                                        |
| Versions and catalogs     | PASS   | no dependency                                                           |

## Rollout

Release Flow 0.2.2. In each red-main repository, the wave PR adds `baseline` to the config (with that repository's
setup steps) and syncs, which renders the workflow. Once main has run it once (so a baseline exists), the owner runs
`setup-merge-bot.sh --repos <red-main repos> --swap-required "Quality Gate=Baseline" --apply`.
