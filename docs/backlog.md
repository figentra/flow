# Vellum backlog

The queue of fixes and features still to do, in priority order. Agents take work from here;
nothing is done until its **Done when** checks pass and `pnpm turbo run build typecheck lint
test --force` is green.

**How to use it**

- Take the lowest-numbered item whose status is `queued` and whose **Depends on** items are all
  `done`. Items in the same release with no dependency between them can run in parallel, but
  never two agents in one working tree: give each its own branch or worktree.
- When you start an item, set its status to `in progress` and add your branch name. When you
  finish, set it to `done` and add the PR link.
- Owner `agent` means an agent can do it end to end. Owner `human` means it needs a person
  (a credential, an approval, or a decision). Never let an agent do a `human` item.
- New findings go at the end of the right section with the next free ID. Don't renumber.

**Statuses:** `queued` · `in progress` · `done` · `blocked` (say on what)

Last updated: 2026-09-28. V-11 decision (lead): no skip marker; a parent reflects its required children; an all-optional parent is [x] when all its children are [x].

Last updated before: 2026-09-27. Released so far: 0.1.0, 0.1.1, 0.1.2 on `https://npm.figentra.com/`.

## Summary

| ID   | Item                                                                     | Release | Owner             | Status                  |
| ---- | ------------------------------------------------------------------------ | ------- | ----------------- | ----------------------- |
| V-01 | Approvals stay valid across the checksum-form change                     | 0.1.3   | agent             | done, unreleased |
| V-02 | Formatter-proof checksum and wrapped/nested task reading                 | 0.1.3   | agent             | done, unreleased        |
| V-03 | Ledger records a key fingerprint, not a file path                        | 0.1.3   | agent             | done, unreleased |
| V-04 | Fix the flaky whole-repo hash in e2e                                     | 0.1.3   | agent             | done, unreleased |
| V-05 | A Property counts only when a verified task cites it                     | 0.1.3   | agent             | done, unreleased |
| V-06 | spec-tasks never makes Property tests optional                           | 0.1.3   | agent             | done, unreleased |
| V-07 | spec-run asks whether to include optional tasks                          | 0.1.3   | agent             | in progress |
| V-08 | spec-run asks what to do when a review gate blocks                       | 0.1.3   | agent             | in progress |
| V-09 | The recorded lifecycle state advances                                    | 0.1.3   | agent             | in progress |
| V-10 | Failed attempts appear in the Execution Log                              | 0.1.3   | agent             | in progress |
| V-11 | Consistent parent-task markers                                           | 0.1.3   | agent             | in progress |
| V-12 | Release 0.1.3                                                            | 0.1.3   | agent             | queued                  |
| V-13 | One git worktree per concurrent executor                                 | 0.1.4   | agent             | queued                  |
| V-14 | `vellum context <spec> <task>` per-task briefing                         | 0.1.4   | agent             | in progress (branch feat/vellum-context) |
| V-15 | Verification commands sized to the task                                  | 0.1.4   | agent             | queued                  |
| V-16 | spec-tasks warns about long dependency chains                            | 0.1.4   | agent             | queued                  |
| V-17 | Release 0.1.4                                                            | 0.1.4   | agent             | queued                  |
| E-01 | A requirements amendment invalidates later approvals                     | later   | agent             | in progress (branch fix/engine-gaps) |
| E-02 | Release gate's four unimplemented checks                                 | later   | agent             | queued                  |
| E-03 | `vellum sync` (the Projector)                                            | later   | agent             | queued                  |
| E-04 | Next permitted transition in status                                      | later   | agent             | in progress (branch fix/engine-gaps) |
| E-05 | verify selects specs by effective state                                  | later   | agent             | in progress (branch fix/engine-gaps) |
| E-06 | esbuild advisory via tsup                                                | later   | agent             | blocked (no fixed tsup) |
| R-01 | Infisical OIDC identity and GitHub variables for tag releases            | —       | human             | queued                  |
| R-02 | Developer read token in Infisical `/agents`                              | —       | human             | queued                  |
| R-03 | Try the Kiro Power in Kiro                                               | —       | human + agent     | queued                  |
| R-04 | Try the OpenCode package in OpenCode; add its MCP config                 | —       | human + agent     | queued                  |
| S-01 | Spec 002: re-approve requirements, answer assumption #10, approve design | —       | human             | queued                  |
| S-02 | Spec 002 glossary: the versioned, formatter-proof Artifact Checksum      | —       | human             | queued                  |
| P-01 | Playground 001: converge the review findings into tasks                  | —       | human (in Claude) | queued                  |
| P-02 | Playground 001: re-approve the plan and run the new tasks                | —       | human             | queued                  |
| P-03 | Playground: upgrade to 0.1.3                                             | —       | agent             | queued                  |
| H-01 | Review and drop the stash in the `vellum` checkout                       | —       | agent + human     | queued                  |
| H-02 | Untracked `packages/engine/src/coverage/index.ts`                        | —       | human             | queued                  |
| H-03 | Install git hooks (lefthook) in this repository                          | —       | agent             | queued                  |
| H-04 | Optional: git allowed-signers so `git log` shows SSH signatures          | —       | human             | queued                  |

