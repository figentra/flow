# Feature Specification: fflow owns every repository's agent and tool setup, under a governed preset

**Feature Branch**: `figentra/sta-1945-flow-owns-everything`

**Created**: 2026-11-02

**Status**: Tasked

**Tier**: big

**Approver**: owner (approved 2026-11-02, relayed by the leader session: "one command that syncs everything", after the
baseline gate); the governance model is the external review of 2026-11-02

**Linear**: STA-1945

**Clarifications status**: complete

**Clarifications**: Q1 to Q3 decided (D1 to D3, 2026-11-02); Q4 to Q6 decided (D6, 2026-11-03)

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

## Discovery

- **Current behaviour.** `fflow sync` (0.2.3) renders the `flow-*` skills and commands, the preset's three steward
  agents, the worktrees rule, the approval and baseline workflows, CODEOWNERS and, with `.flow/readme.yml`, the README
  (`src/lib/render.mjs`). It writes `.flow/lock.json` as `{ version, preset, files }`, and `gate ci` fails on a hand
  edit through `installProblems`. `.flow/overrides/` holds whole-file replacements only. `fflow guard` knows one rule
  (`git worktree add` outside `.claude/worktrees/`). There is no `check`, `diff`, `validate`, `update`, profile,
  record, `next`, `resume`, `task`, `stack`, `adr`, `todo` or `ledger` command; `land --stack` lands a stack
  bottom-up by merging the default branch into each PR. Task lines know only `[ ]` and `[x]`. Everything else in the
  agent layer is copied by hand into each repository (the census in Sources).
- **Topology.** One member, `packages/figentra-flow` (`@figentra-oss/flow`): `bin/fflow.mjs` dispatches to
  `src/commands/<name>.mjs`; shared code in `src/lib/*.mjs`, adapters in `src/adapters/`, tests flat in
  `src/__tests__/*.test.mjs`, presets in `assets/flow/presets/{neutral,stackra}/` (`preset.yml`, `agents/`,
  `commands/`, `rules/`, `templates/`), schemas in `schema/`. Flow's own ADRs live in `docs/adr/`.
- **Dependencies.** Node 24, plain ESM with JSDoc checked by `tsc`, no runtime dependency (`src/lib/yaml.mjs` reads
  YAML); git and the GitHub CLI on PATH; the testbed through the configured runner (`flow.config.json` `runner`);
  Linear through the tracker port.
- **Ownership.** Flow's maintainers own the package; the owner owns `.flow/overrides/`, the Flow configuration, the
  workflows and the secret guards (owner-only paths, STA-1856). Each repository owns its specs and its own facts.
