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
- **New dependencies**: `@stackra/console` and `@stackra/validation` at runtime (ADR 0506 decision 8, NFR-1)
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
- A-4 to A-7 (2026-11-04): Stackra ADR 0523 (`apps/docs/src/docs/adr/0523-humans-approve-policy-not-instances.mdx`)
  and ADR 0506 decision 8; notes `plans/flow-e2e/L2-DESIGN.md` (with the owner's answers 5 to 11),
  `plans/flow-e2e/PLAN.md` sections 3, 9 and 10, `plans/day1-2026-11-04/PLAN.md` (owner defaults O4 and O9),
  `handover/gap-scan-2026-11-04.md` section 3 and `plans/infisical-2026-11-04/PLAN.md` (K7); Flow PRs #100, #104,
  #116, #117, #121 to #127 and the open #128; issues STA-2097 and STA-2098.
- Per requirement: FR-1 to FR-12 rest on the census, the audit and the external review; FR-13 to FR-22 on A-1's
  source; FR-23 to FR-25 on A-2's (Vellum, tag `legacy-2026-10-30`); FR-26 to FR-30 on A-3's; FR-31 on plan PR 9
  and the after-freeze backlog; FR-32 to FR-36 on ADR 0523 and the L2 design; FR-37 to FR-40 on PLAN section 9 and
  O9; FR-41 to FR-44 on PLAN section 10; FR-45 and FR-46 on O4 and the gap scan.

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
    the oxfmt and oxlint jobs follow core's hook rule (STA-1865, as STA-2039 amended it) in every repository: they
    run the mise-pinned binary, named in `mise exec` (`mise exec npm:oxfmt -- oxfmt …`), and never fall back to
    `pnpm exec`: where mise is missing the stackra preset skips them with a note and CI checks, and the neutral
    preset runs the installed `node_modules/.bin` binary. The oxfmt job passes an all-ignored staged set through
    `--no-error-on-unmatched-pattern`, and its exit 2 (a file oxfmt cannot parse) fails. `pnpm exec` runs pnpm
    12's lockfile trust-policy check first, which fetches registry metadata (a 401 on a Mac with no @figentra read
    token, os STA-1936), and pnpm 12's exec installs whole workspaces from a hook (STA-2039). `sync` makes sure
    `mise.toml` pins `npm:oxfmt` and `npm:oxlint` at the versions the catalog pins, which `repo-checks/tool-pins`
    requires;
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
  - the brand theme comes from `@stackra/console`, a runtime dependency (ADR 0506 decision 8, NFR-1); under
    `NO_COLOR` or in a pipe, the same tables print as plain text;
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
  `.claude/worktrees/`, a push to the default branch, `gh pr merge` and `LEFTHOOK=0`; on GitHub the required checks
  are the ones A-4 names.
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
    Its contract with the testbed (owner-approved 2026-11-03, STA-2042, core #315 FR-010 to FR-012):
    - **One call per shard.** `stackra testbed run "<session> <what>" <dir> "<cmd>" --json`. The testbed picks the
      region, box and slot (heavy for encore test, Playwright, e2e, act and builds; light otherwise). The gate never
      names them.
    - **Fan-out.** The gate runs at most the free slots that `stackra testbed status --json` reports per region (up to
      12: 4 heavy and 8 light across four regions). A call over the cap waits inside `run`.
    - **Exit codes.** The job's own code; 2 usage; 73 no free slot under `--no-wait` (retry); 75 no healthy box (retry,
      else an infrastructure failure, never a test failure); 124 the 3-hour limit.
    - **Output.** The job's output streams to stderr unchanged, then stdout carries one JSON line:
      `{region, box, slot, waitSeconds, runSeconds, exitCode}`.
    - **Ordering.** The testbed keeps no queue across calls, so the gate owns ordering.
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

## Amendment A-4 (2026-11-04): ADR 0523 and the L2 lane

**Source:** Stackra ADR 0523 (accepted 2026-11-03, "humans approve policy, not instances", decisions 3, 5, 6 and 9);
the L2 design (notes `plans/flow-e2e/L2-DESIGN.md`, design "d") and the owner's answers 5 to 11 to it, relayed by
the leader session on 2026-11-04; notes `plans/infisical-2026-11-04/PLAN.md` K7. Built by PRs #116 (A), #117 (B),
#125 (C), #127 (D) and #123 (F), merged, and #128 (E), open. A-4 records what merged; it replaces FR-13's
required-check clause and SC-4, and changes no other requirement.