## 0.1.3: blockers found testing 0.1.2 in a real project

### V-01 Approvals stay valid across the checksum-form change

- **Status:** done on branch `fix/formatter-proof-tasks`, not released
- **Why:** V-02 changes what the Artifact Checksum hashes. Against the playground spec,
  2 of its 3 approvals (requirements, tasks) no longer match under the new form, so upgrading
  mid-implementation would void them and `task start` would refuse.
- **Do:** keep the 0.1.2 canonical form as a frozen "form 1". New approvals record the form
  they were made under; an approval without one is form 1. Every approval check (strict
  verify, approval evaluation, pre-execution check, effective state, status, gate validator,
  plan approval) computes the artifact's checksum in that approval's form, through one shared
  helper. Frontmatter and `stamp` use the current form. Record as decision 14 in
  `.agents/specs/002-vellum-core/design.md`.
- **Done when:** a copy of the playground spec has all 3 approvals valid under the new build;
  a form-1 approval with a real content edit is invalid; new approvals are form 2; an e2e
  scenario builds a 0.1.2-shaped spec and shows its approvals still count.

### V-02 Formatter-proof checksum and wrapped/nested task reading

- **Status:** done on branch `fix/formatter-proof-tasks`, not released
- **Why:** prettier with default settings (one blank line after the frontmatter) voided every
  approval; wrapped task lines lost their `_Requirements:_` / `_Properties:_` trailers, so
  coverage failed.
