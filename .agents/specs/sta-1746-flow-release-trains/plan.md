# Implementation Plan: Figentra Flow runs release trains

**Spec**: `.agents/specs/sta-1746-flow-release-trains/spec.md` · **Linear**: STA-1746 · **Date**: 2026-11-01

**Input**: the spec, approved by the owner on 2026-11-01 (chat).

## Summary

One new command, `figentra-flow train`, with the subcommands `open`, `add`, `close`, `build`, `eject`, `depart` and
`status`. It reuses `land`'s gate rule and GitHub connection, `gate run` for every gate, and the git helpers. The
settings are a new `train` block in the configuration.

## Technical Context

- **Language**: plain ESM JavaScript with JSDoc, checked by `tsc` (`checkJs`); Node 24; no runtime dependencies
- **Members**: figentra/flow `packages/figentra-flow` (`@figentra-oss/flow`, binaries `figentra-flow` and `fflow`)
- **Testing**: `node:test` in `src/__tests__/`, against temporary repositories with a local bare origin; GitHub and
  the gate runner are fakes; no network
- **Storage**: none locally; the train's state is a marked line in its GitHub milestone's description
- **Runtime target**: the `figentra-flow` CLI, run in the repository it acts on

## Architecture overview

`src/commands/train.mjs` holds the subcommands as functions over a context (`root`, `repo`, `base`, the `train`
settings, the gate App, `--dry-run`) and injected dependencies (the GitHub `api`, `gate(dir, ref)`, `log`, `warn`),
as `land.mjs` does. A train is a milestone titled `<label><version>` and a label of the same name. Its state (members
in board order, ejections, waiting PRs, the cut-off) is one JSON line in the milestone's description, behind a
`<!-- figentra-flow/train` marker.

`build` works in a detached worktree at `.claude/worktrees/train-<version>`, removed when the build ends. It merges
each member's `refs/pull/<n>/head` with `--no-ff`. Every gate goes through `gate run --ref train/<version>` on the
candidate commit, which is pushed to `train/<version>` first. Bisect gates prefixes, which are the first-parent
merge commits of the build. `depart` fast-forwards the default branch through the API with `force: false`.

## Components and responsibilities

- **`open [<version>]`**: refuses while a train is open. The version is the given one, else the highest of each
  changeset-named package's version bumped by its changeset. If a train with that version exists (the departed
  train's changesets stay until Version Packages lands), it moves on by a patch. Creates the label (reusing one that
  exists) and the milestone.
- **`add <pr>`**: the board rule (open, based on the default branch, `gateProblems` on the exact head). Then the
  label, the milestone and the member appended. After the cut-off, the PR goes to `waiting`.
- **`close`**: sets `closed`. `cutOff()` also counts `train.cutoff` hours since the milestone was created.
- **`build`**: refuses a train that is still boarding or empty. Each member is re-checked by the board rule, and its
  fetched ref must equal its head; then it is merged. A conflict is aborted and the member ejected. The tip is
  pushed and gated: exit 0 is green, exit 1 is red, and anything else stops without ejecting. On red, `manual`
  stops; `bisect` binary-searches the prefixes (the default branch is taken as green, the tip is known red), ejects
  the first red member and rebuilds.
- **`eject <pr>`**: the manual ejection. An ejection updates the state, removes the label, clears the milestone and
  comments on the PR; each of these only warns on failure.
- **`depart`**: refuses unless every `after` upstream is published, `train/<version>` exists, its tip is green from
  the gate App on the exact sha, and `compare/<base>...<tip>` is `ahead`. Then `PATCH git/refs/heads/<base>` with
  `{ sha, force: false }`. After that it closes the milestone, opens the next train and boards the waiting PRs,
  each step only warning (exit 3).
- **`status`**: read-only report.
- **`land.mjs`**: `gateProblems(statuses, sha, gateApp)` and `connect(root)` move out of `landRules` and `run` so
  that `train` reuses them unchanged.

## Files and folders

- `packages/figentra-flow/src/commands/train.mjs` (new)
- `packages/figentra-flow/src/commands/land.mjs` (`gateProblems`, `connect` exported)
- `packages/figentra-flow/bin/figentra-flow.mjs` (`train` on the dispatcher)
- `packages/figentra-flow/src/lib/config.mjs`, `packages/figentra-flow/schema/figentra-flow.config.schema.json`,
  `figentra-flow.config.json` (the `train` block)
- `packages/figentra-flow/src/__tests__/train.test.mjs` (new)
- `packages/figentra-flow/README.md`, `AGENTS.md`, `.changeset/flow-release-trains.md`

