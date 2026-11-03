# Feature Specification: Figentra Flow lands through a bot approval and auto-merge, with three steward roles

**Feature Branch**: `figentra/sta-1856-merge-stewards`

**Created**: 2026-11-01

**Status**: Done

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
- **Secrets**: the rendered workflow names the approving App's id and key, which are secrets of the `<NAME>-approve`
  environment (the default branch only). The names are the App's own and are never shared with a bot that pushes.
  The workflow holds no value, and Flow reads none.
- **ADR needed**: no. It amends STA-1729 FR-12; core's ADR 0119 gets its amendment when core syncs.
- **New dependencies**: none
- **Deploy modes**: same everywhere (a developer tool)
- **Licence tier**: free
- **Docs to update**: `packages/figentra-flow/README.md`, `AGENTS.md`
- **Lane**: full
- **Change risk**: R2. A bot approval decides which PRs merge without the owner.

## Requirements

- **FR-1** `land` refuses an owner-only change and names it. Paths are matched case-insensitively. Owner-only means:
  - every workflow and action (`action.y*ml` anywhere);
  - what a deploy, promote or release runs: `wrangler.*`, `eas.json`, `runway.yaml`, `.changeset/config.json`, the
    root package.json's scripts, and the repository's own `approve.ownerOnly` globs;
  - secrets and the secret guards;
  - the catalog: `pnpm-workspace.yaml`, `.npmrc` anywhere, and a dependency moved off its `catalog:` entry;
  - the Flow configuration;
  - repo settings and branch protection;
  - billing or legal files (`LICENSE*` and `NOTICE*` anywhere).

  One list in `src/lib/owner-only.mjs` serves `land`, the approval check and CODEOWNERS.

- **FR-2** When the base's ruleset requires an approving review and the head has none, `land` stops short of the
  merge:
  - while a required check on the head is still running, `land` waits and asks for nothing;
  - when a required check failed, or came from an untrusted source, `land` refuses;
  - when every required check is green, `land` dispatches the installed approval workflow with `pr` and `head`, then
    turns on auto-merge (squash) pinned to that head.

  It never uses an admin path. If the workflow is not installed, `land` refuses and says so.

- **FR-3** `land` on a PR that has already merged finishes it, but only when the PR merged into the default branch.
  Finishing means tracker Done, the merge commit recorded, the worktree removed by `clean`'s rules and a comment
  posted. The branch is deleted only while it still points at the landed head.
- **FR-4** `sync` renders `.github/workflows/<NAME>-approve.yml`. The workflow runs `approve-check.mjs` from the
  pinned package version. Everything is read at the checked head: the files from the merge base through `compare`,
  and the checks from that commit's check runs and statuses against the ruleset's required contexts. The workflow
  approves at that head only when all of these hold:
  - the run is on the default branch;
  - the `<NAME>-approve` environment allows that branch alone;
  - the PR is open and not a draft;
  - the head is in the same repository and equals `head`;
  - the author is not the approving App;
  - nothing in the change is owner-only (FR-1), including a rename's old path;
  - every required check is green from its trusted source (the ruleset's `integration_id`, or the login
    `approve.checks` or the gate App names), with at least one success.

  After approving, the workflow re-reads the PR. If the head moved, it dismisses its own review. A refused PR gets
  one comment with the reasons. The approving App's id and key are secrets of that environment, under names of their
  own (`<PREFIX>APPROVER_APP_ID` and `<PREFIX>APPROVER_PRIVATE_KEY` unless the preset names others). A name that is
  not a valid secret name is refused.

- **FR-5** Presets ship agent definitions in `agents/`. `sync` renders them to `.agents/agents/<id>.md`, or to
  `.claude/agents/<id>.md` with `--direct`; `.flow/overrides/agents/` overrides them. Neutral ships `git-steward`,
  `ci-steward` and `tracker-steward`. Stackra ships `git-steward`, `ci-steward` and `linear-steward`, in core's
  agent format.
- **FR-6** (example-only: this FR is the list of tests itself) Tests cover:
  - the owner-only list and the package findings;
  - CODEOWNERS and the rendered workflow;
  - the approval check against a stubbed GitHub: a check still running, only skipped checks, a spoofed status, an
    owner-only rename, a catalog swap, a moved head, an unprotected environment, and a dismissal after the head moved;
  - the new paths through `land`;
  - the rendered agents.
