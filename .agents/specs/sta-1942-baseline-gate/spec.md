# Feature Specification: Figentra Flow's baseline gate lands routine PRs while main is red

**Feature Branch**: `figentra/sta-1942-baseline-gate`

**Created**: 2026-11-02

**Status**: Planned

**Tier**: feature

**Approver**: owner (approved 2026-11-02 as a freeze exception, relayed by the leader session)

**Linear**: STA-1942

**Clarifications status**: complete

**Input**: Owner decision 2026-11-02. The merge bot (STA-1856) approves a PR only when every required check is green.
In a repository whose main is red, "Quality Gate" is red on every PR, so the bot can land nothing. A baseline gate
asks a narrower question, "does this PR make anything worse than main already is?", and answers it as one check,
"Baseline", which replaces "Quality Gate" as the required check in those repositories only.

## Impact

- **Apps touched**: none
- **Services touched**: none
- **Packages touched**: `packages/figentra-flow`: `gate baseline` (new), a results reader, `render` (one more
  workflow), the config schema (`baseline`)
- **Cross-service events**: none
- **Tenancy and data**: none
- **Secrets**: none read by Flow. The rendered workflow uses the job's `GITHUB_TOKEN` (read-only) to find and download
  the baseline artifact. A repository's own setup steps, from its config, may name its secrets, as its CI does today.
- **ADR needed**: no (a gate mode beside STA-1856's approval path)
- **New dependencies**: none
- **Deploy modes**: same everywhere (a developer tool)
- **Licence tier**: free
- **Docs to update**: `packages/figentra-flow/README.md`, the changeset
- **Lane**: full
- **Change risk**: R2. A required check that tolerates main's existing failures lets the bot land PRs into a red main.

## Requirements

- **FR-1** Results come through a reader: a function from one tool's output to a map of task id → `pass` or `fail`.
  Flow ships the `turbo` reader for a run summary (`turbo run … --summarize`, `.turbo/runs/<id>.json`). A task passes
  only when its `execution.exitCode` is 0. A missing execution counts as a fail. A task whose command is
  `<NONEXISTENT>` (no such script in that package) is not a task.
- **FR-2** `gate baseline save` reads the newest run summary and writes the normalized results
  (`{ version, sha, reader, tasks }`) to `.figentra-flow-gate/baseline.json`. On a push to the default branch, the
  workflow uploads that file as the artifact `figentra-flow-baseline-<sha>`.
- **FR-3** `gate baseline check --base <sha>` compares the PR run's results with the baseline of the base SHA, or of
  its nearest ancestor that has one (up to 30 commits back). The baseline comes only from an artifact made by a
  `push` run on the default branch at that exact SHA; any other artifact with that name is ignored. The check passes
  only when the PR's failed set is a subset of the baseline's failed set:
  - a task that passed on main and fails in the PR is a new failure;
  - a task new in the PR that fails is a new failure;
  - a task that failed on main and passes in the PR is fixed;
  - with no baseline found, the check fails closed and says which SHAs it searched.
- **FR-4** The output is a job-summary table (new failures, fixed, still failing) and the exit code; the rendered job
  is named `Baseline`, so the check is "Baseline".
- **FR-5** With `baseline` in the config, `sync` renders `.github/workflows/figentra-flow-baseline.yml`. It runs on
  pushes to the default branch and on pull requests: checkout, the repository's own `baseline.setup` steps (verbatim,
  from the owner-only config), `baseline.install`, then one `turbo run <baseline.tasks> --continue --summarize`, then
  `save`, then the upload (push) or the `check` (pull request). Without `baseline` nothing is rendered: a repository
  whose main is green keeps "Quality Gate" required and needs none of this.
- **FR-6** Security does not move. gitleaks, CodeQL, dependency review and the secrets checks stay separately
  required. "Baseline" replaces only the "Quality Gate" requirement, and only in a repository whose main is red. The
  approval check counts "Baseline" like any required check, from the App the ruleset pins (GitHub Actions, 15368).
  A PR that edits the baseline workflow is owner-only (STA-1856 FR-1), so the bot never approves a PR that could
  rewrite its own Baseline job.
- **FR-7** Tests cover, on canned summaries:
  - the subset passes;
  - a new failure fails;
  - a new task that fails fails;
  - a missing baseline fails closed;
  - a fixed task passes and is listed;
  - the reader (pass, fail, no execution, `<NONEXISTENT>`);
  - the search ignores an artifact from a pull request run or from another branch;
  - the workflow renders only with `baseline` configured.

## Status history

- 2026-11-02: Draft → Clarified (owner decision relayed by the leader session)
- 2026-11-02: Clarified → Planned — Approved by owner 2026-11-02 (relayed by the leader session)