- **Done when:** the original, prettier-default and `--prose-wrap always` versions of the
  playground plan have equal checksums and all read 24 tasks, 33 criteria, 13 Properties;
  e2e scenario 13 passes. (Met; decision 13 in 002's design.)

### V-03 Ledger records a key fingerprint, not a file path

- **Status:** done on branch `fix/formatter-proof-tasks`, not released
- **Why:** approvals write `"identity_key": "/Users/<name>/.ssh/id_ed25519.pub"`, committing a
  home-directory path into the repository.
- **Do:** record the SSH `SHA256:…` fingerprint or the GPG fingerprint. Old entries holding a
  path stay readable and don't fail verification.
- **Done when:** a test proves no entry written by `approve` contains a path or the home
  directory.

### V-04 Fix the flaky whole-repo hash in e2e

- **Status:** done on branch `fix/formatter-proof-tasks`, not released
- **Why:** assertions that hash the whole repository, `.git` included, failed about 3 in 35
  runs (scenarios 10 and 12), most likely because `git status` rewrites `.git/index`.
- **Do:** compare `git rev-parse HEAD`, `git status --porcelain=v1 -uall`, hashes of all
  non-`.git` files, and the ledger bytes.
- **Done when:** the e2e suite passes 15 runs in a row.

### V-05 A Property counts only when a verified task cites it

- **Status:** queued · **Depends on:** V-01
- **Why:** in the playground, `vellum verify` printed `Properties: 13/13 … Overall: PASS`
  while no Property test existed. Every Property was cited only by optional tasks that never
  ran. Vellum counts a citation as coverage even when the citing task has no evidence.
- **Do:** in strict verify, a Property is covered only when at least one task citing it has
  passing Evidence at HEAD or an ancestor. Plan approval still checks citation (it runs
  before any work). Report the rest as `PROPERTY_NOT_VERIFIED`, naming the Property and the
  unverified tasks that cite it.
- **Done when:** engine and e2e tests show a spec whose only citing task is optional and
  undone fails verify; completing that task makes it pass.

### V-06 spec-tasks never makes Property tests optional

- **Status:** queued · **Depends on:** V-05
- **Why:** the planner marked all 7 Property and example test tasks optional (`*`), so the
  design's Correctness Properties were never exercised.
- **Do:** in the spec-tasks skill and tasks template, a task that cites a Property is never
  optional. `vellum lint` reports an optional task that cites a Property
  (`OPTIONAL_PROPERTY_TASK`). Optional stays for genuine extras.
- **Done when:** method test and lint test cover it; the plugin copy is re-synced.

### V-07 spec-run asks whether to include optional tasks

- **Status:** queued
- **Why:** spec-run skipped 7 optional tasks without asking; the user found out from the final
  report.
- **Do:** at the start of a run with optional tasks and no `--include-optional`, ask with the
  assistant's question prompt: include them or not, recommending "include" when any optional
  task cites a Property or is the only test of a criterion. State the choice in the first
  status message.
- **Done when:** method test asserts the prompt and the recommendation rule.

### V-08 spec-run asks what to do when a review gate blocks

- **Status:** queued
- **Why:** two reviewers blocked (test-engineer: no Property tests; dependency-steward:
  critical advisory on vitest 2.1.9), and spec-run printed a report and stopped without
  offering a way forward.
- **Do:** when a blocking reviewer blocks, ask with options: turn the findings into tasks now
  (run spec-converge), run the skipped optional tasks, or stop and record why. Never offer to
  mark the spec complete over a block. Non-blocking HIGH findings are listed with the
  converge option.
- **Done when:** method test asserts the prompt and that no option bypasses a block.

### V-09 The recorded lifecycle state advances

- **Status:** queued · **Depends on:** V-01
- **Why:** with 13/13 required tasks verified, the playground spec still records
  `PLAN_IN_REVIEW`. Nothing records `PLAN_APPROVED`, `IN_PROGRESS` or `VERIFIED`, and the
  effective state never exceeds the recorded one.
- **Do:** follow 002's Table 5.A. The first `task start` after a valid plan approval records
  `IN_PROGRESS` (through `PLAN_APPROVED`). A passing `vellum verify` records `VERIFIED` when
  the effective state supports it (a state-only frontmatter change; markers and state are
  outside the checksum). Each recorded transition is a ledger entry if the design says so.
  Never record a state the effective state doesn't support.
- **Done when:** e2e lifecycle scenario shows the recorded state moving through
  `IN_PROGRESS` to `VERIFIED`, with approvals still valid.

### V-10 Failed attempts appear in the Execution Log

- **Status:** queued
- **Why:** the ledger held 2 failed attempts (tasks 1.3, 1.4) that never appeared as failure
  rows in `tasks.md`, contrary to the template's own rule.
- **Do:** either `vellum task complete` appends the row (success and failure) itself, or
  spec-implement's instructions make the failure row mandatory before retrying. Prefer the
  CLI, so it can't be forgotten. The Execution Log is outside the checksum, so this never
  voids the plan approval.
- **Done when:** e2e shows a failing then passing `task complete` produces both rows.

### V-11 Consistent parent-task markers

- **Status:** queued · **Depends on:** V-05
- **Why:** parent 2 showed `[x]` with optional children 2.4 and 2.5 undone; parent 5, whose
  children are all optional, stayed `[ ]`. Readers can't tell what "done" means.
- **Do:** decide one rule and record it in 002's design: a parent is `[x]` only when all its
  children, optional ones included, are `[x]` or explicitly skipped; otherwise it stays `[-]`
  once any child has started. Apply it in `task complete`'s roll-up.
- **Done when:** engine and e2e tests cover both shapes.

### V-12 Release 0.1.3

- **Status:** queued · **Depends on:** V-01 to V-11
- **Do:** bump `packages/vellum` to 0.1.3, rebuild and sync the Claude plugin, green gate, PR
  to `main`, merge, publish to `https://npm.figentra.com/` via
  `infisical run --env=prod --path=/ci`, delete the branch.
- **Done when:** `npm view @figentra/vellum version` (with a read token) shows 0.1.3 and the
  marketplace plugin shows 0.1.3.

## 0.1.4: faster, safer implementation runs

### V-13 One git worktree per concurrent executor

- **Status:** queued · **Depends on:** V-12
- **Why:** concurrent executors share one working tree and `task complete` requires files
  outside the spec to be committed, so one executor committed another's half-written
  `errors.ts`. A task's evidence commit can then contain another task's code.
- **Do:** spec-run gives each dispatched task its own git worktree and branch from the wave's
  base, and merges them in task order after the wave. A merge conflict fails the wave and is
  reported, never auto-resolved. `task complete` runs inside the task's worktree. Clean up
  worktrees after the merge.
- **Done when:** an e2e scenario runs two tasks of one wave concurrently and each evidence
  commit contains only its own task's files.

### V-14 `vellum context <spec> <task>` per-task briefing

- **Status:** queued · **Depends on:** V-12
- **Why:** each executor reads the full `requirements.md` (18 KB in the playground),
  `design.md` and `tasks.md` to write one file. This is the biggest cost of a run. Specified
  as context bundles in spec 034 (R37).
- **Do:** a read-only command (and MCP tool) printing the task line, the full text of every
  criterion and Property it cites, the design sections that mention the files or components
  it names, the glossary terms used, and the verification command, as Markdown or `--json`.
  spec-implement reads it instead of the whole spec, and falls back to the full documents
  only when the briefing says something is missing.
- **Done when:** the playground's task 2.3 briefing is under 5 KB and contains every cited
  criterion and Property; e2e covers the command and the MCP tool.

### V-15 Verification commands sized to the task

- **Status:** queued
- **Why:** every task ran the whole-package `tsc` and the full `vitest` suite, repeating all
  earlier work.
- **Do:** spec-implement's `--command` runs the task's own test file or a type check scoped to
  what it touched; Checkpoint tasks run the full suite. Update spec-tasks so each task names
  its verification command. Evidence stays mandatory for every required task.
- **Done when:** method tests assert the guidance; the template shows a per-task command.

### V-16 spec-tasks warns about long dependency chains

- **Status:** queued · lower priority
- **Why:** 9 waves for 18 tasks, most waves 1-2 tasks wide.
- **Do:** spec-tasks reports waves ÷ leaf tasks and suggests merging adjacent single-task
  waves that touch related files, without forcing it.
- **Done when:** method test asserts the warning.

### V-17 Release 0.1.4

- **Status:** queued · **Depends on:** V-13 to V-16
- **Do:** as V-12, for 0.1.4.

## Enterprise roadmap (from the 2026-09-28 product discussion)

Goal: Vellum is the spec kit software engineers trust at scale — "what you specify is what
ships, and you can prove it" — for any assistant, with no server and git as the only database.

| ID | Item | Why | Owner | Status |
|---|---|---|---|---|
| N-01 | Adversarial "try to cheat" e2e suite: every way an agent could fake completion, approval or coverage, each must fail | The verifier is the product; the playground run found a false PASS | agent | queued |
| N-02 | Mutation testing on `packages/engine` with a real threshold in CI | Proves the tests catch wrong verdicts, not just run | agent | queued |
| N-03 | Dogfood: Vellum's own specs (002) pass `vellum verify` in its CI | The product must hold itself to its promise | agent + human (approvals) | queued |
| N-04 | GitHub Action / PR check: `vellum verify` on the PR, annotations per finding; GitLab CI template | "Ship end to end" needs the gate where merges happen | agent | queued |
| N-05 | Merge and release gates usable (E-02) and wired to the PR check | The lifecycle currently ends at VERIFIED | agent | queued |
| N-06 | `vellum init`: policy (signing key detection), `.npmrc`/install hint, assistant plugin install, first spec | One-command onboarding | agent | queued |
| N-07 | Public distribution decision: public npm with provenance vs private registry | A private registry cannot reach millions of users | human | queued |
| N-08 | Protocol versioning and a migration test per release; deprecation policy | Upgrades must never void approvals (V-01 was the first case) | agent | queued |
| N-09 | Team approval: multiple approvers, per-path approvers, risk classes that change the gates | Enterprises approve by ownership, not one person | agent | queued |
| N-10 | Nightly real-world run: fresh project, released package, headless Claude through the whole lifecycle plus cheat attempts; findings into this backlog | Automates how the last six bugs were found | agent + human (token, budget) | queued |
| N-11 | More assistants: Cursor, Copilot, Codex renderers; a spec-kit extension that calls `vellum` | Reach | agent | queued |
| N-12 | Supply chain: signed releases, SBOM, SLSA provenance | Enterprise procurement | agent + human | queued |
| N-13 | Docs site: concepts, lifecycle, CLI, method, troubleshooting | Adoption | agent | queued |

## Known engine gaps

| ID   | Gap                                                                                                 | Impact                                            | Reference                                  |
| ---- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| E-01 | Amending requirements doesn't invalidate the design and plan approvals                              | A design stays approved against old requirements  | 002 criteria 8.6, 8.7                      |
| E-02 | Release gate: migration safety, deployment readiness, security, post-release plan are `NOT_CHECKED` | The release gate can never pass                   | `packages/engine/src/gate/release-gate.ts` |
| E-03 | `vellum sync`, the Projector, exits 2                                                               | Assistant projections aren't generated by the CLI | 002 requirement 13                         |
| E-04 | Next permitted transition not computed                                                              | status can't say what comes next from state alone | 002 criterion 6.5                          |
| E-05 | verify selects specs by recorded, not effective, state                                              | Minor selection difference                        | 002 criterion 12.9                         |
| E-06 | Low advisory GHSA-g7r4-m6w7-qqqr, esbuild via tsup                                                  | Dev-only; tsup 8.5.1 still pins esbuild 0.27      | blocked until tsup updates                 |

## Release setup (human)

| ID   | Item                                                                                                                                                                     | Why                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | Infisical machine identity with GitHub OIDC for `figentra/vellum` tag refs, reading `/ci` (prod); repository variables `INFISICAL_IDENTITY_ID`, `INFISICAL_PROJECT_SLUG` | `.github/workflows/release.yml` can't publish on a tag without them; releases are published from a maintainer's machine until then |
| R-02 | A `package:read` token on `@figentra/*` in Infisical `/agents` (dev) as `NPFLARED_AUTH_TOKEN`                                                                            | Developers and the playground install with the CI publish token today                                                              |
| R-03 | Install and try the Kiro Power (`packages/plugin-kiro/dist`) in Kiro                                                                                                     | Built and tested, never used                                                                                                       |
| R-04 | Try the OpenCode package in OpenCode; confirm the V2 config format and add its MCP config                                                                                | Built and tested, never used; no MCP config shipped                                                                                |

## Spec 002 decisions (human)

| ID   | Item                                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| S-01 | Re-approve requirements; answer assumption #10; approve the design                                                                 |
| S-02 | Amend the glossary's Artifact Checksum to the versioned, formatter-proof canonical form (decisions 8, 12, 13 and 14 in the design) |

## Playground spec 001-network-package

| ID   | Item                                                                                                                                                                                                                                                                      | Owner            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| P-01 | `/vellum:spec-converge 001`: tasks for vitest ≥ 3.2.6 (critical advisory GHSA-5xrq-8626-4rwp), the fetch-abort misclassification (`isAbortError` checks only `name`), the body read outside the timeout (`dispose()` before `raw.text()`), and the missing Property tests | human, in Claude |
| P-02 | `npx vellum approve 001 tasks`, signed commit, then `/vellum:spec-run 001 --include-optional`                                                                                                                                                                             | human            |
| P-03 | Upgrade the playground to 0.1.3 once released                                                                                                                                                                                                                             | agent            |

## Housekeeping

| ID   | Item                                                                                                                                | Owner                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| H-01 | `stash@{0}` in the `vellum` checkout holds 8 leftover files from before PR #1; confirm nothing is missing from `main`, then drop it | agent checks, human confirms |
| H-02 | Untracked `packages/engine/src/coverage/index.ts` of unknown origin; keep and commit it, or delete it                               | human                        |
| H-03 | Install the lefthook git hooks in this repository                                                                                   | agent                        |
| H-04 | Optional: `gpg.ssh.allowedSignersFile` so `git log --show-signature` shows SSH signatures as good                                   | human                        |
