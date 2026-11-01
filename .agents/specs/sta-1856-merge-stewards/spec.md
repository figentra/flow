# Feature Specification: Figentra Flow lands through a bot approval and auto-merge, with three steward roles

**Feature Branch**: `figentra/sta-1856-merge-stewards`

**Created**: 2026-11-01

**Status**: Planned

**Tier**: feature

**Approver**: owner (approved 2026-11-01, relayed by the leader session: "build this in Figentra Flow, not in core")

**Linear**: STA-1856

**Clarifications status**: complete

**Input**: Owner decision 2026-11-01. The owner stops running every `gh pr merge --admin`. Instead (1) a GitHub App
gives the approving review a ruleset requires, (2) GitHub auto-merge merges once the required checks pass, and (3) a
`git-steward` role decides when to trigger both. Two more roles are approved: `ci-steward`, which turns red CI into
root-cause fix PRs, and a steward that keeps the tracker in step with what merged (`linear-steward` for Stackra).
All of it ships in Flow, so `init` and `sync` install it in every repository. This amends STA-1729 FR-12 ("none
shipped by Flow"): presets now ship agent definitions. The roster (`team`) stays the repository's own.

## Impact

- **Apps touched**: none
- **Services touched**: none
- **Packages touched**: `packages/figentra-flow` (`land`, `render`, a new owner-only list, a new approval workflow,
  the presets' `agents/` and `preset.yml`)
- **Cross-service events**: none
- **Tenancy and data**: none
- **Secrets**: the rendered workflow names two secrets of the `<NAME>-approve` environment, the App id and the key
  (`STACKRA_BOT_APP_ID` and `STACKRA_BOT_PRIVATE_KEY` in the stackra preset). It holds no value, and Flow reads none.
- **ADR needed**: no. It amends STA-1729 FR-12; core's ADR 0119 gets its amendment when core syncs.
- **New dependencies**: none
- **Deploy modes**: same everywhere (a developer tool)
- **Licence tier**: free
- **Docs to update**: `packages/figentra-flow/README.md`, `AGENTS.md`
- **Lane**: full
- **Change risk**: R2. A bot approval decides which PRs merge without the owner.

## Requirements

- **FR-1** `land` refuses a PR that changes an owner-only path, and names the paths. The owner-only paths are every
  workflow and action, secrets and the secret guards, the catalog (`pnpm-workspace.yaml`), the Flow configuration,
  repo settings and branch protection, and billing or legal files. One list in `src/lib/owner-only.mjs` serves both
  `land` and the workflow.
- **FR-2** When the base's ruleset requires an approving review and the head has none, `land` stops short of the
  merge. It dispatches the installed approval workflow with `pr` and `head`, then turns on auto-merge (squash),
  pinned to that head. It never uses an admin path. If the workflow is not installed, `land` refuses and says so.
- **FR-3** `land` on a PR that has already merged finishes it: tracker Done, the merge commit recorded, the worktree
  removed by `clean`'s rules, the branch deleted and a comment posted.
- **FR-4** `sync` renders `.github/workflows/<NAME>-approve.yml`. The workflow takes `pr` and `head`. It approves at
  that head only when the PR is open and not a draft, the head is in the same repository and equals `head`, the
  author is not the approving App, no changed path (including a rename's old path) is owner-only, and every
  required check passed or was skipped, with at least one passing. A refused PR gets one comment with the reasons.
  The App id and key come from secrets of the `<NAME>-approve` environment, by the names the preset gives.
- **FR-5** Presets ship agent definitions in `agents/`. `sync` renders them to `.agents/agents/<id>.md`, or to
  `.claude/agents/<id>.md` with `--direct`; `.flow/overrides/agents/` overrides them. Neutral ships `git-steward`,
  `ci-steward` and `tracker-steward`. Stackra ships `git-steward`, `ci-steward` and `linear-steward`, in core's
  agent format.
- **FR-6** Tests cover the owner-only list, the rendered workflow, the new paths through `land`, and the rendered
  agents.

## Status history

- 2026-11-01: Draft → Clarified (owner decision relayed by the leader session; core PR #191 is the first draft)
- 2026-11-01: Clarified → Planned — Approved by owner 2026-11-01 (relayed by the leader session)
