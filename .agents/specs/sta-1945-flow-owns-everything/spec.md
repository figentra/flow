# Feature Specification: fflow owns every repository's agent and tool setup, under a governed preset

**Feature Branch**: `figentra/sta-1945-flow-owns-everything`

**Created**: 2026-11-02

**Status**: Draft (A-1 awaiting the owner's approval)

**Tier**: big

**Approver**: owner (approved 2026-11-02, relayed by the leader session: "one command that syncs everything", after the
baseline gate); the governance model is the external review of 2026-11-02

**Linear**: STA-1945

**Clarifications status**: complete (Q1 to Q3 decided: D1 to D3 below)

**Input**: Every repository carries its own copy of the agent layer. Core holds 28 role agents, 48 skills (481
files), 15 rules, 29 reference docs, a 16-file guard engine (`_rules.mjs` is 2,651 lines), 88 `.claude` files and 15
`.opencode` files. os carries a copy of the guard, and brand vendors 496 third-party skill files. The other repositories
copy lefthook, AGENTS.md and the rest by hand. The owner's target: `fflow sync` renders all of it from one preset,
and a repository commits only its own facts. The review adds the governance that keeps that honest: a locked preset,
detectable hand edits, reviewed overrides and policies no repository can switch off. Sources: notes
`plans/flow-owns-everything-2026-11-02.md` (the census of 18 repos) and `plans/flow-consolidation-audit-2026-11-01.md`.

## Impact

- **Apps touched**: none
- **Services touched**: none
- **Packages touched**: `packages/figentra-flow`: `sync`, `update`, `check`, `diff`, `validate`, `guard`, `render`, the
  lock, overrides and both presets (the stackra preset takes core's agents, skills, rules, reference, guard tables,
  routing and models)
- **Cross-service events**: none
- **Tenancy and data**: none in Flow. The guard's tenancy and secrets rules move unchanged and become mandatory
  policies (FR-5).
- **Secrets**: none read. The guard's secret rules and `.mcp.yaml`'s secret references move by name only.
- **ADR needed**: yes. Stackra ADR 0503 and ADR 0510 are amended (the agent layer moves from core into Flow's preset),
  and a Flow ADR covers the governance model (lock, provenance, overrides, mandatory policies).
- **New dependencies**: none at runtime
- **Deploy modes**: same everywhere (a developer tool)
- **Licence tier**: free. Third-party skills keep their own licences (FR-8).
- **Docs to update**: `packages/figentra-flow/README.md`, `AGENTS.md`, the preset docs, the changesets, core's ADRs
- **Lane**: full
- **Change risk**: R3. Core sessions depend on the guard every minute. A wrong render, or a guard that stops matching,
  either blocks every agent or lets a forbidden command through.

## Requirements

- **FR-1 One command per job.**
  - `fflow sync` renders every owned file from the locked preset version and never adopts a newer one.
  - `fflow update [--preset <version>]` adopts a newer preset deliberately: it shows the diff, rewrites the lock,
    then syncs.
  - `fflow check` is for CI. It fails when an owned file differs from the lock, the preset differs from its locked
    digest, an override is invalid or past its review date, or a mandatory policy is off. It never writes.
  - `fflow diff` prints what `sync` or `update` would change.
  - `fflow validate` checks the config and the overrides against their schemas and the mandatory policies.
  - `--workspace <dir>` runs any of these over every repository under `<dir>` that has `flow.config.json`, and prints
    one line per repository.
- **FR-2 The lock** (`.flow/lock.json`) records the preset (name, version, digest of its content), the Flow version,
  the profile (FR-6), the digest of the overrides, and every owned output with its digest.
- **FR-3 Provenance.** Every owned file that can carry a comment starts with a header naming fflow, the preset and
  version, and the override that shaped it, if any, with "do not edit; change `.flow/overrides/`". A file that can't
  (strict JSON such as `.claude/settings.json`) is identified by its lock digest alone. `check` finds a hand edit
  either way.
- **FR-4 Overrides** live only in `.flow/overrides/<surface>/<id>.yml`, each one of:
  - `extend`: append to a list or section;
  - `configure`: set a parameter the preset declares;
  - `replace`: swap a whole output;
  - `disable`: drop an output.

  `replace` and `disable` need `reason`, `owner` and `review` (a date). `check` warns 14 days before the review date
  and fails after it. Overrides are owner-only paths (CODEOWNERS).

- **FR-5 Mandatory policies.** Secrets, tenancy, owner-only paths and the guard itself are mandatory. `validate`
  refuses any override that disables or replaces them; `extend` may only tighten them.
- **FR-6 Profiles.** A preset declares profiles; a profile selects which agents, skills and hooks a repository gets.
  The config names it; the lock records it. The stackra preset's profiles (D3): `framework` (core), `platform` (os,
  figentra), `product` (the products), `brand` (brand), `starter` (the template), and `pro` (stackra-pro) only if its
  needs differ from `framework`'s; otherwise stackra-pro uses `framework`.
- **FR-7 What `sync` renders** (stackra preset; the neutral preset gets the generic parts):
  - role agents, skills, rules, agent reference, routing and models;
  - the guard: `fflow guard` is a neutral engine covering bash, paths, the plan gate, session context, post-write
    checks and prompt hints, with core's rule tables as stackra preset data. It keeps behaviour parity, including the
    exact `figentra bot|linear|secrets` matches, proved by porting core's guard tests;
  - `.claude/settings.json` (hooks and permissions) and the OpenCode projection (`opencode.jsonc`, `.opencode/`, the
    guard plugin);
  - `.mcp.yaml`: the preset's servers plus the config's additions, secrets by name;
  - `lefthook.yml`: the preset's hook steps plus the config's, including `fflow gate branch`;
    the oxfmt and oxlint jobs follow core's STA-1865 pattern in every repository: they run the mise-pinned binary
    first (`mise exec -- oxfmt …`), fall back to `pnpm exec` only where mise is missing, and keep the exit-2 "all
    ignored" handling. `pnpm exec` runs pnpm 12's lockfile trust-policy check first, which fetches registry metadata,
    so a Mac with no @figentra read token fails pre-commit with a 401 in any repository whose lockfile holds an
    @figentra package (os, STA-1936). `sync` makes sure `mise.toml` pins `npm:oxfmt` and `npm:oxlint` at the
    versions the catalog pins, which `repo-checks/tool-pins` requires;
  - AGENTS.md and CLAUDE.md: the preset's shared blocks plus the repository's facts from the config and
    `.flow/readme.yml`.

  `sync` deletes an owned file that the preset no longer renders. It never touches specs (`.agents/specs/`), which
  are the repository's own work.

- **FR-8 Third-party skills** are not vendored. The preset lists each by source, version and licence, and `sync`
  installs it into a git-ignored folder, pinned by digest in the lock. A licence the preset hasn't allowed (anything
  but MIT, Apache-2.0, BSD or ISC) needs the owner's entry in the preset before it installs. Per D1, the preset marks
  some skills `machine-only`: `sync` neither installs nor records them, `check` refuses them in a repository or in
  the registry, and `fflow doctor` says how to install them from source on that machine:
  - HeroUI Pro's (`heroui-react-pro`, `heroui-pro-design-taste`) and Remotion's (the six `remotion-*`), for internal use
    only;
  - the owner's own 13 Claude skills.