- **Constraints already decided.** Stackra ADR 0503 (Flow runs the development workflow), ADR 0510 (Flow replaces
  spec-kit; the lock and `installProblems`), ADR 0502 (tiers and approval stops; this spec is big), ADR 0120 (spec
  location, lanes, risk), ADR 0065 rule 7 (a tracker failure never blocks a gate), ADR 0293 (agent network git goes
  through the bot), ADR 0468 (production waits on the owner's Environment approval); Flow ADR 0001 (session names);
  decisions D1 to D6 below.

### Sources

- Census and audit: notes `plans/flow-owns-everything-2026-11-02.md` (18 repositories),
  `plans/flow-consolidation-audit-2026-11-01.md`, `plans/after-freeze-backlog.md` (the CLI requirement of plan PR 9);
  the external review of 2026-11-02. These back FR-1 to FR-12 and FR-31.
- Flow source on `origin/main` (64a0f4d): `bin/fflow.mjs`, `src/lib/render.mjs`, `src/lib/flow-dir.mjs`,
  `src/lib/spec-parse.mjs`, `src/lib/workspace.mjs`, `src/lib/baseline.mjs`, `src/lib/snapshot.mjs`,
  `src/lib/owner-only.mjs`, `src/commands/{sync,guard,gate,gate-baseline,land,release,status,doctor,start,init,spec,trace}.mjs`,
  `assets/flow/presets/*/preset.yml`, and the installed 0.2.3's `fflow spec template` output for the spec, plan and
  tasks templates.
- Core on `origin/main`: `.agents/hooks/` (9 modules, 6 test files), `.agents/agents/` (28 role agents),
  `.agents/routing.yaml`, `.claude/settings.json`, `.opencode/`, `tools/scripts/adr-reserve.mjs` (STA-1732, the
  reservation FR-17 replaces), `tools/scripts/spec-gate.mjs` and `spec-trace.mjs`; ADRs 0502, 0503 and 0510 in
  `apps/docs/src/docs/adr/`.
- Issues: STA-1945, STA-2038 (A-1), STA-1942 and os#114 (the baseline, FR-22), STA-1865 and os#112 (lefthook, FR-7),
  STA-1936 (the 401 on `pnpm exec`), STA-1966 (the console engine, FR-31).
- Per requirement: FR-1 to FR-12 rest on the census, the audit and the external review; FR-13 to FR-22 on A-1's
  source; FR-23 to FR-25 on A-2's (Vellum, tag `legacy-2026-10-30`); FR-26 to FR-30 on A-3's; FR-31 on plan PR 9
  and the after-freeze backlog.

## Requirements

- **FR-1**: _One command per job._
  - `fflow sync` renders every owned file from the locked preset version and never adopts a newer one.
  - `fflow update [--preset <version>]` adopts a newer preset deliberately: it shows the diff, rewrites the lock,
    then syncs.
  - `fflow check` is for CI. It fails when an owned file differs from the lock, the preset differs from its locked
    digest, an override is invalid or past its review date, or a mandatory policy is off. It never writes.
  - `fflow diff` prints what `sync` or `update` would change.
  - `fflow validate` checks the config and the overrides against their schemas and the mandatory policies.
  - `--workspace <dir>` runs any of these over every repository under `<dir>` that has `flow.config.json`, and prints
    one line per repository.
- **FR-2**: _The lock_ (`.flow/lock.json`) records the preset (name, version, digest of its content), the Flow version,
  the profile (FR-6), the digest of the overrides, and every owned output with its digest.
- **FR-3**: _Provenance._ Every owned file that can carry a comment starts with a header naming fflow, the preset and
  version, and the override that shaped it, if any, with "do not edit; change `.flow/overrides/`". A file that can't
  (strict JSON such as `.claude/settings.json`) is identified by its lock digest alone. `check` finds a hand edit
  either way.
- **FR-4**: _Overrides_ live only in `.flow/overrides/<surface>/<id>.yml`, each one of:
  - `extend`: append to a list or section;
  - `configure`: set a parameter the preset declares;
  - `replace`: swap a whole output;
  - `disable`: drop an output.

  `replace` and `disable` need `reason`, `owner` and `review` (a date). `check` warns 14 days before the review date
  and fails after it. Overrides are owner-only paths (CODEOWNERS).

- **FR-5**: _Mandatory policies._ Secrets, tenancy, owner-only paths and the guard itself are mandatory. `validate`
  refuses any override that disables or replaces them; `extend` may only tighten them.
- **FR-6**: _Profiles._ A preset declares profiles; a profile selects which agents, skills and hooks a repository gets.
  The config names it; the lock records it. The stackra preset's profiles (D3): `framework` (core), `platform` (os,
  figentra), `product` (the products), `brand` (brand), `starter` (the template), and `pro` (stackra-pro) only if its
  needs differ from `framework`'s; otherwise stackra-pro uses `framework`.
- **FR-7**: _What `sync` renders_ (stackra preset; the neutral preset gets the generic parts):
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

- **FR-8**: _Third-party skills_ are not vendored. The preset lists each by source, version and licence, and `sync`
  installs it into a git-ignored folder, pinned by digest in the lock. A licence the preset hasn't allowed (anything
  but MIT, Apache-2.0, BSD or ISC) needs the owner's entry in the preset before it installs. Per D1, the preset marks
  some skills `machine-only`: `sync` neither installs nor records them, `check` refuses them in a repository or in
  the registry, and `fflow doctor` says how to install them from source on that machine:
  - HeroUI Pro's (`heroui-react-pro`, `heroui-pro-design-taste`) and Remotion's (the six `remotion-*`), for internal use
    only;
  - the owner's own 13 Claude skills.
- **FR-12**: _Core's 48 skills_ ship inside the stackra preset in 0.3.0 (D2). Publishing them as registry `skill` items is
  a later step, recorded in the after-freeze backlog; 0.3.0 builds no skill-publish pipeline.
