# Feature Specification: Figentra Flow runs the whole development workflow

> **Renamed (owner, 2026-10-31):** Figentra Flow is now **Figentra Flow** (`figentra-flow`, alias `fflow`; repository
> figentra/flow; `figentra-flow.config.json`; status context `figentra-flow/gate`). This spec keeps its folder and its
> history; `figentra-flow` below means `figentra-flow`. No compatibility is kept for the old names.

**Feature Branch**: `figentra/sta-1729-vellum-workflow`

**Created**: 2026-10-31

**Status**: Tasked

**Tier**: big

**Approver**: owner (direction, approved 2026-10-31 in `notes/plans/vellum-complete.md`); the leader for the technical
stops under the owner's delegation

**Linear**: STA-1729

**Clarifications status**: complete

**Input**: Owner direction (2026-10-31), the approved plan `stackra/notes/plans/vellum-complete.md`: finish Figentra Flow so all
work runs through one workflow, from spec to release. Figentra Flow moves the work (spec, approval, worktree, gate, land,
release, ship, status, clean); `stackra testbed` runs the checks on the boxes; runway deploys, and only the owner
promotes to production. GitHub keeps the Release workflow and one required check, `figentra-flow/gate`, posted by the gate bot;
branch protection stays on. Land squashes. Worktrees live only at `<repo>/.claude/worktrees/<name>`.

## Impact

- **Apps touched**: none
- **Services touched**: none
- **Packages touched**: Figentra Flow's `packages/figentra-flow` (figentra/flow); in Stackra core, the ADR, and later the
  `stackra testbed` entry point Figentra Flow calls
- **Cross-service events**: none
- **Tenancy and data**: none
- **Secrets**: by name only: the gate bot's GitHub token (posts `figentra-flow/gate`) and the Linear token, both from the
  calling repository's Infisical wrapper; Figentra Flow never reads, prints or stores a value
- **ADR needed**: yes: ADR 0503 in core, "Figentra Flow runs the development workflow" (amends ADR 0282 and 0502; records
  the one required check and the worktree rule)
- **New dependencies**: none (Figentra Flow stays plain ESM with no runtime dependencies)
- **Deploy modes**: same everywhere (a developer tool)
- **Licence tier**: free
- **Docs to update**: Figentra Flow's README and AGENTS.md; core's spec-lifecycle guide; each repo's AGENTS.md worktree rule
- **Lane**: full
- **Change risk**: R3 (changes how every repository lands code; switches off per-PR CI)

## Scope and phases

