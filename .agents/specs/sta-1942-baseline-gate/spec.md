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

- **FR-1** Results come through a reader: a function from one tool's output to a map of task id → `pass`, `fail` or
  `skip`. Flow ships the `turbo` reader for a run summary (`turbo run … --summarize`, `.turbo/runs/<id>.json`). A task
  passes only when its `execution.exitCode` is 0. A task with no execution never ran: `skip`. A task whose command is
  `<NONEXISTENT>` (no such script in that package) is not a task.
- **FR-2** `gate baseline save` reads the newest run summary and writes the normalized results
  (`{ version, sha, reader, tasks }`) to `.fflow-gate/baseline.json`. On a push to the default branch, the
  workflow uploads that file as the artifact `fflow-baseline-<sha>`.
- **FR-3** `gate baseline check --base <sha>` compares the PR run's results with the baseline of the base SHA, or of
  its nearest ancestor that has one (up to 30 commits back). The baseline comes only from an artifact made by a
  `push` run on the default branch at that exact SHA; any other artifact with that name is ignored. The check passes
  only when the PR's failed set is a subset of the baseline's failed set, and it compares the task inventory, not
  only the failures (the external review of 2026-11-02):
  - a task that passed on main and fails in the PR is a new failure;
  - a task new in the PR that fails is a new failure; a task new in the PR that passes is fine;
  - a task main ran that is missing from the PR, or never ran there, blocks, even one red on main: a PR cannot pass
    by deleting or skipping tasks;
  - a task matching one of `baseline.mustPass` (tenant isolation, authz, secrets and licence tests) blocks whenever
    it is not green, even when it is red on main;
  - the PR's failed-task count may not exceed main's (the debt may not grow);
  - a task that failed on main and passes in the PR is fixed;
  - with no baseline found (none within 30 ancestors, or expired), the check fails closed and says how far it
    searched.
- **FR-4** The output is a job-summary table (new failures, missing or skipped, must-pass not green, fixed, still
  failing, and the failure count from main to the PR) and the exit code; the rendered job is named `Baseline`, so the
  check is "Baseline". The summary and the README say it is a merge gate, not a release certificate: a release still
  needs a fully green product matrix.
- **FR-5** With `baseline` in the config, `sync` renders `.github/workflows/fflow-baseline.yml`. It runs on
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
  - a task dropped from the PR, or skipped there, blocks;
  - a red must-pass task blocks, even when red on main;
  - a growing failure count blocks;
  - a missing baseline fails closed;
  - a fixed task passes and is listed;
  - the reader (pass, fail, never ran, `<NONEXISTENT>`);
  - the search ignores an artifact from a pull request run or from another branch;
  - the workflow renders only with `baseline` configured;
  - the rename's migration (FR-8).
- **FR-8** The command is `fflow` (owner decision 2026-11-02; the package `@figentra-oss/flow`, the repository and the
  product name "Figentra Flow" do not change). In this release:
  - the binary is `fflow`; `figentra-flow` stays one release as a deprecated alias that prints one notice;
  - the config file is `flow.config.json`; `sync` renames `figentra-flow.config.json` once (and its `$schema`), every
    command reads the old name until then with a warning, and both at once is an error;
  - the rendered workflows are `fflow-approve.yml` and `fflow-baseline.yml`; `sync` deletes the old
    `figentra-flow-*.yml` ones;
  - the approval environment is `fflow-approve`, its secrets `FFLOW_APPROVER_APP_ID` and `FFLOW_APPROVER_PRIVATE_KEY`;
    every other derived name follows (`FFLOW_` variables, `fflow/gate`, `.fflow-gate`, `~/.config/fflow`), and a
    user's `FIGENTRA_FLOW_WORKSPACE` and `FIGENTRA_FLOW_TRACKER`, the old workspace file and the old landed key are
    still read for one release;
  - docs, presets, the stewards' text and the README templates say `fflow`.

## Not now (v2, recorded)

Test-level inventory from vitest's JSON report; a flaky-test quarantine with an owner and an expiry; failure
fingerprints, so a task that keeps failing for a new reason counts as a new failure.

## Status history

- 2026-11-02: Draft → Clarified (owner decision relayed by the leader session)
- 2026-11-02: Clarified → Planned — Approved by owner 2026-11-02 (relayed by the leader session)
- 2026-11-02: amended before release: the external review's v1 must-haves (inventory, `mustPass`, failure debt, the
  merge-gate statement) and the owner's `fflow` rename (FR-8), both in 0.2.2