- **FR-7** With `apps.owner` configured, `sync` renders `.github/CODEOWNERS`, which maps every owner-only glob to the
  owner with no catch-all. GitHub then asks the owner for those paths itself (`require_code_owner_review`), and the
  workflow's checks are defence in depth.

## Acceptance criteria

- **AC-001**: IF a PR changes an owner-only path (in any letter case), the root package.json's scripts, or moves a dependency off its `catalog:` entry THEN THE `land` command SHALL refuse it and name each finding
- **AC-002**: THE owner-only globs of `src/lib/owner-only.mjs`, with the repository's `approve.ownerOnly` added, SHALL be the one list that `land`, the approval check and CODEOWNERS read
- **AC-003**: WHILE a required check on the head is still running THE `land` command SHALL wait without dispatching the approval workflow
- **AC-004**: IF a required check on the head is pinned to no trusted source THEN THE `land` command SHALL refuse to land
- **AC-005**: WHEN the base's ruleset requires an approving review the head lacks and every required check is green THE `land` command SHALL dispatch the approval workflow with `pr` and `head` and turn on squash auto-merge pinned to that head, never merging itself
- **AC-006**: IF the approval workflow is not installed THEN THE `land` command SHALL refuse and say so
- **AC-007**: WHEN `land` runs on a PR that has merged into the default branch THE CLI SHALL only finish it (tracker Done, the worktree removed by `clean`'s rules, a comment) and SHALL delete the branch only while it still points at the landed head
- **AC-008**: WHEN the approval workflow runs THE approval check SHALL approve only at the checked head, and only when the run is on the default branch, its environment allows that branch alone, the PR's head equals `head`, the author is not the approving App, nothing between the merge base and the head is owner-only (a rename's old path included), the base requires the code owner's review and holds `.github/CODEOWNERS`, and every required check is green from its trusted source with at least one success
- **AC-009**: IF the approval check refuses THEN THE approval check SHALL post one comment with the reasons and no review
- **AC-010**: IF the head moves after the approval THEN THE approval check SHALL dismiss its own review
- **AC-011**: WHERE `apps.owner` is configured THE `sync` command SHALL render `.github/workflows/fflow-approve.yml`, which runs the pinned package's check in the `fflow-approve` environment under the approver's own secret names and holds no value, and SHALL refuse a secret name that is not one
- **AC-012**: WHEN `sync` runs THE CLI SHALL render each preset's agents (neutral: `git-steward`, `ci-steward`, `tracker-steward`; stackra: `git-steward`, `ci-steward`, `linear-steward`) to `.agents/agents/<id>.md`, or `.claude/agents/<id>.md` with `--direct`, a repository's `.flow/overrides/agents/<id>.md` replacing one
- **AC-013**: WHERE `apps.owner` is configured THE `sync` command SHALL render `.github/CODEOWNERS` mapping every owner-only glob to the owner with no catch-all, and without an owner SHALL render no CODEOWNERS

## Amendments

- A-001 · 2026-11-03 · recorded after shipping (STA-2039), no scope change: the approval workflow, like CODEOWNERS,
  is rendered only when `apps.owner` is configured (no owner, no approval path; FR-4 said `sync` renders it); the
  check also refuses unless the base's ruleset requires the code owner's review and the base holds
  `.github/CODEOWNERS`, and the workflow refuses a package tarball whose sha512 is not the lockfile's; the approver's
  secrets default to `FFLOW_APPROVER_APP_ID` and `FFLOW_APPROVER_PRIVATE_KEY` (`<PREFIX>APPROVER_*`), and neither
  preset's `preset.yml` names others · added: none · struck: none

## Status history

- 2026-11-01: Draft → Clarified (owner decision relayed by the leader session; core PR #191 is the first draft)
- 2026-11-01: Clarified → Planned — Approved by owner 2026-11-01 (relayed by the leader session)
- 2026-11-01: revised after the independent review (security BLOCK, code notes): checks and files pinned to the head,
  trusted check sources, CODEOWNERS, the wider owner-only list, distinct approver secrets, a protected environment
- 2026-11-03 · Planned → Done · Claude (FLOW session) · brought to the ADR 0502 standard after shipping in 0.2.0
  (STA-2039): the acceptance criteria, the design sections, the correctness properties, tasks.md and A-001 record
  what shipped; nothing was struck
