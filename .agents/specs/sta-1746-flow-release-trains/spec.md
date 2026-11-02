# Feature Specification: Figentra Flow runs release trains

**Feature Branch**: `figentra/sta-1746-flow-release-trains`

**Created**: 2026-11-01

**Status**: Done

**Tier**: feature

**Approver**: owner (approved 2026-11-01 in chat: "let's embed it and do it day one")

**Linear**: STA-1746

**Clarifications status**: complete

**Input**: Owner decision (2026-11-01): every repository runs a release train, built into Figentra Flow, from day one.
GitHub's merge queue is not available for private repositories on the Team plan, and figentra/flow and the product
repositories are private. Today's trains (core batch 1, batch 2, 0.2.1) are run by hand by the tester.

## Impact

- **Apps touched**: none
- **Services touched**: none
- **Packages touched**: `packages/figentra-flow` (the `train` command, `land`'s shared gate rule, the config schema)
- **Cross-service events**: none
- **Tenancy and data**: none; a train's state is a marked line in its GitHub milestone's description
- **Secrets**: none read; GitHub calls go through the configured credentials port, as `land` does
- **ADR needed**: no (a command on ADR 0503's workflow; the merge method of a train is merge commits, recorded here)
- **New dependencies**: none
- **Deploy modes**: same everywhere (a developer tool)
- **Licence tier**: free
- **Docs to update**: `packages/figentra-flow/README.md`, `AGENTS.md`
- **Lane**: full
- **Change risk**: R2 (a new way to move the default branch, refused unless the gate is green on the exact tip)

## Requirements

- **FR-1** `figentra-flow train open [<version>]` opens the next train after a release: a GitHub milestone and a
  `train:<version>` label, the version next from changesets unless given. One train is open at a time.
- **FR-2** `train add <pr>` boards a PR only when it is open, based on the default branch and green on
  `figentra-flow/gate` at its exact head; it gets the label and the milestone, in board order.
- **FR-3** `train close` is the cut-off, manual by default; `train.cutoff` optionally cuts off a set number of hours
  after the train opened. A PR added after the cut-off rides the next train.
- **FR-4** `train build` creates `train/<version>` from the default branch and merges each member in board order with
  merge commits (no history rewrite); a member that conflicts is ejected with a comment and the build continues; then
  it runs `gate run --ref train/<version>`.
- **FR-5** On a red train, `train.eject: "bisect"` (the default) gates prefixes of the member list to find the first
  breaking member, ejects it with the red gate's report, rebuilds and re-gates; `"manual"` stops and reports.
- **FR-6** `train depart` requires `figentra-flow/gate` green on the train tip's exact sha, fast-forwards the default
  branch to the tip (which marks the member PRs merged), closes the milestone and opens the next train. The release
  itself stays the changesets Version Packages PR, approved by the owner.
- **FR-7** With `train.after: ["<owner>/<repo>"]`, a train cannot depart until each upstream train's version is
  published.
- **FR-8** `train status` shows the members, their gate states, the ejections and the upstream chain.
- **FR-9** Every setting lives under `train` in `figentra-flow.config.json` as a default the owner edits, and every
  mutating subcommand takes `--dry-run`.

## Acceptance criteria

- **AC-001**: WHEN `figentra-flow train open` runs with no train open THE CLI SHALL create the milestone and the label `<label><version>`, the version next from changesets unless one is given
- **AC-002**: IF a train is already open THEN THE CLI SHALL refuse to open another and name it
- **AC-003**: WHEN `train add <pr>` runs THE CLI SHALL board the PR, with the label and the milestone and in board order, only when it is open, based on the default branch and green on `figentra-flow/gate` from the gate App at its exact head, and otherwise refuse naming each reason
- **AC-004**: IF `train add` runs after the cut-off THEN THE CLI SHALL hold the PR for the next train and board it when that train opens
- **AC-005**: WHEN `train close` runs, or `train.cutoff` hours have passed since the train opened, THE CLI SHALL treat the train as cut off
- **AC-006**: WHEN `train build` runs on a cut-off train THE CLI SHALL create `train/<version>` from the default branch, merge each member in board order with a merge commit and gate the tip with `gate run --ref train/<version>`
- **AC-007**: IF a member conflicts with the train, is no longer open or is no longer green on its head THEN THE CLI SHALL eject it with a comment and continue the build
- **AC-008**: WHILE `train.eject` is `bisect` THE CLI SHALL gate prefixes of a red train's member list to find the first breaking member, eject it with the red gate's status and report link, rebuild and re-gate
- **AC-009**: WHILE `train.eject` is `manual` THE CLI SHALL stop on a red train and report it, ejecting nothing until `train eject <pr>` is run
- **AC-010**: IF `figentra-flow/gate` is not green from the gate App on the train tip's exact sha THEN THE CLI SHALL refuse to depart
- **AC-011**: WHEN `train depart` runs THE CLI SHALL move the default branch only by a fast-forward to the tip, then close the milestone and open the next train, and SHALL only warn about a step that fails after the fast-forward
- **AC-012**: IF a repository in `train.after` has a cut-off or departed train whose version has no published release THEN THE CLI SHALL refuse to depart and name it
- **AC-013**: WHEN `train status` runs THE CLI SHALL show the members with their gate states, the ejections, the waiting PRs, the tip's gate and the upstream chain, changing nothing
- **AC-014**: WHEN a mutating train subcommand runs with `--dry-run` THE CLI SHALL report what it would do and change nothing
- **AC-015**: THE configuration SHALL hold the train settings under `train` (`cutoff`, `eject`, `after`, `label`), validated by the shipped schema, with defaults when they are absent

## Out of scope

- Automatic publishing: the release stays the owner-approved Version Packages PR.
- GitHub merge queue (a possible later adapter for public repositories).

## Clarifications (the builder's answers where the issue was silent, under the owner's approval of 2026-11-01)

- **Q1. Where the train's state lives.** In a marked line of its milestone's description (members in board order,
  ejections, PRs waiting for the next train, the cut-off). Nothing is stored locally. **Answer: yes.**
- **Q2. One open train.** `open` refuses while a train is open; a PR added after the cut-off waits in that train's
  state and boards the next train when `depart` opens it. **Answer: yes.**
- **Q3. `cutoff`.** An integer number of hours after the train opened (the milestone's creation time); absent means
  manual. **Answer: yes.**
- **Q4. Rebuilding `train/<version>`.** It is Flow's scratch branch and never on the default branch; a candidate that
  does not descend from it replaces it by delete and push, never a forced push. Members are never rewritten.
  **Answer: yes.**
- **Q5. "Published" for `after`.** The upstream's newest cut-off or departed train has a non-draft GitHub release
  tagged `<v>`, `v<v>` or `<package>@<v>`. **Answer: yes.**
- **Q6. Manual eject.** `train eject <pr>` is the manual counterpart of bisect. **Answer: yes.**
- **Q7. The failing log lines.** The box keeps the check's log; an ejection names the red status's description and
  report link. **Answer: yes.**

## Amendments

- A-001 · 2026-11-03 · recorded after shipping (STA-2039): AC-008 reworded into the EARS form, same meaning; the
  verification task T010 (a dry-run on core with the 0.2.2 items) is struck as not done, since no record of it exists
  and it is not code; the commands shipped in 0.1.0 and `train.test.mjs` covers every criterion · added: none ·
  struck: T010

## Status history

- 2026-11-01: Draft → Clarified (the issue STA-1746 is the owner's specification)
- 2026-11-01: Clarified → Planned — Approved by owner 2026-11-01 (chat: "let's embed it and do it day one")
- 2026-11-01: Planned → Tasked
- 2026-11-01: Tasked → Implementing
- 2026-11-03 · Implementing → Done · Claude (FLOW session) · brought to the ADR 0502 standard after shipping in 0.1.0
  (STA-2039): AC-008 in EARS form, the plan's state marker no longer hides its design sections, T009 ticked and T010
  struck (A-001)