The plan's build order is the phase order. Each phase is its own task group and lands on its own; this spec is
approved once and the plan is written per phase (each phase's design is a plan.md section approved at its stop).

1. **Worktree rule:** `figentra-flow start`, `figentra-flow clean`, the worktree guard, `.claude/worktrees/` in every repository's
   `.gitignore`, and moving today's outside worktrees in.
2. **`figentra-flow gate`:** wraps `stackra testbed` and the repository's verify, posts the `figentra-flow/gate` commit status and
   writes the report.
3. **`figentra-flow land`:** squash merge on a green gate and recorded approvals, Linear Done, worktree removed.
4. **`figentra-flow status`:** every spec, worktree, gate and PR in flight across the repositories.
5. **`figentra-flow release` and `figentra-flow ship`:** changesets, the registry publish (with the 0.2.0 tag backfill), and runway
   deploy to dev and staging.
6. **GitHub switch-over:** per-PR workflows off, `figentra-flow/gate` required, the Release workflow kept; repo by repo.
7. **Sessions (later, owner 2026-10-31, ADR 0503 decision 7):** a spec records its assigned session; `figentra-flow status`
   shows each session's spec, worktree and gate; the two-build-session cap is reported.
8. **Neutral core with adapters (owner 2026-10-31, before phase 4):** credentials, tracker, runner, apps, secrets and
   preset become adapters chosen in `figentra-flow.config.json`; Figentra's choices live in our repositories' config; the
   product name sits in one module (the product is being renamed).
9. **Later:** `figentra-flow migrate` from `.specify/` to `.figentra-flow/`.

## Requirements

- **FR-1** `figentra-flow start <STA-n> [--slug s]` creates the branch `figentra/sta-n-<slug>` from the default branch's
  remote tip and its worktree at `<repo>/.claude/worktrees/sta-n-<slug>`, and moves the Linear issue to In Progress.
- **FR-2** A worktree is created only by `figentra-flow start`: the guard refuses `git worktree add` to any path outside
  `<repo>/.claude/worktrees/`.
- **FR-3** Every repository ignores `.claude/worktrees/`; `figentra-flow init` and `figentra-flow clean --fix-ignore` add it.
- **FR-4** `figentra-flow clean` removes a worktree only when it is clean and saved (its head on a remote ref, or every commit
  landed by patch), and either its issue is Done or Canceled or, without an issue key, it has been idle for at least
  2 hours; it keeps tester worktrees, trees holding ignored files outside the usual caches, and every tree it cannot
  prove saved, and reports the space it frees.
- **FR-5** `figentra-flow gate` runs the full check set on a testbed box and posts `figentra-flow/gate` (success or failure, with
  the report URL) on the head commit with the gate bot's token.
- **FR-6** `figentra-flow land` merges only with a green `figentra-flow/gate` on the head and the spec's approvals recorded, as one
  squash commit with a conventional message, then moves Linear to Done and removes the worktree.
- **FR-7** `figentra-flow status` lists, for every repository in the workspace list, its specs, worktrees, gates and PRs.
- **FR-8** `figentra-flow release` reports what the next release would publish and why it would not; the
  repository's Release workflow versions with changesets and publishes, in CI, to the registry each package names
  (the Stackra registry for Figentra's own repositories); `figentra-flow ship` deploys with runway to dev and staging;
  production stays `runway promote` by the owner.
- **FR-9** Builders run only oxfmt and oxlint on the Mac; every other check runs on a box.
- **FR-10** Work follows ADR 0503 decision 7: a leader session plans, assigns, tracks and approves technical stops;
  feature- and big-tier work runs in its own sub-session and `figentra-flow start` worktree; the tester gates and lands; at
  most two build sessions run at once unless the owner says otherwise; a peer message is never the owner's approval. A
  spec records its session in `**Session**`, and `figentra-flow status` shows it.
- **FR-11** The core names no vendor, team or organisation: credentials, issue tracker, runner, gate and review
  identities, secrets and spec preset are adapters chosen per repository in `figentra-flow.config.json`, and the product name
  lives in one module.
- **FR-12** A repository may name an agent roster in `team` (roles in its own files, none shipped by Flow): specs and
  tasks carry a role, `status` groups by it, a review from the builder's role or session is refused, and an approval
  in a category the owner keeps needs the owner, whatever a role file says.
- **FR-13** `figentra-flow doctor` checks that a repository and the machine can run Flow: the toolchain, the
  configuration, the `.flow/` install, the ignored worktree folder, the roster and the credentials, each with its fix.

## Acceptance criteria

- **AC-001**: WHEN a builder runs `figentra-flow start STA-n` in a repository THE CLI SHALL create branch `figentra/sta-n-<slug>` and its worktree at `<repo>/.claude/worktrees/sta-n-<slug>` and move STA-n to In Progress
- **AC-002**: IF the worktree folder or the branch already exists THEN THE CLI SHALL refuse and name it, changing nothing
- **AC-003**: WHEN an agent runs `git worktree add` to a path outside `<repo>/.claude/worktrees/` THE guard SHALL deny it and name `figentra-flow start`
- **AC-004**: WHEN `figentra-flow clean` runs THE CLI SHALL remove each worktree that is clean, landed or abandoned, and pushed, and report every other one with the reason it stays
- **AC-005**: IF a worktree is a tester worktree (`g-*`, `*-gate`, `land-*`, `tpl-core`, `c6-lock*`, `template-wt-lean`), is dirty, or holds unpushed commits THEN THE CLI SHALL keep it
- **AC-006**: WHEN `figentra-flow clean --fix-ignore` runs in a repository whose `.gitignore` lacks `.claude/worktrees/` THE CLI SHALL add the line
- **AC-007**: WHEN `figentra-flow clean --adopt` runs THE CLI SHALL move each clean, non-tester worktree outside `.claude/worktrees/` inside with `git worktree move`, and list the tester ones for stackra-f4 and the ones it cannot move
- **AC-008**: WHEN `figentra-flow gate` finishes on a box THE CLI SHALL post `figentra-flow/gate` on the head commit with the result and the report link
- **AC-009**: IF the gate's head commit is not the branch's current tip THEN THE CLI SHALL not post a success
- **AC-010**: WHEN `figentra-flow land` runs with a green `figentra-flow/gate` and the approvals recorded THE CLI SHALL squash-merge, set Linear Done and remove the worktree
- **AC-011**: IF the gate is missing, red or on an older commit, or an approval is missing THEN THE CLI SHALL refuse to land and say which
- **AC-012**: WHEN `figentra-flow status` runs THE CLI SHALL list every repository's specs by status, worktrees, gates and open PRs
- **AC-013**: WHEN `figentra-flow release` runs THE CLI SHALL list the pending changesets with each package's next version, the open version pull request, the Release workflow's last run on the default branch with its notices, and each package's published versions on its registry, and SHALL publish, version, dispatch and merge nothing itself
- **AC-014**: WHEN `figentra-flow ship <env>` runs for dev or staging THE CLI SHALL call runway deploy for that environment
- **AC-015**: IF `figentra-flow ship production` is asked for THEN THE CLI SHALL refuse and name `runway promote` by the owner
- **AC-016**: WHILE a repository is switched over THE repository SHALL require only `figentra-flow/gate` on main and keep only the Release workflow
- **AC-018**: WHEN `figentra-flow clean` decides whether a worktree is saved THE CLI SHALL count it saved when its head is on a remote ref or `git cherry origin/<default> HEAD` lists no `+` commit
- **AC-019**: WHILE a worktree has a detached HEAD THE CLI SHALL treat it like any other: removable when it is clean, idle and saved
- **AC-020**: IF a worktree's branch carries no issue key THEN THE CLI SHALL require it to be clean, saved and idle for at least 2 hours, measured from the HEAD reflog's modification time, instead of a Linear state
- **AC-021**: WHEN `figentra-flow clean` removes worktrees THE CLI SHALL report the disk space it freed
- **AC-022**: IF a worktree holds an ignored file outside the usual caches (such as `.env`, `ios/` or `android/`) THEN THE CLI SHALL keep it and name the files
- **AC-017**: WHEN `figentra-flow land --stack` runs on a stack of PRs THE CLI SHALL land them bottom-up in order, each only after its own green `figentra-flow/gate` on its rebased head
- **AC-027**: IF a running process (a session, a dev server, a shell) has its working folder inside a worktree, or running processes cannot be listed THEN THE CLI SHALL neither remove nor adopt it, and SHALL adopt a stray tree only after it has been idle for 2 hours
- **AC-028**: IF a repository keeps no preset source of its own and its installed `.specify` preset differs from the one bundled in Figentra Flow THEN THE spec gate (`figentra-flow gate ci`) SHALL fail and name the drifted file
- **AC-029**: WHEN `figentra-flow land` has squash-merged a branch THE CLI SHALL record its merge commit, and `figentra-flow clean` SHALL count that branch's worktree as saved once the merge commit is on the default branch
- **AC-030**: IF the default branch's ruleset does not require `figentra-flow/gate` and `--manual-ok` is not passed THEN THE CLI SHALL refuse to land and name phase 6
- **AC-031**: IF a PR whose spec is small, feature or big has no counted `AI-REVIEW: PASS <head> base=<base>` from the `stackra-reviewer` App (by App identity, unedited, not by the PR's author or the head commit's author or committer) THEN THE CLI SHALL refuse to land it and name the ignored verdicts
- **AC-032**: WHEN `figentra-flow status --metrics` runs THE CLI SHALL report, for the PRs merged in the window, lead time, cycle time, gate runs and their red share, rework, review rounds and approval latency, computed from GitHub and the specs without stored state
- **AC-033**: WHEN an agent connects to `figentra-flow mcp` THE server SHALL offer only read-only tools (status, spec, trace, worktrees, metrics) and none that writes, merges, lands, starts or cleans
- **AC-034**: IF a repository names no GitHub credentials (a wrapper script it has, or `gh-user` on purpose) THEN THE CLI SHALL refuse every GitHub call and never fall back to the caller's own `gh` login; `figentra-flow status --offline` makes none
- **AC-035**: WHEN a command starts THE CLI SHALL load `figentra-flow.config.json`, validate it against the shipped schema, and refuse an unknown key or a wrong type naming its path
- **AC-036**: IF a command needs a port the configuration does not set THEN THE CLI SHALL refuse and name the key, with no Figentra default anywhere in the core
- **AC-037**: WHEN the tracker is `linear`, `github-issues` or `jira` THE CLI SHALL derive issue keys, branch names and spec folders from the adapter, and read and move issues through it
- **AC-038**: WHEN `figentra-flow gate run` starts THE CLI SHALL run the check through the configured runner (`github-actions`, `ssh`, `local` or `command`) and pass its result through
- **AC-039**: WHEN `figentra-flow land` or the AI review reads a gate status or a verdict THE CLI SHALL match it by the gate and review identities in the configuration, and `figentra-flow app create` SHALL create an App by GitHub's manifest flow for a human only, handing its key straight to the secrets port
- **AC-040**: WHILE a command needs a secret THE CLI SHALL get it only through the secrets port's wrapped command or the environment, never reading, printing or storing a value itself
- **AC-041**: WHEN `figentra-flow sync` runs THE CLI SHALL install the configured preset: `neutral`, `stackra` or a repository path
- **AC-042**: THE package SHALL keep the product's name in one module, so a rename changes that module, `package.json` and the docs
- **AC-043**: IF a branch's diff against the default branch adds a path matching the configured artifact patterns (default `.cache/`, `node_modules/`, `dist/`, `.turbo/`, `coverage/`) or a file larger than the configured size (default 5 MB) THEN THE CLI SHALL refuse it in `figentra-flow gate run` and `figentra-flow land` and name each file
- **AC-044**: WHEN the `infisical` secrets adapter logs in by universal auth THE CLI SHALL put the token only in the `infisical run` process's environment, never in an argument, the command text, the output or a log, and SHALL take the project, environment and domain from the configuration
- **AC-045**: WHEN phase A's last step (A6) writes `figentra-flow.config.json` into our repositories THE CLI SHALL drop every transition for a repository without one (the `bot:git` lookup, the Linear `STA` tracker, the tester worktree names) in the same change
- **AC-023**: WHEN a spec carries a `**Session**` line THE CLI SHALL read it as the spec's assigned session and show it in `figentra-flow status`
- **AC-024**: WHEN `figentra-flow status` runs THE CLI SHALL list each session with its spec, worktree and the `figentra-flow/gate` result of the worktree's head
- **AC-025**: IF a feature- or big-tier spec past Clarified has no `**Session**` THEN THE CLI SHALL report it in `figentra-flow gate check` as a finding
- **AC-026**: WHILE more than two build sessions hold an In Progress spec and the owner has not raised the cap THE CLI SHALL report the excess in `figentra-flow status`
- **AC-046**: WHEN the configuration names a roster in `team` THE CLI SHALL read it and its role files with no new dependency, refuse YAML outside the supported subset by line, and publish `schema/team.roster.schema.json` and `schema/team.role.schema.json`
- **AC-047**: WHEN `figentra-flow team check` or `gate ci` runs on a repository with a roster THE CLI SHALL report duplicate ids, a label other than `role:<id>`, a role file whose id differs, an unknown or self `reviewed_by`, an unknown `rules.tests_run_by`, and an `approves` entry that names a category in `owner.keeps` as a whole word
- **AC-048**: IF a roster exists and a spec's `**Role**` or a task's `role:` names no known role, or a feature- or big-tier spec past Clarified has no `**Role**` THEN THE CLI SHALL report it as a gate finding; a task with no role SHALL be listed for the lead, never given one
- **AC-049**: WHEN `figentra-flow start` runs with a roster and a tracker THE CLI SHALL set the spec's `role:<id>` label and, for Linear, the roster's issue rule (assignee and delegate), and SHALL only warn when the tracker refuses
- **AC-050**: WHEN `figentra-flow status --by role [--role <id>]` runs THE CLI SHALL group the snapshot's specs by role with each role's sessions, in-progress, in-review and blocked counts and owner stops waiting, and SHALL add the same as `byRole` to the JSON snapshot
- **AC-051**: IF a review verdict's `role=` is the builder's role or not in the builder role's `reviewed_by`, or its `session=` is the builder's session THEN THE CLI SHALL refuse it in `figentra-flow land` as `REVIEWER_IS_BUILDER`
- **AC-052**: IF a change in a repository a role's `changes` names touches a path outside that role's `paths` THEN THE CLI SHALL warn at `start` and report a finding at `gate run` and `land`
- **AC-053**: IF a feature- or big-tier spec's `**Owner stops**` names a category the owner keeps THEN THE CLI SHALL accept its stage approvals only from the owner; and IF its Impact names money, security, legal, brand, pricing, secrets or public content while `**Owner stops**` says none THEN the plan gate SHALL report the mismatch
- **AC-054**: IF a pending changeset names a package the repository does not have, a package it names sets no `publishConfig.registry`, or a package's next version is already on its registry THEN `figentra-flow release` SHALL report it and exit 1
- **AC-055**: WHEN `figentra-flow doctor` runs THE CLI SHALL report each check (Node, git, configuration, `.flow/` install, ignored worktree folder, roster, credentials) as passed or failed with its fix, exit 1 when any failed, and with `--offline` SHALL make no network call

## Clarifications (the leader's answers at the spec stop, 2026-10-31)

- **Q1. Worktree name.** `<repo>/.claude/worktrees/sta-n-<slug>` (the plan); the slug comes from the Linear title
  unless `--slug` is given. **Answer: yes.** `figentra-flow clean` and `--adopt` skip every tester worktree name: `g-*`,
  `*-gate`, `land-*`, `tpl-core`, `c6-lock*` and `template-wt-lean`.
- **Q2. Base and install.** `figentra-flow start` branches from `origin/<default>` after a fetch through the repository's bot
  wrapper, and does not run `pnpm install` (the Mac runs only oxfmt and oxlint; `--install` opts in). **Answer: yes.**
- **Q3. The guard.** Figentra Flow ships `figentra-flow guard` (reads the agent's PreToolUse JSON, denies `git worktree add` outside
  `.claude/worktrees/`, allows everything else). Wiring it into each repository's `.claude/settings.json`, and the same
  rule into core's `.agents/hooks/_rules.mjs`, is guard configuration: the owner applies it, as with the STA-1721 hook
  patch. Figentra Flow prints the exact settings entry. **Answer: yes;** the leader takes the wiring to the owner.
- **Q4. Today's outside worktrees.** `figentra-flow clean --adopt` moves the clean ones in; a dirty one or one with unpushed
  work is listed for its owner. **Answer: yes, but** `os-lines-gate`, `stackra/pro-gate` and
  `stackra/template-wt-lean` belong to the tester: `--adopt` lists them for stackra-f4 and never moves them. Only the
  OS scratchpad worktrees and other non-tester ones move.
- **Q5. Which repositories.** A workspace list in `~/.config/figentra-flow/workspace.yaml` (path and GitHub slug per repo),
  written once by `figentra-flow init --workspace`; `figentra-flow status` and `figentra-flow clean --all` read it. **Answer: yes.**
- **Q6. The gate bot.** `figentra-flow gate` posts the status with the stackra-bot GitHub App token from the calling
  repository's wrapper (`pnpm bot:gh` today, the `figentra` CLI later). No human or agent token posts `figentra-flow/gate`.
  **Answer: yes.**
- **Q7. Land on a stacked PR.** `figentra-flow land` refuses a PR whose base is not the default branch; land the lower one
  first. **Answer: yes,** and a later `figentra-flow land --stack` lands a stack bottom-up, each layer after its own green
  gate (AC-017).
- **Q8. Where the spec lives.** This spec and its plan stay in Figentra Flow's `.agents/specs/`; the ADR is in core.
  **Answer: yes.**
- **Phase 1 also** adds `.claude/worktrees/` to `.gitignore` in billing, invoicing, brand, figentra-flow, stackra/notes and
  stackra/pro.
- **Later phases** fold in stackra-f4's `notes/plans/vellum-final-plan.md` (ownership, the move list, old-Figentra Flow
  verdicts, the agent-config model) when it lands.

## Status history

- 2026-10-31: Draft (questions sent to the leader for the spec stop)
- 2026-10-31: Draft → Clarified — Approved by leader 2026-10-31 (technical stop under ADR 0502; Q1 to Q8 answered)
- 2026-10-31: Clarified → Planned — Approved by leader 2026-10-31 (phase 1, with three revisions to `figentra-flow clean`: AC-018 to AC-022)
- 2026-10-31: Planned → Tasked (tasks for phase 1; later phases are placeholders)
- 2026-10-31: Tasked (scope added) — Approved by owner 2026-10-31 ("Yes, record it", relayed by the leader): the sessions phase, FR-10 and AC-023 to AC-026; designed at its own plan stop
- 2026-10-31: Tasked (revised) — Approved by leader 2026-10-31 (AC-027: never remove or adopt a tree a live session works in; adopt only after 2 h idle)
- 2026-11-01: Tasked (scope added): `release` reads and reports, the Release workflow publishes (FR-8 and AC-013 amended), `doctor` (FR-13, AC-054, AC-055); STA-1845 and STA-1846, designed for the leader's plan stop
- 2026-11-01: phase 7 agent-team roles Planned — Approved by leader 2026-11-01 (FR-12, AC-046 to AC-053; decisions A to D as recommended, plus the Impact mismatch check)
- 2026-10-31: phase 2 Planned — Approved by leader 2026-10-31 (the gate design: a dedicated Stackra Gate App, `figentra-flow gate ci` where Figentra Flow is installed, `--box` now, no secret in any log)
- 2026-10-31: Tasked (revised) — Approved by leader 2026-10-31 (AC-028: the tripwire compares the installed preset with Figentra Flow's bundled one once core keeps no copy, W2)
- 2026-10-31: phase 3 Planned — Approved by leader 2026-10-31 (land: merge-updated stacks, `stackra-gate[bot]` as defence in depth, any session, `--manual-ok` until phase 6 (AC-030), AC-029 kept)
- 2026-10-31: phase 3 Planned (revised) — Approved by leader 2026-10-31 (AC-031: the ADR 0230 AI review is a land rule for small, feature and big, ported from core's pr-merge.mjs; `figentra-flow review` follows land)
- 2026-10-31: Tasked (revised) — Approved by leader 2026-10-31 (AC-034: GitHub calls only with named credentials, never a silent personal `gh` fallback; the adapter phase moves the setting into `figentra-flow.config`)
- 2026-10-31: Tasked (scope added) — Approved by owner 2026-10-31 (relayed by the leader): the neutral core with adapters, FR-11 and AC-035 to AC-042; designed at its own plan stop before phase 4
- 2026-10-31: phase A Planned — Approved by leader 2026-10-31 (JSON config with schema, testbed as a command runner, github-actions for outsiders, app create human-only, Jira later, one-minor deprecation, product name held; AC-043 artifact guard added)
- 2026-10-31: phase 4 Planned — Approved by leader 2026-10-31 (metrics on demand, a hand-written MCP server with a conformance test, tracker state only with a tracker adapter, `sessionCap` in workspace.yaml; built after phase A)
- 2026-10-31: Tasked (revised) — Approved by owner 2026-10-31 (relayed by the leader, confirmed by the owner in the build session): the product is Figentra Flow, published as `figentra-flow`; no compatibility with the old names
- 2026-10-31: Tasked (revised) — Approved by leader 2026-10-31 (AC-044: the Infisical token by environment only, with project, env and domain from config, after the gate key moved to its own project; AC-045: A6 removes the config-less transitions with the config files)
