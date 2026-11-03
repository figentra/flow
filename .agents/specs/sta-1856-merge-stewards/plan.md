# Implementation Plan: Figentra Flow lands through a bot approval and auto-merge, with three steward roles

**Spec**: `.agents/specs/sta-1856-merge-stewards/spec.md` · **Linear**: STA-1856 · **Date**: 2026-11-01

**Input**: the spec, approved by the owner on 2026-11-01 (relayed by the leader session). Brought to the ADR 0502
design sections on 2026-11-03 (STA-2039) from the code that shipped in 0.2.0; names are today's (`fflow`, since
0.2.2; `figentra-flow` before).

## Summary

`land` gains three things: the owner-only refusal; a way past a required review (dispatch the approval workflow,
then auto-merge at the head); and a finish step for a PR that has already merged. `sync` renders one more workflow,
CODEOWNERS and the presets' agent definitions. Nothing changes for a repository whose ruleset requires no review.

## Technical Context

- **Language**: plain ESM JavaScript with JSDoc, checked by `tsc` (`checkJs`); Node 24; no runtime dependencies
- **Members**: figentra/flow `packages/figentra-flow` (`@figentra-oss/flow`)
- **Testing**: `node:test` in `src/__tests__/` with the fake `api` and temporary repositories already used by
  `land.test.mjs`; no network. On the Mac only oxfmt and oxlint run; the tests run in the gate.
- **Storage**: none
- **Runtime target**: the `fflow` CLI, and `approve-check.mjs` run from the pinned package by the rendered workflow

## Constitution Check

| Law                                   | Result | Note                                                                  |
| ------------------------------------- | ------ | --------------------------------------------------------------------- |
| Boundaries (tier direction, ADR 0003) | N/A    | Figentra Flow is its own repository with one package                  |
| Secrets (ADR 0009)                    | PASS   | secret names only; environment-scoped; no value read                  |
| Security                              | PASS   | owner-only refusal in `land` and again in the workflow; no admin path |
| HTTP and events                       | N/A    | a CLI, no endpoint or event                                           |
| Tenancy                               | N/A    | no tenant data                                                        |
| Delegation                            | PASS   | one builder; the gate and an independent reviewer land it             |
| Not built yet (ADR 0011)              | PASS   | nothing on the list                                                   |
| Test placement (ADR 0022)             | PASS   | `src/__tests__/` beside the subjects                                  |
| Versions and catalogs                 | PASS   | no dependency; the workflow's actions are pinned to commits           |
| Deploy modes (ADR 0076)               | PASS   | a developer tool, same everywhere                                     |
| Licence tier (ADR 0077)               | PASS   | free                                                                  |
| Docs and ADRs                         | PASS   | README and AGENTS.md; core's ADR 0119 amendment comes with its sync   |

## Deploy modes

| Mode       | Behaviour                                                    |
| ---------- | ------------------------------------------------------------ |
| SaaS       | same (a developer tool on GitHub)                            |
| On-prem    | same (a developer tool on GitHub)                            |
| Air-gapped | same; `land` and the approval check need GitHub's API to act |

## Correctness properties

- **P-001**: no owner-only change lands through Flow: `land` refuses it and the approval check never approves it, from one list — Validates: FR-1, FR-4
- **P-002**: `land` never merges past a required review: it waits while checks run, refuses an untrusted or missing workflow, and otherwise only dispatches the approval and turns on auto-merge pinned to the head; it never uses an admin path — Validates: FR-2
- **P-003**: `land` on a merged PR only finishes it, only when it merged into the default branch, and deletes the branch only at the landed head — Validates: FR-3
- **P-004**: an approval is given only at the head that was checked, and a stale one is dismissed — Validates: FR-4
- **P-005**: `sync` renders each preset's stewards (a repository override wins), and the approval workflow and CODEOWNERS only with an owner — Validates: FR-5, FR-7

FR-6 is example-only: it is the list of tests.

## Architecture overview

One owner-only list feeds three readers. `src/lib/owner-only.mjs` holds the globs and the package findings;
`land` refuses with them, the approval check refuses with them, and `codeowners()` writes them into CODEOWNERS.
`src/lib/required-checks.mjs` decides whether a head's required checks are green, counting only their trusted
source; `land` and the approval check share it. When the base's ruleset needs an approving review the head lacks,
`land` dispatches `.github/workflows/fflow-approve.yml` and enables auto-merge at the head. That workflow, rendered by
`sync` from `src/lib/approve-workflow.mjs`, mints the approving App's token in the `fflow-approve` environment,
downloads this exact package version, refuses a tarball whose sha512 is not the lockfile's, and runs
`src/lib/approve-check.mjs`, which reads everything at the checked head and approves or comments. Auto-merge then
waits for every required check. `sync` also renders each preset's `agents/`.

## Components and responsibilities