## Data models and migrations

The milestone description line: `<!-- figentra-flow/train {"members":[n…],"ejected":[{"pr":n,"reason":"…"}],"waiting":[n…],"closed":bool} -->`.
A missing or unreadable line reads as an empty, boarding train. No migration.

## Contracts

- CLI: `figentra-flow train <open [<x.y.z>]|add <pr>|close|build|eject <pr>|depart|status> [--dry-run]`. Exit
  codes: 0 done, 1 refused by a rule or a red train, 2 a usage, git or gate-infrastructure failure, 3 departed with a
  warning.
- Configuration: `train.cutoff` (integer hours, at least 1), `train.eject` (`bisect` | `manual`, default `bisect`),
  `train.after` (`owner/name` list, default empty), `train.label` (default `train:`).
- GitHub: milestones, labels, issue labels and milestone, issue comments, PRs, commit statuses, `git/ref`, `compare`,
  `git/refs` (PATCH with `force: false`), and the upstream's releases.

## Error handling

Every rule is checked before anything changes, and each failing rule is listed. A failed git step stops the build
with exit 2 and leaves the worktree for inspection if it cannot be removed. A gate exit other than 0 or 1 is
infrastructure, not red, so nothing is ejected. After the fast-forward, every step only warns and never undoes it.
A failed read of milestones throws and is reported as exit 2, except after the fast-forward, where it warns.

## Security and tenancy

No secret is read. GitHub calls use the configured credentials port only (AC-034 of STA-1729), and network git goes
through `remote`. `depart` trusts only the gate App the configuration names.

## Testing strategy

`node:test` in `packages/figentra-flow/src/__tests__/train.test.mjs`. A fake hub keeps milestones, PRs, statuses,
refs, compare results and releases, and records every call. Build tests use a real temporary repository whose PR
heads are pushed to a local bare origin as `refs/pull/<n>/head`, with a fake gate that is red while `bad.txt` is in
the tree. Each test carries `@covers sta-1746:AC-###`. The tester runs it on a box (`pnpm verify`), never on the Mac.

## Rollout

1. Land in figentra/flow after a green box gate; it ships with the next Figentra Flow release.
2. Dry-run on core with the 0.2.2 items (STA-1739, STA-1740, STA-1727): `train open 0.2.2 --dry-run`, `train add`
   each with `--dry-run`, then for real when the tester agrees.
3. A repository whose ruleset requires PRs for the default branch must allow the train's fast-forward. That is a
   ruleset change, which is the owner's to make.

## Constitution Check

| Law                                   | Result | Note                                                      |
| ------------------------------------- | ------ | --------------------------------------------------------- |
| Boundaries (tier direction, ADR 0003) | N/A    | Figentra Flow is its own repository with one package      |
| Secrets (ADR 0009)                    | PASS   | no secret read; GitHub through the credentials port       |
| Security                              | PASS   | depart is a fast-forward of an exact-sha green tip only   |
| HTTP and events                       | N/A    | a CLI, no endpoint or event                               |
| Tenancy                               | N/A    | no tenant data                                            |
| Delegation                            | PASS   | one builder; the tester gates and lands                   |
| Not built yet (ADR 0011)              | PASS   | nothing on the list                                       |
| Test placement (ADR 0022)             | PASS   | `src/__tests__/` beside the subjects                      |
| Versions and catalogs                 | PASS   | no dependency                                             |
| Deploy modes (ADR 0076)               | PASS   | a developer tool, same everywhere                         |
| Licence tier (ADR 0077)               | PASS   | free                                                      |
| Docs and ADRs                         | PASS   | README and AGENTS.md; no ADR needed                       |

## Deploy modes

| Mode       | Behaviour         |
| ---------- | ----------------- |
| SaaS       | same (a dev tool) |
| On-prem    | same (a dev tool) |
| Air-gapped | same (a dev tool) |

## Correctness properties

- **P-001**: a PR boards only when it is open, on the default branch and green from the gate App on its exact head; one train is open at a time — Validates: FR-1, FR-2, FR-3
- **P-002**: a build never rewrites a member (merge commits only) and never force-pushes; a member that conflicts or breaks the train is ejected and the rest go on — Validates: FR-4, FR-5
- **P-003**: the default branch moves only by a fast-forward to a tip that is green on its exact sha, and only after every `after` upstream is published — Validates: FR-6, FR-7
- **P-004**: `status` and every `--dry-run` change nothing, and the settings are validated configuration with defaults — Validates: FR-8, FR-9
