# Implementation Plan: Figentra Flow keeps worktrees within a budget

**Spec**: `.agents/specs/sta-1871-worktree-hygiene/spec.md` · **Linear**: STA-1871 · **Date**: 2026-11-01

**Input**: the spec, requested by the owner on 2026-11-01 (relayed by the leader session). This branch was stacked on
STA-1856 (`figentra/sta-1856-merge-stewards`, flow#60). Brought to the ADR 0502 design sections on 2026-11-03
(STA-2039) from the code that shipped in 0.2.0.

## Summary

`clean` already removes worktrees that are finished, saved and clean. This adds a budget mode for the ones that
linger: idle for a day, already merged or pushed, but kept because of uncommitted changes, an unfinished issue or a
detached HEAD. It preserves what they hold, then removes them, the way the owner's sweep of 2026-11-01 did. Two
things change from that sweep: no `--force` and no `--no-verify`. A worktree whose preservation commit is refused by
its hooks stays, with the reason.

## Technical Context

- **Language**: plain ESM JavaScript with JSDoc, checked by `tsc`; Node 24; no runtime dependencies
- **Members**: figentra/flow `packages/figentra-flow` (`@figentra-oss/flow`)
- **Testing**: `node:test` against temporary repositories with a local bare origin (`__fixtures__/repo.mjs`); `now`
  and `busy` are injected; no network. On the Mac only oxfmt and oxlint run; the tests run in CI.
- **Storage**: none; preserved work is a local git branch and a `tar.gz` under `~/Backups/`
- **Runtime target**: the `fflow` CLI, run in the repository it acts on

## Constitution Check

| Law                                   | Result | Note                                                               |
| ------------------------------------- | ------ | ------------------------------------------------------------------ |
| Boundaries (tier direction, ADR 0003) | N/A    | Figentra Flow is its own repository with one package               |
| Secrets (ADR 0009)                    | PASS   | none read; a `.env` among ignored files is archived, never printed |
| Security                              | PASS   | no force, no hook bypass, no branch deletion                       |
| HTTP and events                       | N/A    | a CLI, no endpoint or event                                        |
| Tenancy                               | N/A    | no tenant data                                                     |
| Delegation                            | PASS   | one builder; the gate and an independent reviewer land it          |
| Not built yet (ADR 0011)              | PASS   | nothing on the list                                                |
| Test placement (ADR 0022)             | PASS   | `src/__tests__/`                                                   |
| Versions and catalogs                 | PASS   | no dependency (`tar` and `git` are on every machine Flow runs on)  |
| Deploy modes (ADR 0076)               | PASS   | a developer tool, same everywhere                                  |
| Licence tier (ADR 0077)               | PASS   | free                                                               |
| Docs and ADRs                         | PASS   | README and the changeset; no ADR needed                            |

## Deploy modes

| Mode       | Behaviour                                  |
| ---------- | ------------------------------------------ |
| SaaS       | same (a developer tool, local git only)    |
| On-prem    | same (a developer tool, local git only)    |
| Air-gapped | same (a developer tool, no network needed) |

## Correctness properties

- **P-001**: the worktree rule reaches the repository's agent rules on every `sync`, and the folder's README is written by `init` and `clean` — Validates: FR-1, FR-2
- **P-002**: only trees idle 24 hours or more, merged or pushed and not in use are budget candidates, and nothing is removed without `--budget` or under `--dry-run` — Validates: FR-3, FR-4
- **P-003**: a sweep never loses work: uncommitted work and a detached HEAD end on a `keep/` branch, ignored files outside the caches are archived first, no branch is deleted, no `--force` is used, and a failed step keeps the tree untouched — Validates: FR-4
- **P-004**: over the budget or on a low disk `doctor` warns and never fails — Validates: FR-5
- **P-005**: both presets' `git-steward` runs `clean --budget` — Validates: FR-6

FR-7 is example-only: it is the list of tests.

## Architecture overview

Everything sits in the existing commands. Every `clean` run, after its usual pass, runs a budget pass: it counts the
linked worktrees against `clean.budget`, lists the candidates, and with `--budget` (and not `--dry-run`) sweeps each
one: preserve, then `git worktree remove`. `clean` and `init` write `.claude/worktrees/README.md`. `doctor` adds two
checks that only warn. `render.mjs` renders the preset's `rules/` like its `agents/`, so `sync` installs the worktree
rule. The presets' `git-steward` definitions tell the steward to run the budget.

## Components and responsibilities

| File                                          | Owns                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/commands/clean.mjs`                      | `BUDGET` (10), `BUDGET_IDLE_HOURS` (24), `WORKTREES_README`, `writeWorktreesReadme`, `budget`, `sweep` |
| `src/commands/doctor.mjs`                     | the `worktree-budget` and `disk` checks (`statfsSync`, `LOW_DISK_BYTES`, `LOW_DISK_SHARE`), warnings   |
| `src/commands/init.mjs`                       | calls `writeWorktreesReadme`                                                                           |
| `src/lib/render.mjs`                          | `presetDocs(root, "rules")`, rendered beside the agents; `.flow/overrides/rules/` replaces one         |
| `src/lib/config.mjs` and the schema           | `clean.budget` (an integer of at least 1)                                                              |
| `assets/flow/presets/*/rules/worktrees.md`    | the worktree rule                                                                                      |
| `assets/flow/presets/*/agents/git-steward.md` | runs `clean`, and `clean --budget --dry-run` then `clean --budget` when over budget                    |

## Files and folders

- `packages/figentra-flow/src/commands/clean.mjs`, `packages/figentra-flow/src/commands/doctor.mjs`,
  `packages/figentra-flow/src/commands/init.mjs`
- `packages/figentra-flow/src/lib/render.mjs`, `packages/figentra-flow/src/lib/config.mjs`,
  `packages/figentra-flow/schema/flow.config.schema.json` (`figentra-flow.config.schema.json` until 0.2.2)
- `packages/figentra-flow/assets/flow/presets/neutral/rules/worktrees.md`,
  `packages/figentra-flow/assets/flow/presets/stackra/rules/worktrees.md`
- `packages/figentra-flow/assets/flow/presets/neutral/agents/git-steward.md`,
  `packages/figentra-flow/assets/flow/presets/stackra/agents/git-steward.md`
- `packages/figentra-flow/src/__tests__/worktree-budget.test.mjs` (new)
- `packages/figentra-flow/README.md`, `packages/figentra-flow/CHANGELOG.md` (0.2.0)

## Data models and migrations

None. The budget report is in-memory: `{ limit, count, candidates, swept, preserved, kept: [{ path, reason }] }`.
A preserved tree leaves a local branch `keep/<repo>-<name>` (suffixed with a time when the name is taken) and an
archive `~/Backups/<NAME>/<repo>__<name>-<stamp>.tgz`.

## Contracts

- CLI: `fflow clean [--dry-run] [--budget] …` (the existing flags stay); `fflow doctor` reports `worktree-budget` and
  `disk` with `warn: true`, which never sets the exit code.
- Configuration: `clean.budget` (default 10).
- Rendered files: `.agents/rules/worktrees.md` (`.claude/rules/worktrees.md` with `--direct`) and
  `.claude/worktrees/README.md` (local; the folder is git-ignored).

## Error handling

The sweep, step by step, for one candidate; any failed step keeps that tree and records the reason:

1. If the worktree has uncommitted changes, or its HEAD is detached, create `keep/<repo>-<name>` at its HEAD.
2. If it had uncommitted changes, commit them on that branch with `git add -A` and `git commit`, hooks included. If
   the commit fails, switch the tree back to its branch, delete the empty `keep/` branch and keep the tree.
3. If it holds ignored files outside the caches, write them with `tar -czf` to the backup folder. If the archive
   fails, keep the worktree.
4. Run `git worktree remove <path>`, never `--force`. Delete no branch.

## Security and tenancy

No secret is read or printed; an ignored `.env` is archived, never shown. No `--force`, no hook bypass, no branch
deletion. A tree in use by a running process, a locked tree and a tester's tree are never candidates. No tenant data.

## Testing strategy

`packages/figentra-flow/src/__tests__/worktree-budget.test.mjs`, against temporary repositories with the clock, the
busy list and the disk injected: the count, the candidates and the README (AC-002, AC-003); the dry run and the sweep
with its `keep/` branches and backup (AC-004, AC-005); a preservation commit the hooks refuse (AC-006); doctor's
warnings (AC-007); the rendered rule and both stewards (AC-001, AC-008).

## Rollout

Released in Flow 0.2.0, after flow#60. Each repository runs `fflow sync`, which installs the rule. `fflow init
--force`, or the next `clean`, writes the README. `git-steward` runs `clean --budget --dry-run`, reports the result,
then runs it for real.