| File                                 | Owns                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/owner-only.mjs` (new)       | `OWNER_ONLY`, `ownerOnlyPaths(files, extra)`, `packageFindings` (root scripts, a dependency off `catalog:`), `codeowners` |
| `src/lib/required-checks.mjs` (new)  | `requiredContexts(rules)`, `requiredCheckState(...)`: a context counts only from its pinned App or trusted login          |
| `src/lib/approve-check.mjs` (new)    | the approval check: every rule, the review at the head, the dismissal, the one refusal comment                            |
| `src/lib/approve-workflow.mjs` (new) | `approveWorkflow({ version, integrity, appId, privateKey, trusted, ownerOnly })`, the workflow text                       |
| `src/lib/product.mjs`                | `APPROVE_WORKFLOW`, `APPROVE_ENVIRONMENT`                                                                                 |
| `src/lib/render.mjs`                 | the preset's `agents/`, `approveSecrets`, `lockedIntegrity`, the workflow and CODEOWNERS when `apps.owner` is set         |
| `src/commands/land.mjs`              | `landRules` takes `files`; the approval request and auto-merge; `finish()` for a merged PR                                |
| `assets/flow/presets/*/agents/`      | the three stewards per preset                                                                                             |

## Files and folders

- `packages/figentra-flow/src/lib/owner-only.mjs`, `packages/figentra-flow/src/lib/required-checks.mjs`,
  `packages/figentra-flow/src/lib/approve-check.mjs`, `packages/figentra-flow/src/lib/approve-workflow.mjs` (new)
- `packages/figentra-flow/src/lib/product.mjs`, `packages/figentra-flow/src/lib/render.mjs`,
  `packages/figentra-flow/src/lib/config.mjs` (the `approve` block), `packages/figentra-flow/src/commands/land.mjs`
- `packages/figentra-flow/assets/flow/presets/neutral/agents/{git-steward,ci-steward,tracker-steward}.md`,
  `packages/figentra-flow/assets/flow/presets/stackra/agents/{git-steward,ci-steward,linear-steward}.md`
- `packages/figentra-flow/src/__tests__/approve-check.test.mjs`, `packages/figentra-flow/src/__tests__/stewards.test.mjs`
  (new), `packages/figentra-flow/src/__tests__/land.test.mjs`
- `packages/figentra-flow/README.md`, `AGENTS.md`, `packages/figentra-flow/CHANGELOG.md` (0.2.0)

## Data models and migrations

None. Configuration gains `approve: { ownerOnly, checks }` (extra owner-only globs, and trusted logins per check
context). The 0.2.2 rename moved `figentra-flow-approve.yml` to `fflow-approve.yml` (STA-1942 FR-8).

## Contracts

- Dispatch: `POST /repos/{repo}/actions/workflows/fflow-approve.yml/dispatches` with `ref` set to the base and
  `inputs` set to `{ pr, head }`. The input is called `head`, not `sha`: core's bash guard reads a `sha` field on a
  dispatch as a production deploy.
- Auto-merge: GraphQL `enablePullRequestAutoMerge` with `mergeMethod: SQUASH`, `expectedHeadOid` set to the head,
  and the same title and `Refs:` body as a direct land.
- "Needs approval" means the base's `rules/branches` lists a `pull_request` rule whose
  `required_approving_review_count` is above 0, and no review on the head commit is `APPROVED`.
- Secrets: the approving App's id and key are secrets of the `fflow-approve` environment, named
  `FFLOW_APPROVER_APP_ID` and `FFLOW_APPROVER_PRIVATE_KEY` unless a preset's `approve.app_id` and
  `approve.private_key` name others.
- `land` exit codes: 4 while required checks are still running; 3 for a step after the merge that only warned.

## Error handling

`land` checks every rule before it changes anything and lists each failing one; a step after the merge only warns
and never undoes it. The approval check refuses with every reason in one comment and leaves no review: the run off
the default branch, an environment that allows more than that branch, a closed or draft PR, a head from another
repository or not the `head` given, the approving App as author, an owner-only path, root script or catalog change,
a file name with a control character, a base without the code owner's review or `.github/CODEOWNERS`, and a required
check still running, failed, only skipped or from an untrusted source. If the head moved after approving, it
dismisses its review; if GitHub refuses that, it requests changes, turns auto-merge off and comments what each step
did.

## Security and tenancy

The App key is an environment secret. The environment allows the default branch only, so a workflow edited on a
branch cannot mint the token. The workflow never checks out or runs the PR's code and runs only the pinned,
integrity-checked package. The approval is pinned to the head that was checked, and stale approvals are dismissed.
An approval alone merges nothing: auto-merge still waits for every required check, and GitHub asks the owner for
owner-only paths through CODEOWNERS. No admin path anywhere. No tenant or personal data.

## Testing strategy

- `packages/figentra-flow/src/__tests__/land.test.mjs`: the owner-only refusal (AC-001), waiting and the untrusted
  check (AC-003, AC-004), the approval dispatch and auto-merge (AC-005), the missing workflow (AC-006), finishing a
  merged PR (AC-007).
- `packages/figentra-flow/src/__tests__/approve-check.test.mjs`: each refusal and the approval at the head (AC-008),
  one comment (AC-009), the dismissal (AC-010).
- `packages/figentra-flow/src/__tests__/stewards.test.mjs`: the list (AC-002), the workflow and secret names
  (AC-011), the stewards and overrides (AC-012), CODEOWNERS (AC-013).

## Rollout

Released in Flow 0.2.0. Core runs `fflow sync`, which installs the agents and the workflow, and adds ADR 0119's
amendment then. The owner sets up the App, the environment and the ruleset. Until a repository does that, `land`
behaves as before wherever no review is required.

## The `merge-queue` replacement (proposal only)

`~/.local/bin/merge-queue` loops over `ready-to-merge` PRs in `figentra/academorix` and runs `gh pr merge --admin
--merge`. The replacement: once academorix has run `fflow sync`, the loop goes away and `git-steward` runs
`fflow land <n>` per PR. Until then, swap the merge line for an approval request plus auto-merge, which bypasses
nothing:

```sh
head=$(gh pr view "$p" --repo figentra/academorix --json headRefOid --jq .headRefOid)
gh workflow run fflow-approve.yml --repo figentra/academorix -f pr="$p" -f head="$head" &&
  gh pr merge "$p" --repo figentra/academorix --auto --merge >/dev/null 2>&1 && echo "$(date -u +%H:%M) queued #$p"
```
