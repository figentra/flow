# Implementation Plan: Figentra Flow keeps worktrees within a budget

**Spec**: `.agents/specs/sta-1871-worktree-hygiene/spec.md` · **Linear**: STA-1871 · **Date**: 2026-11-01

**Input**: the spec, requested by the owner on 2026-11-01 (relayed by the leader session). This branch is stacked on
STA-1856 (`figentra/sta-1856-merge-stewards`, flow#60).

## Summary

`clean` already removes worktrees that are finished, saved and clean. This adds a budget mode for the ones that
linger: idle for a day, already merged or pushed, but kept because of uncommitted changes, an unfinished issue or a
detached HEAD. It preserves what they hold, then removes them, the way the owner's sweep of 2026-11-01 did. Two
things change from that sweep: no `--force` and no `--no-verify`. A worktree whose preservation commit is refused by
its hooks stays, with the reason.

## Technical Context

- **Language**: plain ESM JavaScript with JSDoc, checked by `tsc`; Node 24; no runtime dependencies
- **Testing**: `node:test` against temporary repositories with a local bare origin (`__fixtures__/repo.mjs`); `now`
  and `busy` are injected; no network. On the Mac only oxfmt and oxlint run; the tests run in CI.

## Components

| File                                | Change                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/commands/clean.mjs`            | `BUDGET` (10) and `BUDGET_IDLE_HOURS` (24); the report gains `budget`; `clean({ budget: true })` sweeps |
| `src/commands/doctor.mjs`           | `warn` checks for the budget and the disk (`statfsSync`); a warning never fails the run                 |
| `src/commands/init.mjs`             | writes `.claude/worktrees/README.md`                                                                    |
| `src/lib/render.mjs`                | renders the preset's `rules/` like its `agents/`                                                        |
| `src/lib/config.mjs` and the schema | `clean.budget` (an integer of at least 1)                                                               |
| `assets/flow/presets/*/rules/`      | `worktrees.md`                                                                                          |
| the presets' `git-steward`          | runs `clean`, and `clean --budget` when over budget                                                     |

## The sweep, step by step (one candidate)

1. If the worktree has uncommitted changes, or its HEAD is detached, create `keep/<repo>-<name>` at its HEAD,
   suffixed with a time when that name is taken.
2. If it had uncommitted changes, commit them on that branch with `git add -A` and `git commit`, hooks included.
   If the commit fails, keep the worktree.
3. If it holds ignored files outside the caches, write them with `tar -czf` to
   `~/Backups/<NAME>/<repo>__<name>-<stamp>.tgz`. If the archive fails, keep the worktree.
4. Run `git worktree remove <path>`, never `--force`. Delete no branch.

## Constitution Check

| Law                       | Result | Note                                                               |
| ------------------------- | ------ | ------------------------------------------------------------------ |
| Secrets (ADR 0009)        | PASS   | none read; a `.env` among ignored files is archived, never printed |
| Security                  | PASS   | no force, no hook bypass, no branch deletion                       |
| Not built yet (ADR 0011)  | PASS   | nothing on the list                                                |
| Test placement (ADR 0022) | PASS   | `src/__tests__/`                                                   |
| Versions and catalogs     | PASS   | no dependency                                                      |

## Rollout

Release Flow after flow#60. Each repository runs `figentra-flow sync`, which installs the rule. `figentra-flow init
--force`, or the next `clean`, writes the README. `git-steward` runs `clean --budget --dry-run`, reports the result,
then runs it for real.