- **FR-9**: _Divergence report._ `fflow status --divergence`, per repository or for the workspace, lists:
  - preset lag (locked against latest);
  - overrides by kind;
  - replacements and disables with their owner and review dates;
  - drift (owned files that differ from the lock).
- **FR-10**: _Migration_, one PR per step, with core's checks green at every step:
  1. Flow 0.3.0.
  2. Core repoints lefthook, the plan gate and the `.claude` hooks to `fflow`, and deletes its shims, its spec code
     and its guard copy (with a changeset for `@stackra/repo-checks`).
  3. Every repository re-syncs on 0.3.0, deleting in the same PR its spec-kit (`.specify`), copied hooks,
     `.opencode` guard copies and vendored skills.
  4. Dead files and old names are removed, and the owner gets the list of `~/.local/bin` scripts to remove.
- **FR-11**: _Tests cover:_
  - the five commands and `--workspace`;
  - the lock and its digests;
  - provenance headers;
  - each override kind, including expiry and the mandatory-policy refusal;
  - profiles;
  - each rendered surface;
  - guard parity (core's guard tests, ported);
  - skill installs refused on an unlisted licence;
  - the divergence report.

- **FR-31**: _CLI output and error handling_ (carried from plan PR 9, the owner's requirement after trying 0.2.3, so
  tasks can trace it; no new decision). Every command moves onto one output layer:
  - `doctor` is a grouped checklist (Check, Status, Detail, Fix; rows Machine, Repo, Flow, GitHub) with a summary
    line that sets the exit code; a missing `credentials` on a fresh local repository is information, not an error;
  - `status` shows tables (Specs, Worktrees, PRs, Sessions), with every problem under `--verbose`;
  - a failure is one boxed error block (what failed, why, the exact fix command, a docs link); raw git and pnpm
    output appears only under `--verbose`; a command checks for the repository before anything else;
  - `fflow` alone prints a banner, the version and the grouped commands; `--help` prints a command's usage and never
    runs it; an unknown command names the closest match and exits non-zero;
  - the brand theme comes from `@stackra/console`, loaded as an optional peer; without it, under `NO_COLOR` or in a
    pipe, the same tables print as plain text;
  - `--json` on `doctor`, `status` and `spec`, with the same data in a stable shape;
  - `init` writes a starter `flow.config.json` and syncs, and says what it rendered; `spec paths` and `gate dir`
    fall back to the spec folder of the branch's slug, and neither suggests the other in a loop.

## Amendment A-1 (2026-11-03): Flow first

**Source:** owner, 2026-11-03, relayed by the leader session ("all done and approved proceed"): "Flow is a first class,
anything can run in Flow … regardless if it's ultracode or not, we need to work in flows, end-to-end", and "Claude,
when it executes and understands all the requirements, starts to create workflows." Linear STA-2038. A-1 widens 0.3.0
from "Flow owns every repo's setup" to "Flow owns every task's life"; FR-1 to FR-12 stand. tasks.md is written after
the owner approves A-1.

### Requirements added by A-1

- **FR-13**: _Flow owns the lifecycle._ Every task in every repository runs through one chain of stage commands, each
  resumable from Flow's record by any session:
  `fflow start <issue>` → `spec` → approval → `plan` → worktree → build → `gate` → `review` → `land` → `release` →
  `ship`. `fflow next [<key>]` prints the task's current stage and the command that moves it on; `fflow resume <key>`
  re-enters a stage a dead session left half done. No side doors: the guard (FR-7) refuses `git worktree add` outside
  `.claude/worktrees/`, a push to the default branch, `gh pr merge` and `LEFTHOOK=0`; on GitHub the one required check
  is `fflow/gate`.
- **FR-14**: _Flow's record._ Each stage writes `.flow/record/<key>.json` on the task's branch: stage, state, approvals
  (who, when, the stage approved), sessions (name, kind, start and end), commits, PRs, gate and review results, and
  open owner asks. A stage that ends, and any session that stops, commits and pushes the record and the work with it
  (FR-19). After `land`, the record lands on the default branch with the change.
- **FR-15**: _Claude workflows inside stages._ Flow's agent bundle (rendered by `sync`, FR-7) ships named Claude Code
  workflows, each driven by the spec's requirements and acceptance criteria, which the stage command hands it and whose
  output it validates and records:
  - `plan`: splits a spec into PR-sized tasks (each with the FRs and ACs it covers, its files and a size budget) and a
    stack order, and writes tasks.md; it replaces separate `spec new / plan / tasks` commands;
  - `review`: parallel reviewers (correctness, simplicity, security and tenancy, contracts), then one verifier per
    finding; a confirmed blocking finding stops `land`;
  - `gate`: fans the check set out across testbed boxes by package shard and posts one `fflow/gate` status from them.
- **FR-16**: _Stacks._ `fflow stack` records a chain of PRs, each based on the one below. After the base squash-merges,
  Flow merges the default branch into the next PR (never a force-push), resolves each conflict in a file whose
  default-branch version equals the squashed parent's by keeping the child's version, retargets the PR to the default
  branch, and continues up the chain; it stops on any other conflict and names the file. `fflow land --stack` can
  instead land the top PR alone with the chain's combined change and close the rest as landed in it.
- **FR-17**: _Queued reservations._ `fflow adr reserve <slug> --issue <key>` takes Flow's queue lock, lands the
  reservation on the default branch (the repository's numbers file) and only then returns the number, so two sessions
  never take one number. The same queue serves any other numbered or ordered resource a preset declares.
- **FR-18**: _Hooks proven on the testbed._ When a checkout cannot run its hooks (no workspace install), the hook
  runner runs the same jobs on a testbed box for the staged tree and records the box run in the commit's
  `Hooks-Run:` trailer; `gate` refuses a commit with neither local hooks nor that trailer. `LEFTHOOK=0` is never an
  exception.
- **FR-19**: _Every session's work is recorded and pushed._ A session's stop hook (rendered by `sync`) commits the
  worktree as a WIP commit with the session's name, pushes it as the bot and appends to the record; nothing is left
  only on one machine.
- **FR-20**: _Session names_ follow the Flow ADR "session names" (`docs/adr/0001-session-names.md`):
  `TRACK · job (key)` while active or the focus, `hold · Track · job` on hold, `done · Track · job` when finished.
  `fflow status` shows each live session by name, state, worktree and stage, detected from running agent processes and
  their session files (not only a spec's `**Session**` line), and warns when a name breaks the pattern or disagrees
  with the record's state.
- **FR-21**: _The owner's to-do and ledger._ `fflow todo` lists everything waiting on the owner across the workspace
  (approvals, merges, releases, promotions, decisions, secrets to set), each with the command or link that clears it;
  `fflow ledger [--since <date>]` lists what landed, released and shipped, by day and track. Both read only Flow's
  records.
- **FR-22**: _The baseline-aware merge bot._ `land` merges on a gate that is green against the default branch's
  baseline (STA-1942): a task that newly passes is a gain, and a downstream task of the same package that newly runs
  and fails is reported as newly reached, not as a regression.

### Acceptance criteria added by A-1

AC-13 to AC-21, listed under `## Acceptance criteria`.

### Questions for the owner (A-1), decided by D6

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

## Amendment A-2 (2026-11-03): tasks that commands move (from Vellum)

**Source:** the owner, 2026-11-03, after comparing Flow with Vellum (Flow's predecessor, tag `legacy-2026-10-30`):
"add all three" (D4). Vellum's task core, adapted to Flow: commands, not agents, move a task, with evidence; the plan
splits tasks into waves that run in parallel; optional and checkpoint tasks. Vellum's signed approvals, hash-chained
ledger and 13-state lifecycle stay out (the decisions behind ADR 0510 stand).

### Requirements added by A-2

- **FR-23**: _Markers that commands move._ A task line carries `[ ]` not started, `[~]` queued, `[-]` in progress or
  `[x]` done; no agent edits a marker by hand.
  - `fflow task start <key> <task>` refuses unless the spec, plan and tasks are approved at their current content,
    then sets `[-]` and records the task's start (session, HEAD) in Flow's record (FR-14).
  - `fflow task done <key> <task> --command <cmd>` runs the task's check command itself, records the command, exit
    code, duration, HEAD and an output digest, and sets `[x]` only on exit 0 at a clean HEAD; on failure the marker
    stays `[-]` and the record keeps the attempt. A secret-looking command is refused.
  - When the spec, plan or tasks change after a task started, `check` resets that task to `[ ]` and says why.
  - `trace` and `status` count a task done only with passing evidence in the record; `check` refuses Done while any
    required task lacks it.
- **FR-24**: _Waves and the parallel build._ `fflow plan` (FR-15) writes the tasks' wave graph from their `deps` and
  paths (no two tasks of a wave share a path). The build stage's Claude workflow marks a wave's tasks `[~]`, runs them
  as parallel subagents (at most 5 at once), each through `task start` and `task done`, and stops at the wave boundary
  when one fails. `fflow next` and `resume` (FR-13) continue from the markers and the record, so a dead session's
  wave restarts at its first unfinished task.
- **FR-25**: _Optional and checkpoint tasks._ `T012*` marks a task optional: it may stay `[ ]` at Done but is reported.
  A phase may end in a checkpoint task (`Checkpoint: <command>`), which `task done` runs like any other and which no
  later wave starts before. The tasks template, `parseTasks`, `gate tasks` and `trace` read both.

### Acceptance criteria added by A-2

AC-22 to AC-27, listed under `## Acceptance criteria`.

## Amendment A-3 (2026-11-03): specs specific enough to check (from Vellum)

**Source:** the owner, 2026-11-03 (D5), after comparing Flow's spec and plan templates (about 140 and 105 lines) with
Vellum's requirements and design templates (223 and 342 lines): "so AI does not shift at all". A bigger template alone
does not stop drift; documents specific enough to check, and checks, do. Vellum's depth is merged into Flow's two
templates (not copied beside them), scaled by tier, and Flow enforces it.

### Requirements added by A-3

- **FR-26**: _Discovery in the spec._ Before its requirements, a spec states: current behaviour (what happens today
  without the change), the repository topology it lands in (members, folders, files), its dependencies, ownership,
  the constraints already decided (ADRs, rules), and **Sources**: every file, ADR, command or issue those statements
  rest on. A spec also states its measurable success, and non-functional requirements as their own EARS lines.
- **FR-27**: _A concrete plan._ For feature and big tiers, the plan states:
  - the key trade-off and a research summary;
  - an applicable-standards table: rule → how it is enforced (a check, or "review" as a finding);
  - an architecture diagram (Mermaid) with the dependency direction, and a sequence diagram where order or failure
    timing matters;
  - per component: responsibility, location, the folder tree of every file it adds, the real interface declarations
    in the repository's language (names, parameters, returns, thrown errors), behaviour (pseudocode for anything
    non-trivial) and failure modes per dependency;
  - partial-failure ordering, and open questions.
    A small tier keeps a one-page design inside the spec (ADR 0502), with the folder tree and interfaces still required.
- **FR-28**: _No placeholders, no open questions._ `gate` refuses approval of a document that still holds template
  placeholder text, an empty mandatory section, or an open question.
- **FR-29**: _Quality words._ `gate` flags vague terms in requirements and acceptance criteria (a word list in the preset,
  with worked examples in the template): a warning on small and feature tiers, a failure on big.
- **FR-30**: _Drift checks._
  - **Scope:** each task names only files from the plan's folder trees (or the spec's one-page design); `gate`
    reports any file a PR changes outside its tasks' files as scope drift (tests beside their subjects, changesets and
    lockfiles allowed). Scope drift fails the gate on big tiers and warns otherwise; the fix is an amendment.
  - **Contracts:** after build, every interface the plan declares exists in the code with the same name and signature;
    `trace` reports a missing or changed one.
  - **Approval binding:** an approval is bound to the document's content; editing an approved section re-opens its
    stage (FR-23's reset applies to the documents too).

### Acceptance criteria added by A-3

AC-28 to AC-34, listed under `## Acceptance criteria`.

## Acceptance criteria

AC-1 to AC-12 restate FR-1 to FR-12 as checkable criteria; AC-13 to AC-34 are the amendments' (A-1 to A-3,
approved 2026-11-03); AC-35 to AC-42 restate FR-31 and the parts of FR-13, FR-15 and FR-21 that no criterion covered.
None adds a decision.

- **AC-1**: WHEN `fflow check`, `diff` or `validate` runs THE command SHALL write no file; `check` SHALL exit non-zero
  and name each cause (an owned file that differs from the lock, with or without a provenance header; the preset
  differing from its locked digest; an invalid override; an override past its review date; a mandatory policy off);
  `diff` SHALL print every file `sync` or `update` would add, change or delete; `validate` SHALL name each config or
  override field that breaks its schema.
- **AC-2**: WHEN `sync` or `update` writes `.flow/lock.json` THE lock SHALL record the preset's name, version and
  digest, the Flow version, the profile, the overrides' digest and every owned output with its digest, and every
  comment-capable output SHALL start with the provenance header (FR-3); `sync` SHALL refuse instead when the installed
  preset's digest differs from the lock's, naming `fflow update`; `update` SHALL print the diff, rewrite the lock and
  then sync, and SHALL refuse a `--preset <version>` that is not the installed one; a v1 lock SHALL be rewritten as v2.
- **AC-3**: WHEN `sync`, `update`, `check`, `diff` or `validate` runs with `--workspace <dir>` THE command SHALL run in
  every repository under `<dir>` that has `flow.config.json` and print one line per repository.
- **AC-4**: IF a `replace` or `disable` override lacks `reason`, `owner` or `review` THEN THE `validate` command SHALL refuse
  it; `check` SHALL warn from 14 days before an override's review date and fail after it; `extend`,
  `configure`, `replace` and `disable` SHALL each change only their target, and a rendered file shaped by an override
  SHALL name it in its header.
- **AC-5**: IF an override disables, replaces or loosens a mandatory policy THEN THE `validate` command SHALL refuse it
  and name the policy; an `extend` whose result holds every preset rule SHALL be accepted.
- **AC-6**: WHEN the config names a profile THE `sync` command SHALL render only that profile's agents, skills and
  hooks and record the profile in the lock; with none named, the preset's default SHALL apply.
- **AC-7**: WHEN `sync` runs with the stackra preset THE repository SHALL get every FR-7 surface (role agents, skills
  including core's 48 from the preset itself, rules, agent reference, routing, models, `.claude/settings.json`, the
  OpenCode projection, `.mcp.yaml`, `lefthook.yml`, AGENTS.md, CLAUDE.md); an owned file the preset no longer renders
  SHALL be deleted, and `.agents/specs/` SHALL be unchanged.
- **AC-8**: WHEN `sync` renders `lefthook.yml` THE oxfmt and oxlint jobs SHALL run the mise-pinned binary first, use
  `pnpm exec` only where mise is missing and count exit 2 ("all ignored") as a pass; `mise.toml` SHALL pin
  `npm:oxfmt` and `npm:oxlint` at the catalog's versions with no other line changed; commit-msg SHALL skip commitlint
  without `node_modules/.bin/commitlint`, pre-push SHALL skip only on the registry's 401, and oxlint SHALL skip
  without `node_modules/@stackra/oxlint-config`, each with its note.
- **AC-9**: WHEN core's guard tests, ported, run against `fflow guard` with the stackra tables THE engine SHALL give
  every case the decision core's tests expect, the exact `figentra bot|linear|secrets` matches included.
- **AC-10**: IF a third-party skill's licence is not allowed THEN THE `sync` command SHALL refuse to install it
  (allowed: MIT, Apache-2.0, BSD, ISC, or the owner's entry in the preset); an allowed skill SHALL install into the
  git-ignored folder, pinned by digest in the lock; a `machine-only` skill SHALL be neither installed nor recorded,
  `check` SHALL refuse one committed to a repository, and `fflow doctor` SHALL name its source.
- **AC-11**: WHEN `fflow status --divergence` runs THE output SHALL list, per repository or for the workspace, the
  preset lag, the overrides by kind, the replacements and disables with owner and review date, and the drift.
- **AC-12**: WHEN a migration step (FR-10) lands THE core repository's checks SHALL be green on its PR, and that PR
  SHALL delete the copies the step replaces (core's guard, spec code and shims; another repository's `.specify`,
  copied hooks, `.opencode` guard copies and vendored skills).
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
- **AC-22**: WHEN an agent ticks `[x]` by hand without passing evidence THE `check` command SHALL refuse the spec and
  name the task.
- **AC-23**: WHEN `fflow task done` runs a command that exits non-zero THE marker SHALL stay `[-]` and the record SHALL
  keep the failed attempt with its exit code and digest.
- **AC-24**: WHEN a task's spec changes after it started THE task SHALL return to `[ ]` with the reason shown.
- **AC-25**: WHEN the build stage runs a wave of four independent tasks THE workflow SHALL run them in parallel and SHALL
  not start the next wave while one of them failed.
- **AC-26**: WHEN a session dies mid-wave THE next `fflow resume` SHALL restart at the wave's first unfinished task.
- **AC-27**: WHEN a spec reaches Done with an optional task still `[ ]` THE `check` command SHALL pass and `status` SHALL
  list the skipped optional task.
- **AC-28**: WHEN a spec has no Sources or a requirement cites none THE spec gate SHALL refuse the Clarified stage.
- **AC-29**: WHEN a feature or big plan lacks a component's folder tree or interface declarations THE plan gate SHALL refuse
  it and name the component.
- **AC-30**: WHEN an approved document still holds template placeholder text or an open question THE gate SHALL refuse
  the approval.
- **AC-31**: WHEN a big spec's acceptance criteria use a listed vague term THE gate SHALL fail and name the term.
- **AC-32**: WHEN a PR changes a file no task names THE gate SHALL report it as scope drift (failing on big tiers).
- **AC-33**: WHEN the code lacks an interface the plan declared, or its signature differs THE `trace` command SHALL report
  it.
- **AC-34**: WHEN an approved spec section is edited THE stage SHALL return to awaiting approval.
- **AC-35**: WHEN any `fflow` command fails THE CLI SHALL print one error block naming what failed, why, the exact fix
  command and a docs link, and SHALL show raw git or pnpm output only under `--verbose` (FR-31).
- **AC-36**: WHEN `--help` follows any command THE CLI SHALL print that command's usage and run nothing; `fflow` alone
  SHALL print the banner, the version and the grouped commands; an unknown command SHALL name the closest match and
  exit non-zero (FR-31).
- **AC-37**: WHEN `fflow init` runs in a fresh repository THE command SHALL write a starter `flow.config.json` and sync,
  and a following `fflow doctor` SHALL report no error; `doctor`, `status` and `spec` SHALL give the same data as
  tables, as plain text under `NO_COLOR` or a pipe, and as `--json` (FR-31).
- **AC-38**: WHEN an agent tries one of FR-13's side doors THE guard SHALL deny it and name the Flow command to use
  instead; the side doors are `git worktree add` outside `.claude/worktrees/`, a push to the default branch,
  `gh pr merge` and a command with `LEFTHOOK=0` (FR-13).
- **AC-39**: WHEN `fflow release` runs with pending changesets THE command SHALL open or update the version PR, and
  SHALL dispatch the publish only after the owner's GitHub Environment approval (FR-13, D6 Q4).
- **AC-40**: WHEN the review workflow confirms a blocking finding THE `land` command SHALL refuse the PR and name the
  finding (FR-15).
- **AC-41**: WHEN the gate workflow fans the check set out across testbed boxes THE gate SHALL post one `fflow/gate`
  status, green only when every shard passed (FR-15).
- **AC-42**: WHEN `fflow ledger --since <date>` runs THE output SHALL list what landed, released and shipped since that
  date, by day and track, read from Flow's records only (FR-21).

## Success criteria

The exit criteria of `path-to-100.md`, measurable:

- **SC-1**: every FR and AC of this spec is covered by a task with passing evidence and by a test (`fflow trace ci`
  clean) — verified by: `trace ci` in the gate.
- **SC-2**: `passthroughCommands(fflow)` is empty and the round-4 owner try-out has no finding — verified by: unit
  test and the owner's scripted checklist.
- **SC-3**: every repository's `fflow check` is green on the 0.3.0 preset and `fflow status --divergence` reports
  nothing unreviewed — verified by: `fflow check --workspace`.
- **SC-4**: on every repository `fflow/gate` is the only required check and per-PR workflows are off — verified by:
  `fflow doctor` on each repository.
- **SC-5**: `fflow todo` and `fflow ledger` replace the hand-kept state file — verified by: manual (the owner).

## Non-functional requirements

- **NFR-1**: THE `@figentra-oss/flow` package SHALL add no runtime dependency (Impact; `@stackra/console` is an
  optional peer loaded dynamically).
- **NFR-2**: THE guard SHALL run on each tool call as `node node_modules/@figentra-oss/flow/bin/fflow-guard.mjs
<event>`, never through `pnpm exec`, so pnpm's start-up stays off every call.
- **NFR-3**: THE preset and overrides digests SHALL be identical on every machine for the same content (paths sorted,
  line endings normalised before hashing).
- **NFR-4**: THE test suite SHALL run with no network, on fixture repositories in temporary folders.
- **NFR-5**: IF a command would print a secret-looking value THEN THE command SHALL refuse it (`task done
--command`, FR-23), and Flow SHALL carry secrets by name only.

## Decisions (owner, 2026-11-02, relayed by the leader session)

- **D1 (Q1)** HeroUI Pro's and Remotion's skills are kept for internal use only: installed from source on each
  machine, never redistributed (not in our repositories, not in the registry). The 13 "local library" skills are the
  owner's own Claude skills: that is their recorded source, and they are installed per machine like the others. The
  MIT and Apache-2.0 skills install through the preset as FR-8 says.
- **D2 (Q2)** Core's 48 skills ship inside the stackra preset; registry `skill` items come later (FR-12).
- **D4 (2026-11-03, the owner in the console-engine session)** Add Vellum's task core as A-2: markers that commands
  move with per-task evidence, waves with parallel subagents and resume, optional and checkpoint tasks. Signed
  approvals, the hash-chained ledger and the 13-state lifecycle stay out.
- **D5 (2026-11-03, the owner)** Add A-3: Vellum's requirements and design depth merged into Flow's spec and plan
  templates, scaled by tier, and enforced (sources, folder trees, interfaces, diagrams, no placeholders, vague words,
  scope and contract drift).
- **D6 (2026-11-03, the owner)** A-1 to A-3 approved with the recommended answers. **Q4:** `fflow release` drives the
  release: it opens the version PR and, on the owner's GitHub Environment approval, dispatches the publish; production
  stays the owner's. **Q5:** a stage's Claude workflow runs inside a Claude Code session (the stage's skill launches it;
  the CLI prepares its input and validates and records its output); headless runs come later, for the testbed.
  **Q6:** Flow's record lives on the task's branch and lands with the change; `--workspace` reads every repository's.
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
- 2026-11-03: A-2 added (FR-23 to FR-25, AC-22 to AC-27), owner decision D4 (Vellum's task core); A-1 and A-2 await
  the owner's approval of the text, then tasks.md
- 2026-11-03: A-3 added (FR-26 to FR-30, AC-28 to AC-34), owner decision D5 (spec and plan depth, enforced); A-1 to
  A-3 await the owner's approval of the text, then tasks.md
- 2026-11-03: Draft → Planned — Approved by owner 2026-11-03: A-1 to A-3 and D6 (Q4 to Q6 as recommended); tasks.md
  and the build follow `path-to-100.md`
- 2026-11-03: Draft → Clarified — Approved by owner 2026-11-03 (the text of A-1 to A-3, with D6; the original spec was
  Approved by owner 2026-11-02). Recorded in the form the gate reads (ADR 0502); the same approval as the next line's
  Planned one, which moved the spec on from Draft in one step
- 2026-11-03: spec and plan brought to the gate's standard by the spec-writer, content only and no new decision: the
  Discovery section with Sources (FR-26); the FR ids in the gate's form; one `## Acceptance criteria` section holding
  AC-13 to AC-34 and adding AC-1 to AC-12 (from FR-1 to FR-12) and AC-35 to AC-42 (from FR-31, FR-13, FR-15 and
  FR-21); FR-31 recorded from plan PR 9; success criteria from `path-to-100.md`; non-functional lines from the Impact
  and the plan; plan.md given the design sections, deploy modes and correctness properties
- 2026-11-03: Planned → Tasked: tasks.md written by the spec-writer (T001 to T127, by the waves of `path-to-100.md`,
  then the proof and the rollout); the plan's approval is the owner's of 2026-11-03 (the Planned line above). Awaits
  /flow-analyze and the lead's review of the plan's "Design choices where the spec is silent"
