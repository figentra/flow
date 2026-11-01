# @figentra-oss/flow

## 0.1.0

### Minor Changes

- b37fee9: The first release of Figentra Flow (`figentra-flow`, alias `fflow`): spec-driven development from the spec to the landed change.
  
  - **Specs:** `init` and `sync` install spec-kit with a preset, and `gate` and `trace` hold every spec, plan, task list and test in step (spec tiers, approval stops, EARS criteria, a nine-section design).
  - **Worktrees:** `start` makes the branch and the worktree in `.claude/worktrees/` and moves the issue to In Progress; `clean` removes finished worktrees without force; `guard` keeps every worktree there.
  - **The gate:** `gate run` checks the pushed head on a runner, and the box posts `figentra-flow/gate` as your gate App.
  - **Land:** `land` squash-merges only on a green gate on the exact head, the recorded approvals and the independent AI review; it sets the issue Done, removes the worktree and deletes the branch, and `--stack` lands a stack bottom-up.
  - **Configuration:** `figentra-flow.config.json` (with its schema) chooses the credentials, the tracker (Linear or GitHub Issues), the secrets source (environment or Infisical), the gate and review Apps, the worktrees `clean` keeps, and the artifact guard.
- 1677e9b: `gate run` with a `command` runner (the testbed) posts `figentra-flow/gate` on the caller's side: the box gets only the
  check and returns its exit code, and the gate App's key never reaches it. The poster runs only when `gate run` (or the
  gate workflow) starts it.
- 8addb46: `gate ci`, `gate run` and `land` end with a verdict line behind the Flow glyph (waiting, checking, approved, blocked,
  shipped), and `status` shows each PR's gate as its glyph. Magenta in a terminal; plain under `NO_COLOR` or when piped.
- e96a3b0: `figentra-flow release` reports what the next release would publish (pending changesets and next versions, the version PR, the Release workflow's last run and its notices, the registry's versions) and publishes nothing; `figentra-flow doctor` checks Node, git, the configuration, the `.flow/` install, the ignored worktree folder, the roster and the credentials.
  
  `figentra-flow init` now adds `.claude/worktrees/` to the repository's `.gitignore`, as FR-3 says (only `clean --fix-ignore` did).
- 6194ce0: `figentra-flow train`: release trains for repositories without GitHub's merge queue. `open` makes the train's milestone and label (the version next from changesets); `add` boards a PR only when it is open, on the default branch and green on `figentra-flow/gate` at its exact head; `close` cuts off; `build` merges the members into `train/<version>` with merge commits, ejects a conflicting member and, on a red gate, bisects the members to eject the first breaking one (`train.eject: "manual"` stops instead); `depart` fast-forwards the default branch to a tip that is green on its exact sha, after every `train.after` upstream is published, then opens the next train; `status` reports it all. The settings are the new `train` block of `figentra-flow.config.json`.
- d915a5d: Figentra Flow replaces spec-kit (ADR 0510). Flow owns the templates, the presets and the eight `flow-*` commands
  (`/flow-specify`, `/flow-clarify`, `/flow-plan`, `/flow-tasks`, `/flow-analyze`, `/flow-checklist`, `/flow-implement`,
  `/flow-converge`); `.specify/` becomes `.flow/` (constitution, overrides, `lock.json`); `figentra-flow spec` replaces
  spec-kit's scripts; `sync` renders the skills without `specify`; `gate ci`'s install check replaces the tripwire; bug
  specs live in `.agents/specs/bugs/`; and `figentra-flow migrate` moves a spec-kit repository over. Breaking: a
  repository on 0.1.x runs `figentra-flow migrate` once.
- 931b37e: `figentra-flow ship <dev|staging>` ships the tip of the default branch by dispatching the product's Runway deploy workflow (`deploy.yml`, input `environment`), so the deploy runs in CI from a commit of main. It refuses production outright: production moves only by `runway promote <sha>`, and the owner approves it.
- ce3a6ad: `start --role <id> [--session <name>]` (or the spec's `**Role**` and `**Session**`) sets the issue's one `role:<id>` label,
  makes the agent app the Linear delegate and records the builder in a comment; `team check --tracker` lists the role
  labels the tracker lacks. Flow never creates a label.
- 27930fe: With a roster, `land` refuses `REVIEWER_IS_BUILDER` (a PASS with no `role=`, from the builder's role or session, or from
  a role outside its `reviewed_by`), reports changed files outside the builder role's `changes` (also in `gate ci`, and
  as a warning at `start`), and accepts an owner-kept spec's approvals only from the owner. Verdict lines take optional
  `role=<id> session=<name>`.
- 49d4ce6: With a roster, specs carry `**Role**` and `**Owner stops**` and tasks `— role: <id>`: the gate reports unknown roles
  and categories, a feature or big spec past Clarified without them, and `**Owner stops**: none` beside an Impact that
  names money, security, legal, brand, pricing, secrets or public content. A task with no role is listed for the lead.
- 42deb67: Agent rosters: name one in `team` in `figentra-flow.config.json` and `figentra-flow team check` (also run by
  `gate ci`) validates it and its role files against the new `schema/team.roster.schema.json` and
  `schema/team.role.schema.json`. Flow ships no roles; without `team` nothing changes.
- 5e29c3c: `status --by role [--role <id>]` groups specs by the roster's roles with their sessions and the in-progress, in-review,
  blocked and waiting-on-the-owner counts; the JSON snapshot (and so the web page and the MCP `status` tool) carries the
  same as `byRole`, and each spec its `role` and `ownerStops`.