### Requirements added by A-4

- **FR-32**: _Approval is policy, not an instance._ Main's own `.github/workflows/fflow-approve.yml` approves and
  merges, as the Figentra Flow App, on events (`pull_request_target`, `status`, `issue_comment`, `schedule`, and the
  gate's `workflow_run`), never from a PR's code and never on a dispatch. Its jobs:
  - `cancel` withdraws a request when its PR is pushed, frozen or not;
  - `route` (no key) finds the open PRs labelled `fflow:land`;
  - `approve` runs every land rule again on the server (`decide`, then `landRules`), approves at most once per head,
    and keeps one sticky comment and a `fflow/land` status;
  - `merge` squash-merges in number order, pinned to the head SHA, on Flow's approval at that head or, for an
    owner-only PR, the owner's;
  - `verdict` (a `github-actions` runner only) posts `fflow/gate` from the gate run's `check` job conclusion, never
    from an artifact, and leaves a PR that changes `.github/workflows/**` pending until the owner approves at its head.

  The event lane renders only when the config sets `secrets.oidc`; without it `fflow-approve.yml` renders as before.
  Required checks (replacing FR-13's clause): Quality Gate's `verify` is the one required check today; `fflow/gate`
  becomes required once the owner pins it in the ruleset to the Figentra Flow App's integration id (5555587). ADR
  0523 decision 3 adds `fflow/render-equivalent` where it applies.

- **FR-33**: _Narrowed tokens over OIDC._ Each job mints its own Figentra Flow installation token in process
  (`src/lib/app-token.mjs`): the job's OIDC token logs in to Infisical, which returns the App key from `/ci/gate`; the
  token covers this one repository and only the permissions of its role (`approve`, `merge`, `merge-workflows` for an
  owner-approved workflow change only, `verdict`). A wider grant is revoked before the job fails, and every token is
  revoked when its job ends. The mint refuses before any network call unless the job runs main's `fflow-approve.yml`
  at `refs/heads/<default>` on a GitHub-hosted runner for one of FR-32's events. The config's `secrets.oidc` names
  the `audience`; the identity's id comes from the Actions variable `FFLOW_OIDC_IDENTITY_ID`, or from
  `secrets.oidc.identityId`, which wins (#129). Moving Flow and each consumer onto it and retiring `FFLOW_APPROVER_*`
  is the Infisical plan's K7.
- **FR-34**: _AI review is advisory_ (ADR 0523 decision 6). A missing, stale or FAIL AI-REVIEW verdict never refuses
  a land: `land` prints a warning, and the squash body records `AI-Review: PASS <sha>`, `AI-Review: FAIL <sha>` or
  `AI-Review: none`. A verdict counts only from a listed reviewer App (`apps.review.slug`, one slug or a list). A
  confirmed blocking finding of the review workflow (FR-15, AC-40) still refuses.
- **FR-35**: _The freeze switch_ (ADR 0523 decision 9). The org Actions variable `FIGENTRA_AUTOMATION` is `on`
  (every job runs), `merge-only` (the `verdict` and `merge` jobs run; nothing new is approved) or `frozen`; missing,
  unreadable or any other value is frozen. Frozen, the jobs post nothing and exit 0. The App never gets Variables
  write.
- **FR-36**: _Builders request; the fallback stays one release._ `fflow land` asks for a land with stackra-bot's
  existing rights, by the `fflow:land` label or a `/fflow land` comment, and waits for the head-bound `fflow/land`
  status; builders need no Actions write (PR E). The old `approve-dispatch` job, with the `FFLOW_APPROVER_*`
  secrets, stays in `fflow-approve.yml` for one release as the fallback. Release N+1 removes it, `approveSecrets()`,
  the presets' approver secret names and land's dispatch and auto-merge code (the L2 design's PR G).

### Acceptance criteria added by A-4

AC-44 to AC-50, listed under `## Acceptance criteria`.

## Amendment A-5 (2026-11-04): Flow as a general product

**Source:** the owner, 2026-11-04: Flow is sold to anyone, so the Stackra preset moves out of Flow into a
Stackra-owned package (notes `plans/flow-e2e/PLAN.md` section 9, STA-2097); owner default O9 (notes
`plans/day1-2026-11-04/PLAN.md`): third-party skills are not vendored. Built so far by PRs #124 (P1) and #100;
#121 gave Flow its pitch for any team, `SECURITY.md` and `CONTRIBUTING.md` (P4). A-5 settles FR-8 for the skills
core vendored and corrects FR-12's counts.

### Requirements added by A-5

- **FR-37**: _A preset is an npm package._ `flow.config.json` `preset` takes, in this order, a built-in name
  (`neutral`, and `stackra` until FR-39 lands), an installed package name (`@stackra/flow-preset`) or a repository
  path. A package names its preset folder in `package.json` (`"flow": { "preset": "./preset" }`), laid out as a
  built-in preset; Flow refuses a folder whose real path leaves the package. A preset states the Flow versions it
  supports in `peerDependencies["@figentra-oss/flow"]` and `preset.yml` `requires.flow`; `sync` and `update` refuse
  a Flow version outside either range, and `doctor` names it. `fflow preset add <pkg> [--dry-run]` installs the
  package with the repository's package manager and writes `preset`, keeping the rest of the config. Flow adds no
  postinstall and patches nothing on install: it loads code only from the preset the config names. The lock and the
  provenance headers record the package's version.
- **FR-38**: _Guard exports._ Flow exports, as package entry points, the guard modules a preset's `guard/*.mjs`
  imports (`src/guard/io.mjs` and the rest), so a package preset carries `guard/` with no relative path into Flow's
  source.
- **FR-39**: _The stackra preset moves to Stackra._ `@stackra/flow-preset`, at core's
  `packages/developer/flow-preset`, carries what `assets/flow/presets/stackra/` holds today, the shared files `init`
  and `sync` install included. ADR 0510 is amended first (presets are packages, no auto-patching, the marketplace
  path). The Stackra repositories then switch `"preset": "stackra"` to `"@stackra/flow-preset"`, and Flow keeps only
  `neutral`.
- **FR-40**: _Third-party skills are not vendored_ (O9). `third-party.yml` lists each upstream skill by source and
  licence. Until a skill is pinned by commit and tree digest (computed on the testbed) it is `machineOnly`; once
  pinned, `sync` installs it into `.agents/skills/.vendor/` (FR-8). The preset carries only Figentra's own skills:
  on main, FR-12's "core's 48 skills" are 16 of Figentra's own beside the `flow-*` ones, with the 20 upstream skills
  core vendored listed in `third-party.yml`; the preset's role agents are 27 and core's rules 14, not 28 and 15.

### Acceptance criteria added by A-5

AC-51 to AC-55, listed under `## Acceptance criteria`.

## Amendment A-6 (2026-11-04): harness adapters

**Source:** the owner, 2026-11-04: Flow asks its questions through each tool's own question UI and works the same in
Claude Code, OpenCode, VS Code and the rest (notes `plans/flow-e2e/PLAN.md` section 10, STA-2098). Built so far by
PR #126 (H1 to H4).

### Requirements added by A-6

- **FR-41**: _Capability markers._ A command text marks a step by capability, not by tool: the question step sits
  between `<!-- flow:ask -->` and `<!-- /flow:ask -->` (clarify and specify, both presets). `flow.config.json`
  `harnesses` lists the tools a repository renders for, and a harness adapter per tool fills each marked step in when
  `sync` renders. With no harness listed, the markers are dropped and the text table stays, so the render is
  unchanged.
- **FR-42**: _Adapters._
  - `claude-code`: the ask step instructs `AskUserQuestion` (1 to 4 questions, 2 to 4 options, the recommended one
    first), with the text table as fallback; `opencode`: its `question` tool, in the same shape.
  - `copilot` (`.github/prompts/flow-<verb>.prompt.md`), `cursor` (`.cursor/commands/flow-<verb>.md`) and `codex`
    (`.agents/skills/flow-<verb>/SKILL.md`): prompt files with the text table, provenance headers and lock digests.
  - Dropping a harness drops its unedited files.
  - Last (H6, after FR-39): Flow's render replaces core's own `.agents` sync script in every repository.
- **FR-43**: _`fflow mcp` question tools._ Two read tools, `fflow_questions_list` and `fflow_docs_lookup` (bounded,
  no symlink, no path outside the repository), and one writer, `fflow_clarification_record`: it writes a Q/A bullet
  under `## Clarifications` → `### Session <date>` only in `<repo>/.agents/specs/<folder>/spec.md`, and uses MCP
  elicitation only when the client declared it. Every tool carries `readOnlyHint`. The spec is the record: an answer
  lives in the spec, never only in a chat.
- **FR-44**: _Asynchronous questions_ (H5). An agent that runs unattended posts its question on the task's tracker
  issue (Linear or GitHub Issues), marks the spec as needing clarification, and resumes once the answer is recorded in
  the spec.

### Acceptance criteria added by A-6

AC-56 to AC-60, listed under `## Acceptance criteria`.

## Amendment A-7 (2026-11-04): tests run in CI, and the gate's fan-out

**Source:** owner default O4 (notes `plans/day1-2026-11-04/PLAN.md`: Flow's tests run in a GitHub Actions job in
Flow's CI), built by PR #122; the gap scan (notes `handover/gap-scan-2026-11-04.md` section 3: AC-41's fan-out
across boxes conflicts with box 1's retirement); `gate run --shards` as PR #104 built it. FR-46 is a default that
stands until the owner decides otherwise.

### Requirements added by A-7

- **FR-45**: _Flow's tests run in its own CI._ The Quality Gate workflow's `test` job runs
  `pnpm --filter @figentra-oss/flow test` on every pull request and every push to the default branch. It is not a
  required check (making it one is the owner's ruleset change), so a red `test` blocks no merge, but work counts as
  done only once it is green. For Flow this replaces STA-2064's "GitHub runs no tests".
- **FR-46**: _The gate's fan-out_ (AC-41; a default, pending the owner). Box fan-out stays an option:
  `fflow gate run --shards <n>` deals the workspace's packages across testbed boxes, as FR-15 says, on a `command`
  runner (the testbed). With box 1 retired, a `github-actions` runner runs the check set as one job and never shards;
  `--shards` on any runner other than `command` is refused.

### Acceptance criteria added by A-7

AC-61 and AC-62, listed under `## Acceptance criteria`.

## Acceptance criteria

AC-1 to AC-12 restate FR-1 to FR-12 as checkable criteria; AC-13 to AC-34 are the amendments' (A-1 to A-3,
approved 2026-11-03); AC-35 to AC-42 restate FR-31 and the parts of FR-13, FR-15 and FR-21 that no criterion covered;
AC-43 restates the template part of FR-26 and FR-27 (P-031). None adds a decision. AC-44 to AC-62 are A-4's to
A-7's (2026-11-04).

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
- **AC-8**: WHEN `sync` renders `lefthook.yml` THE oxfmt and oxlint jobs SHALL run the mise-pinned binary named in
  `mise exec`, never `pnpm exec`, skip with a note where mise is missing (stackra), and pass staged files that are all
  on oxfmt's ignore list through `--no-error-on-unmatched-pattern` while every other non-zero exit fails (oxfmt also
  exits 2 on a file it cannot parse); `mise.toml` SHALL pin `npm:oxfmt` and `npm:oxlint` at the catalog's versions
  with no other line changed;
  commit-msg SHALL skip commitlint without `node_modules/.bin/commitlint`, pre-push SHALL skip only on the registry's
  401, and oxlint SHALL skip without `node_modules/@stackra/oxlint-config`, each with its note.
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
- **AC-39**: WHEN `fflow release --preflight` runs with pending changesets THE command SHALL report, reading only,
  whether the owner may merge the version PR (branch, main's and the version PR's required checks, the versions the
  changesets imply, the registry, the lockfile), each failed row with its fix and exit 1; `fflow release` SHALL never
  open, merge, dispatch or publish anything, the Release workflow publishing in CI when the owner merges the version
  PR (FR-13; this replaces D6 Q4's dispatch).
- **AC-40**: WHEN the review workflow confirms a blocking finding THE `land` command SHALL refuse the PR and name the
  finding (FR-15).
- **AC-41**: WHEN the gate workflow fans the check set out across testbed boxes THE gate SHALL post one `fflow/gate`
  status, green only when every shard passed (FR-15).
- **AC-42**: WHEN `fflow ledger --since <date>` runs THE output SHALL list what landed, released and shipped since that
  date, by day and track, read from Flow's records only (FR-21).
- **AC-43**: WHEN either preset's spec and plan templates are read THE asset test SHALL find every section A-3 names
  for each tier: Discovery and Sources, the plan's components with their trees and interfaces, and the small tier's
  one-page design with its tree and interfaces (FR-26, FR-27).
- **AC-44**: WHEN a PR carries the `fflow:land` label from a writer or a bot listed in `approve.requesters` and passes
  every land rule at its head THE `approve` job of main's `fflow-approve.yml` SHALL approve it as Figentra Flow at
  most once for that head, and THE `merge` job SHALL squash-merge it pinned to that head's SHA (FR-32).
- **AC-45**: WHEN the gate run of a `github-actions` runner completes THE `verdict` job SHALL post `fflow/gate` from
  the run's `check` job conclusion, a missing conclusion counting as a failure, and SHALL post `pending` for a PR that
  changes `.github/workflows/**` until the owner approves at its head (FR-32).
- **AC-46**: IF a token is minted outside main's `fflow-approve.yml` at `refs/heads/<default>`, on a
  `workflow_dispatch` event, or for a role `ROLES` does not hold THEN THE mint SHALL refuse before any network call;
  a granted token that covers more than its role's permissions on this one repository SHALL be revoked and the mint
  SHALL fail (FR-33).
- **AC-47**: WHEN `fflow land` finds no, a stale or a FAIL AI-REVIEW verdict THE command SHALL warn and land, the
  squash body recording `AI-Review: none` or the verdict with its SHA; a confirmed blocking finding from
  `fflow review --record` SHALL still refuse the PR (FR-34).
- **AC-48**: IF `FIGENTRA_AUTOMATION` is missing or is neither `on` nor `merge-only` THEN THE `approve`, `merge` and
  `verdict` jobs SHALL post nothing and exit 0; while it is `merge-only` the `approve` job SHALL post nothing (FR-35).
- **AC-49**: WHEN a builder runs `fflow land` in a repository whose base renders the event lane THE command SHALL
  request the land by the `fflow:land` label or a `/fflow land` comment and wait for the `fflow/land` status, and
  SHALL dispatch no workflow (FR-36).
- **AC-50**: WHEN release N+1 renders `fflow-approve.yml` THE file SHALL hold no `approve-dispatch` job and name no
  `FFLOW_APPROVER_*` secret (FR-36).
- **AC-51**: WHEN `flow.config.json` `preset` names an installed package THE `sync` command SHALL render the folder
  its `package.json` `flow.preset` names and record the package's version in the lock; it SHALL refuse, writing
  nothing, a folder whose real path leaves the package, a package that is not installed (naming
  `fflow preset add <pkg>`), and a Flow version outside the package's `peerDependencies` range or its `preset.yml`
  `requires.flow` (FR-37).
- **AC-52**: WHEN `fflow preset add <pkg>` runs THE command SHALL install the package with the package manager the
  repository's lockfile names and set `preset` in `flow.config.json` with every other key unchanged; under
  `--dry-run` it SHALL change nothing (FR-37).
- **AC-53**: WHEN a package preset's `guard/*.mjs` imports Flow's guard code THE import SHALL resolve through
  `@figentra-oss/flow`'s package exports, and no preset module SHALL import a path inside Flow's `src/` (FR-38).
- **AC-54**: WHEN the Stackra repositories have switched THE config of each SHALL name `@stackra/flow-preset`, and the
  `@figentra-oss/flow` package SHALL carry only the `neutral` preset (FR-39).
- **AC-55**: WHILE a skill listed in `third-party.yml` has no commit and tree-digest pin THE `sync` command SHALL
  treat it as machine-only; once it is pinned, `sync` SHALL install it into `.agents/skills/.vendor/` at that pin,
  and no preset SHALL carry an upstream skill's files (FR-40).
- **AC-56**: WHERE `flow.config.json` lists no harness THE `sync` command SHALL render each command with its
  `flow:ask` markers dropped and its text table, byte for byte as before A-6 (FR-41).
- **AC-57**: WHERE `harnesses` lists `claude-code` or `opencode` THE rendered ask step SHALL instruct that tool's
  question tool (1 to 4 questions, 2 to 4 options, the recommended first) with the text table as fallback; where it
  lists `copilot`, `cursor` or `codex`, `sync` SHALL write that tool's prompt files with provenance headers and lock
  digests (FR-42).
- **AC-58**: WHEN a client calls `fflow_clarification_record` THE server SHALL write one Q/A bullet under
  `## Clarifications` → `### Session <date>` of `.agents/specs/<folder>/spec.md` inside the repository and nowhere
  else, and the other question tools SHALL write nothing (FR-43).
- **AC-59**: WHEN an unattended run reaches an ask step THE question SHALL go to the task's tracker issue, the spec
  SHALL carry the needs-clarification marker, and the run SHALL resume from the answer once the spec records it
  (FR-44).
- **AC-60**: WHEN a repository adopts Flow's harness rendering THE same PR SHALL delete that repository's `.agents`
  sync script (FR-42).
- **AC-61**: WHEN a pull request opens or updates, or the default branch is pushed, THE Quality Gate workflow SHALL run
  Flow's package tests in its `test` job (FR-45).
- **AC-62**: IF `fflow gate run --shards <n>` runs with a runner that is not a `command` runner THEN THE gate SHALL
  exit 2 and name the runner, running and posting nothing (FR-46).

## Success criteria

The exit criteria of `path-to-100.md`, measurable:

- **SC-1**: verified by: trace ci, in the gate. Every FR and AC of this spec is covered by a task with passing
  evidence and by a test (`fflow trace ci` clean).
- **SC-2**: `passthroughCommands(fflow)` is empty and the round-4 owner try-out has no finding — verified by: unit
  test and the owner's scripted checklist.
- **SC-3**: verified by: fflow check --workspace. Every repository's `fflow check` is green on the 0.3.0 preset and
  `fflow status --divergence` reports nothing unreviewed.
- **SC-4**: verified by: gh api on each repository's rulesets (`gh api repos/<owner>/<repo>/rulesets`). On every
  repository the ruleset requires Quality Gate's `verify` and, once the owner has pinned it to the Figentra Flow App's
  integration id, `fflow/gate` (A-4, ADR 0523 decision 3), and no other context.
- **SC-5**: `fflow todo` and `fflow ledger` replace the hand-kept state file — verified by: manual (the owner).

## Non-functional requirements

- **NFR-1**: THE `@figentra-oss/flow` package SHALL have no runtime dependency beyond `@stackra/console` and
  `@stackra/validation`, pinned exactly through Flow's strict catalog and served by the public Figentra registry
  (ADR 0506 decision 8, which replaces "no runtime dependency"; the CLI layer imports them, the governance core and
  `fflow guard` never do), and `undici`, which `src/lib/net.mjs` loads for its connect timeout.
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
test-level baseline inventory (STA-1942 v2); from PLAN section 9, P5 (a proof on a repository outside Stackra, with the
`neutral` preset, GitHub Issues and GitHub Actions) and P6 (a Claude Code plugin marketplace for the neutral skills).

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
- 2026-11-03: owner decision "Yes, bot first", relayed by the leader session. FR-22 (baseline-aware approval) and FR-16
  (`land --stack`) are built before the rest of 0.3.0, as small PRs. FR-15's gate stage gains the testbed contract
  (owner-approved, STA-2042). No scope change
- 2026-11-03: tasks.md corrected after PR 19 and PR 20, content only and no new decision: AC-43 restates the
  templates' part of FR-26 and FR-27 (P-031), which T038 to T041 now cover instead of AC-28 and AC-29; T128 (FR-27's
  small-tier design) and T129 (FR-30's task trees) added; T052 to T059's tests sit in `src/__tests__/`; T100 waits for
  T091 (PR 14)
- 2026-11-04: spec and tasks.md brought in line with what merged (#81 to #127), with no stage change. A-4 (ADR 0523
  and the L2 lane: FR-32 to FR-36, AC-44 to AC-50), A-5 (Flow as a general product: FR-37 to FR-40, AC-51 to AC-55),
  A-6 (harness adapters: FR-41 to FR-44, AC-56 to AC-60) and A-7 (tests in CI and the gate's fan-out: FR-45 and
  FR-46, AC-61 and AC-62) record the owner's decisions and defaults of 2026-11-03 and 2026-11-04, relayed by the
  leader session; FR-46 is a default pending the owner. FR-13's required-check clause, FR-31's console line, SC-4,
  NFR-1 and the Impact's dependencies follow ADR 0523 and ADR 0506 decision 8. tasks.md ticks the 99 tasks whose work
  merged, each with its PR, and adds T130 to T151 (12 of them merged)
- 2026-11-04: after #128 to #134, no stage change: SC-1, SC-3 and SC-4 name their method first, in a form `trace`
  reads; AC-39 (and plan.md's P-036) say what `fflow release` does on main: it only reads, `--preflight` answers
  whether the owner may merge the version PR, and the Release workflow publishes on that merge. tasks.md ticks T015,
  T024, T047, T048, T116, T135, T140 and T148, and T120 to T122 name the per-command tests, `packed.e2e.mjs` and
  `origin/main`
