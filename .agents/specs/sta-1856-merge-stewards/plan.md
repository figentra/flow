# Implementation Plan: Figentra Flow lands through a bot approval and auto-merge, with three steward roles

**Spec**: `.agents/specs/sta-1856-merge-stewards/spec.md` · **Linear**: STA-1856 · **Date**: 2026-11-01

**Input**: the spec, approved by the owner on 2026-11-01 (relayed by the leader session).

## Summary

`land` gains three things: the owner-only refusal; a way past a required review (dispatch the approval workflow,
then auto-merge at the head); and a finish step for a PR that has already merged. `sync` renders one more workflow
and the presets' agent definitions. Nothing changes for a repository whose ruleset requires no review.

## Technical Context

- **Language**: plain ESM JavaScript with JSDoc, checked by `tsc` (`checkJs`); Node 24; no runtime dependencies
- **Members**: figentra/flow `packages/figentra-flow`
- **Testing**: `node:test` in `src/__tests__/` with the fake `api` and temporary repositories already used by
  `land.test.mjs`; no network. On the Mac only oxfmt and oxlint run; the tests run in the gate.

## Components and responsibilities

| File                                     | Change                                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/lib/owner-only.mjs` (new)           | `OWNER_ONLY` globs, `ownerOnlyPaths(files)`, `ownerOnlyPattern()` (one PCRE for the workflow's `grep -P`)  |
| `src/lib/approve-workflow.mjs` (new)     | `approveWorkflow({ appId, privateKey })`, the workflow text, like `gate-workflow.mjs`                      |
| `src/lib/product.mjs`                    | `APPROVE_WORKFLOW`, `APPROVE_ENVIRONMENT`                                                                  |
| `src/lib/render.mjs`                     | renders the preset's `agents/` and the approval workflow (secret names from `preset.yml`'s `approve`)      |
| `src/commands/land.mjs`                  | `landRules` takes `files`; `landOne` requests approval and auto-merge, or finishes a merged PR; `finish()` |
| `assets/flow/presets/*/agents/`          | the three stewards per preset                                                                              |
| `assets/flow/presets/stackra/preset.yml` | `approve.app_id: STACKRA_BOT_APP_ID`, `approve.private_key: STACKRA_BOT_PRIVATE_KEY`                       |

## Contracts

- Dispatch: `POST /repos/{repo}/actions/workflows/<NAME>-approve.yml/dispatches` with `ref` set to the base and
  `inputs` set to `{ pr, head }`. The input is called `head`, not `sha`: core's bash guard reads a `sha` field on a
  dispatch as a production deploy.
- Auto-merge: GraphQL `enablePullRequestAutoMerge` with `mergeMethod: SQUASH`, `expectedHeadOid` set to the head,
  and the same title and `Refs:` body as a direct land.
- "Needs approval" means the base's `rules/branches` lists a `pull_request` rule whose
  `required_approving_review_count` is above 0, and no review on the head commit is `APPROVED`.

## Security and tenancy

The App key is an environment secret. The environment allows the default branch only, so a workflow edited on a
branch cannot mint the token. The workflow never checks out the PR. The approval is pinned to the head that was
checked, and stale approvals are dismissed. An approval alone merges nothing: auto-merge still waits for every
required check.

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
| Versions and catalogs                 | PASS   | no dependency                                                         |

## Rollout

Release Flow. Core runs `figentra-flow sync`, which installs the agents and the workflow, and adds ADR 0119's
amendment then. The owner sets up the App, the environment and the ruleset (the list in the PR). Until a repository
does that, `land` behaves as before wherever no review is required.

## The `merge-queue` replacement (proposal only)

`~/.local/bin/merge-queue` loops over `ready-to-merge` PRs in `figentra/academorix` and runs `gh pr merge --admin
--merge`. The replacement: once academorix has run `figentra-flow sync`, the loop goes away and `git-steward` runs
`figentra-flow land <n>` per PR. Until then, swap the merge line for an approval request plus auto-merge, which
bypasses nothing:

```sh
head=$(gh pr view "$p" --repo figentra/academorix --json headRefOid --jq .headRefOid)
gh workflow run figentra-flow-approve.yml --repo figentra/academorix -f pr="$p" -f head="$head" &&
  gh pr merge "$p" --repo figentra/academorix --auto --merge >/dev/null 2>&1 && echo "$(date -u +%H:%M) queued #$p"
```