- **FR-12 Core's 48 skills** ship inside the stackra preset in 0.3.0 (D2). Publishing them as registry `skill` items is
  a later step, recorded in the after-freeze backlog; 0.3.0 builds no skill-publish pipeline.
- **FR-9 Divergence report.** `fflow status --divergence`, per repository or for the workspace, lists:
  - preset lag (locked against latest);
  - overrides by kind;
  - replacements and disables with their owner and review dates;
  - drift (owned files that differ from the lock).
- **FR-10 Migration**, one PR per step, with core's checks green at every step:
  1. Flow 0.3.0.
  2. Core repoints lefthook, the plan gate and the `.claude` hooks to `fflow`, and deletes its shims, its spec code
     and its guard copy (with a changeset for `@stackra/repo-checks`).
  3. Every repository re-syncs on 0.3.0, deleting in the same PR its spec-kit (`.specify`), copied hooks,
     `.opencode` guard copies and vendored skills.
  4. Dead files and old names are removed, and the owner gets the list of `~/.local/bin` scripts to remove.
- **FR-11 Tests cover:**
  - the five commands and `--workspace`;
  - the lock and its digests;
  - provenance headers;
  - each override kind, including expiry and the mandatory-policy refusal;
  - profiles;
  - each rendered surface;
  - guard parity (core's guard tests, ported);
  - skill installs refused on an unlisted licence;
  - the divergence report.

## Amendment A-1 (2026-11-03): Flow first

**Source:** owner, 2026-11-03, relayed by the leader session ("all done and approved proceed"): "Flow is a first class,
anything can run in Flow … regardless if it's ultracode or not, we need to work in flows, end-to-end", and "Claude,
when it executes and understands all the requirements, starts to create workflows." Linear STA-2038. A-1 widens 0.3.0
from "Flow owns every repo's setup" to "Flow owns every task's life"; FR-1 to FR-12 stand. tasks.md is written after
the owner approves A-1.

### Requirements added by A-1

- **FR-13 Flow owns the lifecycle.** Every task in every repository runs through one chain of stage commands, each
  resumable from Flow's record by any session:
  `fflow start <issue>` → `spec` → approval → `plan` → worktree → build → `gate` → `review` → `land` → `release` →
  `ship`. `fflow next [<key>]` prints the task's current stage and the command that moves it on; `fflow resume <key>`
  re-enters a stage a dead session left half done. No side doors: the guard (FR-7) refuses `git worktree add` outside
  `.claude/worktrees/`, a push to the default branch, `gh pr merge` and `LEFTHOOK=0`; on GitHub the one required check
  is `fflow/gate`.
- **FR-14 Flow's record.** Each stage writes `.flow/record/<key>.json` on the task's branch: stage, state, approvals
  (who, when, the stage approved), sessions (name, kind, start and end), commits, PRs, gate and review results, and
  open owner asks. A stage that ends, and any session that stops, commits and pushes the record and the work with it
  (FR-19). After `land`, the record lands on the default branch with the change.
- **FR-15 Claude workflows inside stages.** Flow's agent bundle (rendered by `sync`, FR-7) ships named Claude Code
  workflows, each driven by the spec's requirements and acceptance criteria, which the stage command hands it and whose
  output it validates and records:
  - `plan`: splits a spec into PR-sized tasks (each with the FRs and ACs it covers, its files and a size budget) and a
    stack order, and writes tasks.md; it replaces separate `spec new / plan / tasks` commands;
  - `review`: parallel reviewers (correctness, simplicity, security and tenancy, contracts), then one verifier per
    finding; a confirmed blocking finding stops `land`;
  - `gate`: fans the check set out across testbed boxes by package shard and posts one `fflow/gate` status from them.
- **FR-16 Stacks.** `fflow stack` records a chain of PRs, each based on the one below. After the base squash-merges,
  Flow merges the default branch into the next PR (never a force-push), resolves each conflict in a file whose
  default-branch version equals the squashed parent's by keeping the child's version, retargets the PR to the default
  branch, and continues up the chain; it stops on any other conflict and names the file. `fflow land --stack` can
  instead land the top PR alone with the chain's combined change and close the rest as landed in it.
- **FR-17 Queued reservations.** `fflow adr reserve <slug> --issue <key>` takes Flow's queue lock, lands the
  reservation on the default branch (the repository's numbers file) and only then returns the number, so two sessions
  never take one number. The same queue serves any other numbered or ordered resource a preset declares.
- **FR-18 Hooks proven on the testbed.** When a checkout cannot run its hooks (no workspace install), the hook
  runner runs the same jobs on a testbed box for the staged tree and records the box run in the commit's
  `Hooks-Run:` trailer; `gate` refuses a commit with neither local hooks nor that trailer. `LEFTHOOK=0` is never an
  exception.
- **FR-19 Every session's work is recorded and pushed.** A session's stop hook (rendered by `sync`) commits the
  worktree as a WIP commit with the session's name, pushes it as the bot and appends to the record; nothing is left
  only on one machine.
- **FR-20 Session names** follow the Flow ADR "session names" (`docs/adr/0001-session-names.md`):
  `TRACK · job (key)` while active or the focus, `hold · Track · job` on hold, `done · Track · job` when finished.
  `fflow status` shows each live session by name, state, worktree and stage, detected from running agent processes and
  their session files (not only a spec's `**Session**` line), and warns when a name breaks the pattern or disagrees
  with the record's state.
- **FR-21 The owner's to-do and ledger.** `fflow todo` lists everything waiting on the owner across the workspace
  (approvals, merges, releases, promotions, decisions, secrets to set), each with the command or link that clears it;
  `fflow ledger [--since <date>]` lists what landed, released and shipped, by day and track. Both read only Flow's
  records.
- **FR-22 The baseline-aware merge bot.** `land` merges on a gate that is green against the default branch's
  baseline (STA-1942): a task that newly passes is a gain, and a downstream task of the same package that newly runs
  and fails is reported as newly reached, not as a regression.

### Acceptance criteria added by A-1

- **AC-13**: WHEN a session stops mid-stage THE next session running `fflow resume <key>` SHALL continue from the
  record with no work lost.
- **AC-14**: WHEN the base of a three-PR stack squash-merges THE `fflow stack` command SHALL bring the next PR onto the
  default branch with no force-push and no hand-resolved conflict.
- **AC-15**: WHEN two sessions run `fflow adr reserve` at once THE queue SHALL give them different numbers, each on
  the default branch before it is returned.
- **AC-16**: WHEN a checkout has no workspace install THE commit SHALL carry a `Hooks-Run:` trailer from a testbed run
  and `gate` SHALL refuse a commit without hooks or trailer.
- **AC-17**: WHILE the default branch has known failures THE merge bot SHALL land a PR whose gate is green against the
  baseline, and SHALL refuse one that adds a failure.
- **AC-18**: WHEN any session stops THE record and the work SHALL be on the remote.
- **AC-19**: WHEN `fflow status` runs while a named agent session works in a worktree THE output SHALL show that
  session by name and stage, and SHALL flag a name that breaks the pattern.
- **AC-20**: WHEN the owner runs `fflow todo` THE output SHALL list every pending owner action from the records, each
  with its command or link.
- **AC-21**: WHEN `fflow plan` runs on an approved spec THE result SHALL be a tasks.md whose tasks together cover every
  FR and AC, each task within its size budget.

### Questions for the owner (A-1)

- **Q4 The release model.** (a) Today: `fflow release` only reports, and the Release workflow publishes when the
  owner merges the version PR. (b) `fflow release` drives it: opens the version PR, and on the owner's GitHub
  Environment approval dispatches the publish. Recommended: (b), so release is a Flow stage like the others; production
  stays the owner's approval either way.
- **Q5 Where a stage's Claude workflow runs.** (a) Inside a Claude Code session: the stage's skill launches the
  workflow, and the CLI command prepares its input and validates and records its output. (b) The CLI starts a headless
  Claude run itself. Recommended: (a); (b) later, for the testbed's unattended runs.
- **Q6 Where the record lives.** (a) On the task's branch, landing with the change (FR-14). (b) In one central
  "flow-records" repository. Recommended: (a); `--workspace` reads every repository's records for `status`, `todo` and
  `ledger`.

## Decisions (owner, 2026-11-02, relayed by the leader session)

- **D1 (Q1)** HeroUI Pro's and Remotion's skills are kept for internal use only: installed from source on each
  machine, never redistributed (not in our repositories, not in the registry). The 13 "local library" skills are the
  owner's own Claude skills: that is their recorded source, and they are installed per machine like the others. The
  MIT and Apache-2.0 skills install through the preset as FR-8 says.
- **D2 (Q2)** Core's 48 skills ship inside the stackra preset; registry `skill` items come later (FR-12).
- **D3 (Q3)** Profiles: `framework`, `platform`, `product`, `brand`, `starter`, and `pro` only if needed (FR-6).

## The questions as asked

- **Q1 Third-party skill licences** (brand today; source: brand's `.claude/skills/README.md` and the upstream repos):
  - MIT: nextlevelbuilder/ui-ux-pro-max-skill (`brand`, `design`, `banner-design`, `ui-ux-pro-max`),
    cloudai-x/threejs-skills (3), affaan-m/ECC (`liquid-glass-design`, `brand-discovery`), Dimillian/Skills
    (`swiftui-liquid-glass`), heroui-react (NextUI's MIT file);
  - Apache-2.0: pbakaus/impeccable, heroui-native, frontend-design;
  - proprietary: `heroui-react-pro` and `heroui-pro-design-taste` carry the HeroUI Pro License Agreement, so they may
    not be redistributable;
  - unclear: the six `remotion-*` skills (remotion-dev/skills declares no licence, and Remotion itself is under its
    own company licence); and 13 skills from the owner's local library with no source or licence recorded
    (`svg-logo-designer`, `better-typography`, `better-ui`, `apple-design`, `animate`, `animate-expo`,
    `animation-vocabulary`, `review-animations`, `improve-animations`, `design-review`, `mobile-native`, plus
    `accessibility` and `expo-design-system`, whose frontmatter says MIT).

  Decide: allow the HeroUI Pro and Remotion terms for internal use, or drop those skills; and name the source of the 13.

- **Q2** Should core's 48 Stackra skills live in the preset itself, or as published registry `skill` items that the
  preset pins by version? The second keeps the Flow package small. Either way, `sync` renders them.
- **Q3** Which profiles: `framework` (core), `product`, `platform` (os, figentra), `brand`, `starter` (template)?

## Not now

`sync --workspace` opening one PR per changed repository through `land` (the owner opens PRs until `land` covers it);
test-level baseline inventory (STA-1942 v2).

## Status history

- 2026-11-02: Draft → Clarified (owner decisions relayed by the leader session; the external review of 2026-11-02;
  Q1 to Q3 open)
- 2026-11-02: Q1 to Q3 decided (D1 to D3), relayed by the leader session
- 2026-11-02: Clarified → Planned (plan.md; the leader session reviews the plan before building)
- 2026-11-03: Planned → Draft: A-1 "Flow first" added (FR-13 to FR-22, AC-13 to AC-21, Q4 to Q6), owner-approved
  design relayed by the leader session (STA-2038); awaiting the owner's approval of the text, then tasks.md
