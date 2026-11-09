# @figentra-oss/flow

## 0.9.2

### Patch Changes

- 648fa50: A repository's first `fflow sync --direct` no longer fails with ENOENT when its own projector had linked
  `.claude/skills/<name>` to `.agents/skills/<name>`. The direct sync moves those renders to `.claude/` and removes the
  `.agents/` copies, which left the links dangling where it writes; it now replaces a dangling link on a rendered file's
  path. A link that still resolves is left alone.
- 6f5d7ce: A product's first update no longer changes what it did not ask for:
  
  - `.claude/settings.json` (permissions and the guard's per-call hooks) and `lefthook.yml` are opt-in, under the
    config's new `surfaces.settings` and `surfaces.lefthook`. Unset, a repository keeps only what its lock already
    records, so core and the template keep theirs and a product gets neither.
  - `sync` and `update` refuse to replace an `AGENTS.md` or `README.md` the repository wrote, one its lock does not list.
    Move what it says into `agentsMd.facts`, delete it, and sync again.
  - Renders a product's format and spell checks reached are fenced, their words untouched. AGENTS.md, CLAUDE.md,
    JSONC and the vendored `.agents/reference/**` open with `cspell:disable` and carry Prettier ignore markers (oxfmt
    honours them). The preset's skills and `.agents/routing.yaml` and `models.yaml` only drop the spell checker, since
    a skill naming a formatter fails the skill-tech check.
  - The releaser, secret-manager and vault-keeper agents lose OpenCode permission blocks that only `allow`ed. They never
    render for OpenCode, and validate refuses an agent `allow`.
  - The compiler-engineer, frontend-builder and service-builder agents no longer name `packages/developer`,
    `apps/console` or `services/example`.

## 0.9.1

### Patch Changes

- 20cc73b: The stackra preset's agents no longer name files that only core has, so a product's validate stops failing on them
  (geo, invoicing). A docs page is now a link to docs.stackra.figentra.com instead of an `apps/docs/src/docs/…` path. A
  rule is named (the `linear` rule) instead of its `.agents/rules/…` path, which a direct sync renders under
  `.claude/rules` anyway. Core's `linear-reconcile.repos.yaml`, the ADR number queue and the ADR template are named as
  core's. A test keeps such paths out.

## 0.9.0

### Minor Changes

- bfcae1a: Each gate step prints a mark before it runs (`::gate-step::<seconds> <step>`), so the `fflow/gate` status of a red
  run names the step it stopped at (`failed at pnpm lint (exit 1)`) and the log shows when each step began. A log with no
  marks keeps the old description.
- 190be45: `fflow sync --direct` now projects `.agents/` into each assistant's folders itself, the work a repository's own
  `agents:sync` script did (STA-2098 H6). Each agent is generated as a Claude Code agent and an OpenCode agent in its own
  dialect, the model from the agent's tier and `.agents/models.yaml`, with OpenCode denies derived from its tools. Skills,
  hooks and templates are linked, `.agents/hooks/_reviewer-agents.mjs` lists the reviewer agents, and `.mcp.json` is
  rendered from `.mcp.yaml`. A real file is never overwritten. `fflow check` and `gate ci` report the projection's drift
  for a repository that syncs direct. The preset's agents are now rendered to `.agents/agents/` in both modes, and the
  projection writes `.claude/agents/`; an override that targets `.claude/agents/<id>.md` targets `.agents/agents/<id>.md`.

### Patch Changes

- 7061128: The stackra preset's workspace-layout rule and guard hint name the docs site as Fumadocs on a Worker (ADR 0514), not
  Mintlify.

## 0.8.0

### Minor Changes

- 9af4385: A preset can name the checks every gate runs first (`gate.required` in `preset.yml`); a repository's `gate.check` runs
  after them and can add a step, never remove one. The stackra preset requires format, lint, typecheck, unit tests, int
  tests, strict gen, validate, the secret scan and the dependency scan (`pnpm format:check`, `lint`, `typecheck`, `test`,
  `test:int`, `STACKRA_GEN_STRICT=1 pnpm gen:check`, `validate`, `secrets:scan`, `deps:scan`). A repository on the stackra
  preset that lacks one of those scripts fails its gate until it adds it.

## 0.7.1

### Patch Changes

- 28f61b5: `sync` pins mise: a `jdx/mise-action` step in `baseline.setup` that names no `version` gets `2026.11.4`, and the
  event lanes' decrypt step installs that version too. An unpinned mise-action downloads the newest mise, and a 504 from
  that release turned every repository's CI red. A step that sets its own `version` keeps it.

## 0.7.0

### Minor Changes

- 9499a2a: `AGENTS.md` indexes the rules instead of carrying them: a "Rules index" lists each rendered rule file, and the
  repository's own beside it, with its description and when it applies (always, or the globs it covers). Nothing reads a
  rule's text into `AGENTS.md`, so the stackra preset renders under 20 KB. The missing gate key refusal ends "; nothing
  minted" like every other app-token refusal.
- 652862a: Secrets leave Infisical (Stackra ADR 0525). Figentra Flow fetches no secret: every command reads its values from
  its own environment, which the caller fills (on a workstation, a secrets runner such as core's `secrets-exec.mjs`;
  in CI, a decrypt step). `secrets.kind` takes `env` or `sops`; `infisical` still loads, with a warning, and is read
  as `env`, so it no longer wraps a command in `infisical run`, and `app create` writes the key only to `--key-file`.
  The approval workflow's land lane and verdict job now need `secrets: { "kind": "sops", "oidc": { "decrypt":
  "<action>@<sha>", "scope": "<scope>" } }`: each keyed job puts mise on PATH and runs the decrypt for
  `FFLOW_GATE_APP_ID` and `FFLOW_GATE_PRIVATE_KEY`, and the mint reads them from the job's environment. The old
  Infisical `secrets.oidc` form and the `FFLOW_OIDC_IDENTITY_ID` variable are gone; run `fflow sync` to re-render
  `fflow-approve.yml`. `**/.infisical.*` is no longer an owner-only path (CODEOWNERS). The stackra preset's agents,
  rules and skills describe sops, the decrypt action and `secrets:put`/`generate`/`rotate`.
- 2b7c922: `fflow mcp --studio` adds the Studio's write surface: `spec_create` writes a Draft spec from the template for an issue
  key, naming the person it was created for; `run_start` hands a tasked, approved spec to the build sandbox in the EU or
  US region; `run_status` reads a run back. Every call names the person it acts for (`onBehalfOf`, a user or principal
  id, never a service), and Flow holds no service key. The build sandbox is a port with an in-memory fake driver for now.
  Without `--studio` the server is unchanged.
- 8f58566: `fflow mcp --studio` gains `repo_create`: a new product's private repository `owner/name` from a template repository,
  through a repository-host port (the Figentra GitHub App) on behalf of a person, refused for a taken name, a
  repository that is not a template and a malformed name or owner. The port's only driver is an in-memory fake until
  the GitHub App and its keys exist.
- 9eafcb8: `fflow mcp --studio` gains `repo_link`: it links a repository (`owner/name`) to its tracker project, on behalf of a
  person, through a project-link port (the Linear project's links). Linking the same repository again answers the existing
  link; an unknown project or repository, a malformed name and a service caller are refused. The port's only driver is
  an in-memory fake until the Linear driver is wired with its credentials.
- 02aa626: The Studio's MCP surface (`fflow mcp --studio`) gains `run_list`, a spec's build runs newest first with an optional
  status and a cursor (at most 100 per page, 20 by default), and `run_cancel`, which stops a queued or running run and
  records who cancelled it. Both act on behalf of a person (`onBehalfOf`), never a service; the build-sandbox port
  gains `list` and `cancel`, and a run's states gain `cancelled`.

### Patch Changes

- 515fe73: The CLI engine moves to `@stackra/console` and `@stackra/validation` 0.21.0, the current core release, from 0.7.1.
- 6a540e8: A missing gate key now says that gate posts run on the Testbed box or in CI, which decrypt `ci/flow/gate`, and that a
  workstation never holds the gate key, instead of reporting a bare missing variable.
- 29c1be5: The package's folder is `packages/flow`, not `packages/figentra-flow` (R4, STA-2106): `repository.directory` and the
  docs links follow. The package name, the binaries and every command are unchanged.

## 0.6.5

### Patch Changes

- 627a7a0: `fflow gate ci` no longer fails a changesets version PR (`changeset-release/main`) or a Renovate branch on the tier
  floor: they bump versions and lockfiles and hold no spec. One `isBotBranch` check now serves the branch-shape rule and
  the tier floor (STA-2222).

## 0.6.4

### Patch Changes

- 2c79adb: The stackra preset says `fflow`: its spec skill names `fflow gate ci` and `fflow trace ci`, and its plan template no
  longer says "Vellum" (STA-2106).

## 0.6.3

### Patch Changes

- aee4206: The stackra preset's test-infra skill and flow-gate command now name the `testbed` CLI from `@figentra/testbed`
  (ADR 0522) for run, status, unlock and scale, in place of `stackra testbed`.

## 0.6.2

### Patch Changes

- b95f7b6: The stackra preset's ci-steward and flow-gate name `testbed run` (the `testbed` CLI from `@figentra/testbed`, ADR
  0522), as `@stackra/flow-preset` does; the README's runner example says the same. A gate shard stopped by Ctrl-C or
  SIGTERM (exit 130) is an infrastructure failure like 73 and 75: it decided nothing about the code, so nothing is posted
  and the gate is run again.

## 0.6.1

### Patch Changes

- 19b653d: The `Stop` hook (`session-save`) is now rendered only when `session.pushAtEnd` is `true`, like the `SessionEnd`
  hook. Alone it wrote `.flow/record/<key>.json` every turn with nothing to commit it, so every task worktree was left
  dirty and `git worktree remove` refused it.

## 0.6.0

### Minor Changes

- 63cc648: Close the gaps a repository could not close through its own configuration (STA-2131). `claudeCode` in
  `flow.config.json` carries Claude Code `enabledPlugins` and `extraKnownMarketplaces` into `.claude/settings.json`,
  and nothing else: the hooks, permissions and environment stay Flow's. A marketplace must be a remote source (`github`,
  `git` or `url`), because an enabled plugin brings its own hooks. `session.contextCommands` appends the output of
  the repository's own commands to the SessionStart context (no shell, 4 seconds each, capped, failures silent).
  `agentsMd.land` replaces the landing line of AGENTS.md's "How work flows". The Stop and SessionEnd hooks exit 0
  silently on a checkout with no install. The stackra preset's OpenCode guard plugin fails closed: a missing bundle, a
  timeout, a kill, a non-zero exit or no answer denies, naming why, and the guard bundle answers an unattended caller
  (`FFLOW_GUARD_UNATTENDED=1`) with an explicit allow. A grep or glob from OpenCode now carries its searched folder and a
  grep its `include` filter, so the secret-path rules apply to it as on Claude Code.
- 17677be: `fflow ship` records what a Runway deploy did (STA-2137). In a repository with a `runway.yaml` it dispatches with
  `return_run_details`, so GitHub answers with the run it started, and writes that run id into the record's new `ships`
  list at once. When GitHub names no run, it notes the deploy workflow's runs before it dispatches and finds a new run
  created after the dispatch whose deploy job names the environment (a running run with no jobs yet is taken only
  provisionally; a completed run naming another environment or none never is), so a ship never adopts another ship's or
  the owner's promote run. It follows the run for up to `--wait` minutes (default 10), downloads its
  `runway-outcome-<env>` artifact through the configured GitHub credentials and reads it in memory:
  `runway-outcome.json` (`runway.outcome/v1`) decides the outcome (`deployed` for the environment and the run's own
  revision is a success; `failed`, `cancelled` or a mismatch is a failure, with the reason), and `deploy-<env>.json` adds
  the KV rows and uploads written, held apps and any smoke or rollback field. The `ship` stage is done only on success,
  active while the run is pending (exit 4) and failed otherwise; a run whose artifact list has no outcome artifact is
  `no outcome artifact`, while a GitHub error listing or downloading it keeps the ship pending. `fflow ship <env>
  --resolve` dispatches nothing: it re-reads the task record's pending ship and writes its outcome back, committed and
  pushed. `fflow status` shows each record's newest ship in its Ships table, re-read but not written (Runway repositories
  only; `status --json` of other repositories is unchanged). `fflow ledger` shows each ship row's own outcome.
  Repositories without `runway.yaml` ship as before.

## 0.5.0

### Minor Changes

- 909d907: The guard runs with no install. `fflow sync` writes `.agents/hooks/fflow-guard.mjs`: one self-contained file with the
  guard engine and the preset's guard tables inside, importing only `node:` modules, locked in `.flow/lock.json` so
  `fflow check` names a hand edit. The rendered Claude Code hooks and the OpenCode guard plugin run it instead of
  `node_modules/@figentra-oss/flow/bin/fflow-guard.mjs`, which a checkout with no `node_modules` lacks, so no guard ran
  there. The file is laid out as oxfmt prints it and is oxlint-clean, so a repository's `oxfmt --check .` and
  `oxlint` pass on it; the preset's lefthook still skips it, as its bytes are locked. The plan gate imports
  `lib/spec-check.mjs` instead of the whole `gate` command, which keeps the file small. STA-1945 NFR-2 is amended by
  A-8.
- 86de1a8: The SessionEnd hook that commits the session's work as WIP and pushes it (`fflow session stop`, hook id
  `session-stop`) is no longer rendered by default. A repository opts in with `"session": { "pushAtEnd": true }` in
  `flow.config.json`; without it no rendered hook commits or pushes, and the Stop hook (`--save-only`) still writes the
  session's record locally. Run `fflow sync` after upgrading; add the key first to keep the push at session end.

### Patch Changes

- de6e90c: `fflow check` tolerates two things a consumer carries today (STA-2131). A skill the preset's `third-party.yml` lists
  may be committed at `.agents/skills/<id>` when its licence lets a repository carry it: an allowed licence, the
  owner's `ownerEntry`, or the owner's own skills. HeroUI Pro's and Remotion's are still problems, as is a listed skill
  elsewhere or a folder whose front-matter `name` is another skill. The rules block stackra/core's `agents-sync`
  appends to the end of `AGENTS.md` is read away when it is the file's one trailing block; any other `AGENTS.md`
  change, text between two blocks among them, is still drift. The stackra preset's `third-party.yml` header says so.
- d6094db: With `secrets.oidc`, `fflow gate run` no longer posts `fflow/gate` or the gate comment from a box or a workstation:
  it runs the check, records the verdict and says the status comes only from `fflow-approve.yml`'s `verdict` job.
  It refuses (exit 2, nothing recorded) when that job is not rendered for the configuration (a runner other than
  `github-actions`) or with `--box`. Repositories without `secrets.oidc` keep the box poster. A test pins that no path
  writes the gate with a user's token.
- 8081ef6: The stackra preset's guard is level with core's again (core 2ea3f21e). The runway deploy rule also reads
  `runway.ts` / `runway.js` run by `node` or `tsx`, the runway secrets sync and a script that calls `runRunway`;
  `stackra promote` is a deploy like `stackra deploy`; and a new `gate-change` rule denies, for every role, approving
  a waiting deployment (REST `pending_deployments`, GraphQL `approveDeployments`, a protection rule's callback) and
  writing an environment, ruleset or branch protection through `gh api`. Reading them stays allowed. The guard bundle
  `fflow sync` writes picks the change up.
  
  The OpenCode guard plugin now runs the guard as an unattended executor (`STACKRA_EXECUTOR=1`), as core's OpenCode
  guard does: the stackra tables apply the `executor` rules (`npx`, `pnpm dlx`, `eas`, `wrangler secret|--remote`,
  `encore env set|create`, `secrets:import --confirm`) and core's executor layer (`curl`, `wget`, `gh`, network git,
  `git branch -D`, `git worktree remove|prune`, `docker compose down -v`, `encore deploy|env|secret`, every `pnpm bot:*`
  and `pnpm linear` but the exact `pnpm bot:git -- fetch origin` and `pnpm bot:git -- push [--force-with-lease] origin
  HEAD`, and `figentra bot|pr merge|linear|secrets`), and refuse an edit outside the session's worktree or in the main
  checkout (unless `STACKRA_ALLOW_MAIN=1`). Claude Code's hook is unchanged.

## 0.4.0

### Minor Changes

- b23d580: The approval check can judge a red main against its recorded baseline (STA-1945 FR-22), and it fails safe: it excuses
  nothing unless the config's new `approve.tolerate` lists the check. That list is empty by default. A required check
  that fails on the PR's head is a pre-existing failure, not a new one, only when all of these hold: the list names its
  context; from its trusted source, it concluded `failure` on the commit that left main's nearest baseline too; and the
  ruleset requires the `Baseline` check and it is green on the head (it compares each task, a newly reached failure
  excepted). An unlisted check, or one that passed, never ran, or was only cancelled or timed out on the baseline, still
  refuses. With no baseline or an empty list every required check must be green, as before. Every other refusal is
  unchanged. The approval names the baseline's SHA and the checks it tolerated.
  
  The tolerance is per check, so list only checks that run no more than `baseline.tasks`. `Baseline` and `fflow/gate`
  (which runs the whole check command) are never tolerated: the schema refuses a list naming either, `sync` refuses to
  render it, and the check refuses it. `sync` renders the list into `fflow-approve.yml` as `TOLERATE`, beside
  `OWNER_ONLY_EXTRA`, in the dispatched job and in the event lane's jobs alike, so a `fflow:land` request is judged
  the same way. A `TOLERATE` that is not a JSON list of names refuses the approval, and an unset one is the empty
  list. Run `fflow sync` after upgrading.
- 9821447: Add offline, bounded task context discovery through `fflow context` and the read-only `fflow_context` MCP tool,
  using checkout paths and the existing workspace registry. Include revisions, dirty state, scoped instructions,
  package metadata and explicit discovery gaps. Clarify native Codex skill support and project concise documentation
  boundary guidance through both built-in presets.
- 30212bb: Port `spec`, `linear`, `clean`, `ship`, `release` and `app create` from passthrough to declared commands on
  `@stackra/console`, so each `--help` lists its arguments and options. Every flag is still accepted and handed to the
  same `run`. **Breaking** for scripts parsing `spec … --json` and `release [--preflight] --json`: they now write the
  engine's one `{ "ok", "data" }` document, and the command's old document is under `.data` (`data.FEATURE_DIR`,
  `data.IMPL_PLAN`, …), as `doctor --json` and `status --json` already do. `spec template <name> --json` writes the
  template's text as `data`, one string. The shipped `flow-*` commands read the fields under `data`.

### Patch Changes

- a6f3e96: `fflow gate check` on a Draft spec now runs the spec checks its approval will run and prints their findings as
  `at approval:` warnings (the exit stays 0), so an author sees them before approval. `gate run --help` is pinned to
  print the help and dispatch nothing.
- a2e6b8a: Port `gate`, `parse`, `guard` and `hooks run` from passthrough to declared commands, so their `--help` lists their
  arguments and options. Each still runs the same command with the same flags.
- 25b7d53: `readme`, `team check`, `land` and the `train` steps (`open`, `add`, `close`, `build`, `eject`, `depart`, `status`)
  are declared commands on the console engine instead of passthrough (STA-1945 SC-2), so their `--help` lists every
  option and positional. Each still runs its own `run`, with the same flags: `readme --check`; `team check --tracker`;
  `land [<pr>] --stack --dry-run --manual-ok --wait <minutes> --no-wait`; `train open [<version>]`, `train add <pr>`,
  `train eject <pr>` and `--dry-run` on every step. `readme` and `team check` still refuse outside a git repository.
  The engine now refuses an unknown flag or a surplus argument (exit 2) where the old parsers ignored it, and bare
  `fflow train` or `fflow team` is an unknown command (exit 2) (bare `train` printed its usage and exited 0).
- 6ed589a: `init`, `sync`, `migrate`, `trace`, `adr`, `start` and `mcp` are ported from passthrough to the console engine
  (STA-1945 SC-2): each declares its arguments and options, so `fflow <command> --help` lists them, and hands them to
  the command's own `run` as before. Two differences: a flag a command does not declare is now refused (exit 2) instead
  of ignored, and `fflow trace trace <dir> --json` writes the engine's `{ "ok", "data" }` document with the matrix as
  `data`. `trace` also takes `--base <ref>` besides `--base=<ref>`, and `start` and `init` take `--opt=value`.
- b4a4e5b: The stackra preset's reviewer agents post an advisory `Review (advisory): PASS|FAIL <sha>` comment through
  `pnpm bot:gh` instead of `pnpm bot:review`, since the stackra-reviewer App is retired (ADR 0523 decision 6);
  nothing counts the comment. `flow-review` and `docs-spec-flow` say the same. Flow's own config drops `apps.review`.
- 84f046b: The stackra preset's agents, skills and task-vocabulary rule now run one member's tests with
  `pnpm turbo run test --filter=<name>` (and `typecheck`/`build` the same way), since turbo runs `stackra gen` first and
  a bare `pnpm --filter <name> test` skips it, leaving vitest without `.stackra/vitest.config`. The rule also says a pull
  request's `Needs testing:` line names that command. The OpenCode surface allows `pnpm turbo run *`, which its
  `pnpm *` deny otherwise blocked. Run `fflow sync` after upgrading.
- 61bf06c: `fflow start` creates the key's spec folder in the new worktree when `origin/<default>` has none for it: `spec.md`
  from the preset's spec template with the issue key and feature branch filled in, committed with the start record so
  the worktree stays clean, and `fflow spec paths` finds it. A bug-lane key (a folder under the bugs dir) and
  `--no-spec` (trivial work) get none. `--dry-run` names it. `/flow-specify` edits a `spec.md` start wrote rather than
  overwriting it.

## 0.3.0

### Minor Changes

- 4f15873: `fflow adr reserve <slug> --issue <key> [--owner <who>]` reserves the next ADR number through Flow's queue (STA-1945
  FR-17). It takes the `adr` queue lock (the branch `flow/queue/adr`, made through the GitHub API; a lock 15 minutes old
  or more is taken over with a notice, and a takeover or create GitHub keeps refusing is an error instead of a wait),
  appends the entry to the numbers file the preset's new `queues.adr` names (`apps/docs/adr/numbers.yaml` in the stackra
  preset; the neutral preset has no ADR register and declares no queue), opens a PR, gates and lands it with `fflow
  land`, and prints the number only once it is on the default branch: stdout carries only the number, so
  `n=$(fflow adr reserve …)` works, and the gate and land output goes to stderr. Two sessions reserving at once get
  different numbers. A reservation that does not land, including one whose auto-merge is still waiting after 10
  minutes, prints no number, names its PR and withdraws it (auto-merge off, PR closed, branch deleted) so it cannot land
  later; the lock is always released. `landOne` (the function behind `fflow land`) takes a `refs` issue for a branch that
  names none, so the squash names the reservation's issue. It replaces core's `pnpm adr:reserve`, whose losing PR
  conflicted.
- 905271d: A new `src/lib/app-token.mjs` mints a narrowed Figentra Flow App installation token inside one node process, from main's
  approval job only (STA-1945, the L2 design). It refuses before any network call unless the job is GitHub Actions on a
  GitHub-hosted runner, on the default branch, running the default branch's `fflow-approve.yml`, for a
  `pull_request_target`, `status`, `workflow_run`, `issue_comment` or `schedule` event. It then trades the job's OIDC
  token for the App's id and key at the gate path in Infisical, checks that the installation is the App's own on the
  repository's owner, and mints a token for this one repository with a fixed role's permissions (`approve`, `merge`,
  `merge-workflows` or `verdict`). A grant that is wider, narrower or for another repository is revoked and refused.
  Every value is masked in the job's log and kept in memory only. The configuration gains `secrets.oidc`
  (`identityId`, a uuid, and `audience`), and the schema checks string patterns. Nothing uses the mint yet.
- 5eea940: Asynchronous questions through the tracker (STA-2098, PLAN section 10 H5). `fflow spec ask <key> --async` posts the
  spec's open questions (its `[NEEDS CLARIFICATION: …]` markers) as one numbered comment on the issue through the tracker
  adapter, Linear or GitHub Issues, and adds `> Waiting on clarification: <comment link>` to the spec without touching
  its status. `fflow spec resume <key>` reads the comments after it, records each `Q<n>: <answer>` into the spec (the
  marker becomes the answer and `## Clarifications` gets the `- Q: … → A: …` bullet), removes the waiting line once
  every asked question is answered, and prints what it recorded and what remains. Without `--async`, `ask` lists the
  questions. The tracker adapters' `comment` now resolves to the comment's link, and both gain `comments(key)`, oldest
  first; the Linear adapter takes an injected `fetch` for tests.
- 97c3376: The baseline gate reports gains and newly reached failures (STA-1945, the backlog rule from os#114). A task that failed
  or never ran on main and passes on the PR is a gain. A task that never ran on main because an upstream task of its own
  package failed, and now runs and fails, is newly reached: it is listed with the task that unblocked it and is not a new
  failure or debt. A regression (a task that passed on main and fails now), or a failure in an unrelated package, still
  blocks, even beside a newly reached failure. `save` now records each task's upstream tasks in `baseline.json`
  (`needs`), `check --json` prints the result (`{ ok: false, reason }` when it fails closed: `not_saved`, `no_baseline`,
  `download_failed`), and the result's `fixed` is now `gains`.
- 420de60: `fflow` runs on `@stackra/console` 0.7.1, the one CLI engine of every Figentra CLI (STA-1945 FR-31, STA-1966).
  `@stackra/console` and `@stackra/validation` are now runtime dependencies (ADR 0506 decision 8, owner 2026-11-03),
  replacing NFR-1's "no runtime dependency, an optional peer"; they come from the Stackra registry, read without a token
  (`@stackra:registry` mapped in `.npmrc`). Only the CLI layer loads them: the governance core (gate, approve, land,
  record, lock, baseline) imports nothing from `@stackra/*`, and `fflow guard`, the agent hook, dispatches before the
  engine loads. `fflow` alone prints the banner, the version and the commands by group; `fflow <command> --help` prints
  its usage and runs nothing; a mistyped command names the closest one and exits 2; a failure is one error block with
  the fix and a docs link, and a configuration refusal still exits 2. `doctor` is a grouped checklist (Machine, Repo,
  Flow, GitHub) with a summary line, and a repository with no `origin` and no `credentials` block is information, not a
  warning. `status` prints tables for specs, worktrees, PRs and sessions, listing every spec problem under `--verbose`.
  **Breaking** for scripts reading `--json`: `doctor --json`, `status --json` and `status --metrics --json` now write
  one document, `{ "ok", "data" }`. `doctor --json` drops its `schema: "fflow.doctor/1"` and `checks` fields: the check
  rows are `data` (each keeps `id`, `ok`, `detail` and `fix`, replaces `warn` and `info` with `status`, and gains `name` and `group`); `status --json` puts the
  `fflow.status/1` snapshot in `data`, and `status --metrics --json` the metrics.
  `init` writes a starter `flow.config.json` when there is none. `spec paths` and `gate dir` fall back to the spec folder
  whose slug is exactly a keyless branch's last segment, and their hints name `gate dir --key <key>` instead of sending
  you in a loop. The other commands keep their flags and output, routed through the engine as passthrough until they
  are ported: `app`, `clean`, `gate`, `guard`, `init`, `land`, `linear`, `mcp`, `migrate`, `parse`, `readme`, `release`,
  `ship`, `spec`, `start`, `sync`, `team`, `trace` and `train`. `pnpm-lock.yaml` is regenerated on the box with this
  dependency change.
- 18f731b: Approvals are bound to the documents' content (STA-1945 A-3, FR-30, T048). Each "Approved by <who> <YYYY-MM-DD>"
  the spec carries is recorded in Flow's record with the digest of what it approves (the spec at Clarified, the spec and
  plan at Planned; the `**Status**` line and Status history left out, since every stage moves them) when a stage ends:
  `fflow spec setup-plan`, `fflow plan --record` and `fflow task start`. When an approved document changes after that,
  `fflow check` fails naming the stage to approve again (AC-34), `fflow next` sends the task back to the approval stage,
  and `fflow task start` refuses. A new approval line approves the documents as they are and is recorded by the next
  stage to end. `approvalsAt` lists every approval of a stage, re-approvals included.
- 3b69d0c: `fflow trace drift <dir>` reports contract drift (STA-1945 FR-30, AC-33): each function a plan's component declares in
  its interface blocks (a small spec's `## Design` when there is no plan) must exist in a file of that component's folder
  trees with the same name, parameters and return. A missing function, one with another signature, and an interface
  block with code but no readable function declaration are each reported, and the command exits 1. `fflow trace ci`
  runs the same check on a Done spec, except one last clarified before 2026-11-03 (`DOCUMENT_GATES_SINCE`), which was
  not written for it. JavaScript, TypeScript, Python `def` and Go `func` declarations are read; classes, types and
  constants are not checked yet. `contractDrift(plan, read)` lives in `src/lib/contract-drift.mjs`.
- edb27bf: The spec gate holds a small spec's design and every task to the folder trees (STA-1945, FR-27's small tier and FR-30's
  first clause). From Planned, a small spec's one-page `## Design` needs a folder tree (a `text` or `tree` block) and its
  interface declarations (a block in a programming language), as a feature or big plan's components do. From Tasked, and
  in `gate tasks`, each task may name only files that the plan's folder trees hold (the trees under its Components and
  Files and folders headings; a small spec's trees are in its `## Design`). A tree line nests under the folder lines above
  it; a folder line with lines beneath it holds only those, and a leaf folder line holds everything under it. An entry may
  use `*`, `**` or `{a,b}`. The spec's own folder, tests, changesets and lockfiles are exempt, as are backticked names
  that are not paths. A task naming any other file fails a big spec and warns on the others. `checkSmallDesign`,
  `checkTaskTrees` and `TREE_GATES_SINCE` are exported from `./gate`.
  
  Upgrading: a spec whose last `→ Clarified` Status history line is dated before 2026-11-04 (`TREE_GATES_SINCE`) was
  tasked without the tree rule and keeps passing without it. This covers the five Done specs and STA-1945, whose tasks
  also name files in other repositories. The small-design rule follows `DOCUMENT_GATES_SINCE` (2026-11-03), as the plan's
  component rule does.
- 4e7ba8f: The spec gate checks documents, not only their shape (STA-1945, FR-26 to FR-29 and FR-30's scope drift). A tiered spec
  past Draft needs a `### Sources` section that cites every live FR, alone or in a range ("FR-1 to FR-12"). At an
  approval stop (Clarified for a big spec, Planned for a feature or big one) spec.md and plan.md may hold no template
  placeholder, no empty `(mandatory)` section and no open question (a struck item, or "None" with a note, is decided). A
  feature or big plan gives each component under `## Components` a folder tree (a `text` block) and its interface
  declarations (a block in a programming language; a diagram, data, shell or Markdown block does not count). FR, NFR and
  AC lines that use a term of the preset's new `quality-words.yml` fail a big spec and warn on the others. `gate ci`
  reports each changed file that no task of the branch's own spec names as scope drift (tests, changesets and lockfiles
  aside): a failure on a big spec, a warning otherwise. `checkStage` takes `words` and a `warn` callback; the new checks
  are exported from `./gate`.
  
  Upgrading: a spec whose last `→ Clarified` Status history line is dated before 2026-11-03 (`DOCUMENT_GATES_SINCE`)
  keeps the rules it was approved under, so existing approved and Done specs do not start failing; the Sources,
  placeholder, component and vague-word checks apply to specs clarified from then on, and to an older spec once it is
  amended and clarified again. Contract drift in `trace` and content-bound approvals (the rest of FR-30) come later.
- 6563239: Figentra Flow 0.3: spec-driven development for agent teams, for any repository. 1.0 follows once the 12 repositories
  run the preset package and the GitHub Actions gate (leader, 2026-11-04). The breaking changes since 0.2.3, each
  described in its own changeset:
  
  - `fflow land` asks main's land lane (label `fflow:land`) and waits when the base's approval workflow has the event
    lane; the dispatch and auto-merge path remains for one release.
  - AI review is advisory: `land` records `AI-Review:` in the squash and no longer refuses without a PASS.
  - `fflow sync` owns the presets' surfaces (`.claude/settings.json`, `opencode.jsonc`, `.mcp.yaml`, `AGENTS.md`,
    `CLAUDE.md`, `lefthook.yml`) and deletes the owned files it no longer renders when nobody edited them.
  - `fflow check` refuses a hand-ticked task and an approval whose documents changed.
  - `doctor --json` and `status --json` write `{ ok, data }` (the console engine).
  - The stackra preset ships no vendored third-party skills; it lists them by source.
  - A preset may be an npm package (`fflow preset add`), and `@stackra/flow-preset` replaces the bundled `stackra`
    preset in a later release.
  
  The stackra preset's `npx` MCP servers are pinned to exact versions instead of `@latest`.
- 1137fe8: `apps.gate.aliases` lists the gate App's other logins, so renaming the App (figentra-gate to figentra-flow, ADR 0523)
  breaks nothing: `land`, `train`, `status` and the approval check count the `fflow/gate` status from the login or any
  alias, and from no one else. `sync` writes the approval workflow's `TRUSTED` value as a list of logins when there are
  aliases, and as the one login otherwise, so an existing workflow does not change. The approval check reads both
  forms and refuses when `TRUSTED` is not JSON or names a source in any other shape. A repository adopts an alias only
  after it runs this release, since earlier releases refuse `aliases` and trust no list; once the App is renamed, the new
  login becomes `login` and the old one is dropped.
- 0428481: The `github-actions` runner's verdict now comes from main (STA-1945, the L2 design's PR F). The gate workflow
  `fflow init --runner github-actions` writes runs on `pull_request` (opened, synchronize, reopened,
  ready_for_review). It has one `check` job with `contents: read`, a credential-free checkout of the head and no
  secret. The `post` job, the artifact upload and the `FFLOW_GATE_*` repository secrets are gone.
  
  With that runner and `secrets.oidc`, `fflow sync` adds a `verdict` job to `fflow-approve.yml`. It runs on the gate
  workflow's `workflow_run`, in the `fflow-approve` environment, one at a time for each head. It holds `id-token:
  write` and no App secret. It runs the new `src/lib/verdict.mjs` from the integrity-checked tarball. That script
  checks the run's repository, path, event, head repository and open PR. It reads the `check` job's conclusion (a
  missing job is a failure), and it posts `fflow/gate` with a `verdict` (`statuses: write`) Figentra Flow App token
  minted over OIDC. A PR that changes `.github/workflows/**` gets `pending` until the owner approves that head. Every
  job in that file then runs only on the default branch, and only while `FIGENTRA_AUTOMATION` is `on` or
  `merge-only` (unset is frozen). Without the runner or `secrets.oidc`, the file is unchanged byte for byte.
  
  `fflow gate run` on this runner dispatches nothing. It follows the PR's run and maps the gate App's `fflow/gate`
  status to 0 or 1, or to 4 when the status is pending or never appears.
- 842adf5: The governance core (STA-1945 PR 1). `.flow/lock.json` is now v2: it records the preset's name, version and digest,
  the Flow version, the profile, the digest of `.flow/overrides/` and every owned file with its digest; a v1 lock still
  reads, and the next `sync` writes it as v2; a lock with a newer `lockVersion` is refused rather than overwritten, and a
  malformed one is named by `check`. Every owned file that can carry a comment starts with a provenance header
  naming fflow and the preset ("do not edit; change `.flow/overrides/`"); strict JSON is identified by its digest alone.
  `sync` renders only the locked preset and refuses, naming `fflow update`, when the installed one differs, and names a
  preset folder that is missing. New commands:
  `fflow update [--preset <version>]` prints the diff, adopts the installed preset and syncs; `fflow check` is the CI
  check and writes nothing; `fflow diff` prints what `sync` or `update` would change; `fflow validate` checks the config
  against its schema. Each of the five takes `--workspace <dir>` and prints one line per repository.
  `update`, `check`, `diff` and `validate` run on the console engine with their options declared, so
  `fflow <command> --help` lists them; without `--workspace`, each refuses outside a git repository as `sync` and
  `spec` do. Under `--workspace`, a folder with no repository that has `flow.config.json` exits 1.
- 2394a85: The guard engine (STA-1945 PR 4): `bin/fflow-guard.mjs <event>` runs one neutral engine for every guard hook
  (PreToolUse for Bash and the file tools, PostToolUse, UserPromptSubmit, SessionStart) against the repository's preset
  tables in `guard/`, and `fflow guard --print-settings` prints the `.claude/settings.json` hooks that wire it. The
  lifecycle's side doors and the neutral path rules (generic secret files, and `flow.config.json`, which only the owner
  writes) are the engine's own: they hold for every preset, whatever its tables say. The stackra preset carries core's
  guard unchanged: its Bash rules (the secrets inbox and secret values, destructive git outside the session's own
  worktree, pushes, deploys, `changeset version`, `figentra bot|linear|secrets` and the rest of ADR 0293's tiers), its
  path rules, its plan gate, its prompt hints and its session invariants. A rule or the plan gate that throws asks;
  tables that fail to load deny every tool call.
- cdd7013: A preset package's guard files can import Flow (STA-2097, PLAN section 9 P2). Two new exports:
  `@figentra-oss/flow/guard` (`collectStrings`, `CONFIG_FILE`, `LEGACY_CONFIG_FILE`, and the `BashRule`, `PathRule`,
  `PromptTable`, `SessionTable` and `Decision` types) and `@figentra-oss/flow/guard/neutral` (the neutral preset's
  `PATH_RULES`, `BASH_RULES` and `isSecretPath`). The bundled `neutral` and `stackra` guard files now import through
  them instead of relative paths into Flow's source, so the `stackra` guard folder can move to its own package as it is.
  A test holds every import in a bundled preset's `guard/*.mjs` to `node:*`, a file of the same preset, or a public
  export. The README's preset section says what guard files may import.
- df86903: Flow asks questions through each tool's own question UI (STA-2098 H1 to H4). The `flow-*` commands name a step's
  capability instead of a tool: the question step of `flow-clarify` and `flow-specify` is an `ask` block. The new
  `harnesses` key in `flow.config.json` names the tools `sync --direct` renders the commands for, each through its
  harness adapter: `claude-code` (`.claude/skills/`, the `AskUserQuestion` tool: up to 4 questions, 2 to 4 options, the
  recommended one first and labelled "(Recommended)"), `opencode` (`.opencode/commands/`, its `question` tool),
  `copilot` (VS Code prompt files in `.github/prompts/`), `cursor` (`.cursor/commands/`) and `codex`
  (`.agents/skills/`), the last three with the text table. A tool's question tool keeps the text table for when it is
  unavailable. Without `harnesses` every file renders byte for byte as before. `fflow mcp` gains
  `fflow_questions_list` and `fflow_docs_lookup` (read-only) and `fflow_clarification_record`, its only writer, which
  records an answer in the spec's Clarifications section, replaces the matching `[NEEDS CLARIFICATION]` marker, and
  asks through MCP elicitation when the client supports it and no answer was given; each tool carries `readOnlyHint`.
- db76d7a: `fflow hooks run <pre-commit|commit-msg|pre-push>` runs a stage's git hooks where they can run (STA-1945, FR-18). With
  the workspace install it runs `lefthook run <stage>` here; without it, the configured runner (an `ssh` box or a
  `command` runner such as the testbed) runs the same jobs in a repository that holds only the run's commit, whose index
  is exactly the staged tree; its git steps and the job run without the hook's `GIT_DIR` and `GIT_INDEX_FILE`, so a hook
  in a linked worktree never moves that worktree's branch. A passing pre-commit run is recorded, and the commit-msg run
  adds it to the commit as a `Hooks-Run: local` or `Hooks-Run: box <host> <run-id> <tree-sha>` trailer when it names the
  tree being committed; without one (a merge, or a pre-commit job left out) the commit-msg run runs the pre-commit jobs
  too. A failed run refuses the commit like a local failure and leaves no proof; no runner, or the `github-actions`
  runner, is refused naming `"runner"` in `flow.config.json`, and a staged tree with build or tool output or an oversized
  file is refused before it reaches a box. `LEFTHOOK` and `LEFTHOOK_EXCLUDE` never reach the jobs, here or on a box.
  lefthook's jobs are not yet pointed at it, and `gate ci` does not yet require the trailer.
- a728ef8: `fflow land` asks main's land lane instead of merging (STA-1945, the L2 design's PR E). When the base's own
  `fflow-approve.yml`, read through the contents API, takes the `fflow:land` label, `land` runs its usual checks, then
  adds the label (or comments `/fflow land` once when it is already there) and waits up to `--wait` minutes (default 10) for the lane: a merge finishes as before (exit 0, or 3 on a warning), a refusal prints the lane's reasons (1), an
  owner-only change exits 4, a moved head 1 and a timeout 4 (`fflow land <n>` again finishes it). It counts the
  `fflow/land` status only from the gate App and only when it is newer than the head's last one. `--no-wait` returns
  once asked, `--dry-run` names the path, and `--stack` waits on each PR. It never dispatches, turns on auto-merge or
  merges on that path. A base without the label trigger keeps the dispatch path, with a deprecation warning. A branch
  GitHub already deleted after the merge now counts as deleted.
- 25cdb44: Main's event-driven approve and merge lane (STA-1945, the L2 design's PR D). With `secrets.oidc`, `sync` renders
  `fflow-approve.yml` with four more jobs: `cancel` removes the `fflow:land` label on a push; a keyless `route` job wakes
  on the label, ready for review, `fflow/gate`'s success, a `/fflow land` or `AI-REVIEW:` comment, a listed workflow's
  success (`approve.workflows`) or a 15-minute schedule; `approve` runs `approve-check.mjs` with `MODE=event`; and
  `merge` runs the new `merge.mjs`, one run at a time per repository. A land request counts only when the label's
  newest adder is a User with write or admin, or an App that `approve.requesters` lists. `approve` runs every approval
  rule plus the land rules, approves at most once per head, and keeps one `<!-- fflow/land -->` comment and the
  `fflow/land` status (waiting, owner, refused or approved). `merge` squash-merges at the head with `sha` when the Flow
  App approved that head and nothing is owner-only, or when `apps.owner` approved it, minting a token per PR
  (`merge-workflows` only for an owner-approved workflow change). `FIGENTRA_AUTOMATION` `on` runs both, `merge-only`
  only merges, and anything else freezes the lane. Without `secrets.oidc` the workflow is unchanged; the dispatched job
  stays as `approve-dispatch` for one release. `specAt` is now async.
- dec2e9a: `land` no longer refuses a change for its AI review (ADR 0523 decision 6). A change in a `review.required` tier
  whose verdict on the head is missing, stale or a FAIL now lands with a warning, and the squash commit records the
  verdict as `AI-Review: PASS <head>`, `AI-Review: FAIL <head>` or `AI-Review: none`. A blocking finding that
  `fflow review --record` confirmed still refuses, and every other rule is unchanged. The land rules (`landRules`,
  `gateProblems`, `reviewWarnings`, `squashMessage`, `specAt`, `CONVENTIONAL`, `REVIEW_TIERS` and `MAX_FILES`) move to
  `src/lib/land-rules.mjs`, and the spec's status, tier and approval helpers to `src/lib/spec-status.mjs`, so the
  approval job can run the same rules without importing a command. `commands/land.mjs` and `commands/gate.mjs`
  re-export them, so existing imports keep working.
- 2398bac: `fflow land --stack` lands a whole stack with no human step (STA-1945 FR-16). After each squash it merges the default
  branch into the next PR (a merge commit and a normal push), resolves each conflict in a file whose default-branch
  version is the landed parent's own, stops on any other conflict with the merge aborted and the file named, retargets
  the PR when GitHub has not, gates it unless its head is already green, and lands it. Run again after a stop, it
  resumes where it stopped, also once GitHub has retargeted the next PR. `--dry-run` now prints the stack's plan.
- 89d040a: Task markers, optional tasks, checkpoints and task evidence (STA-1945 FR-23, FR-25). A task line in tasks.md carries
  `[ ]` not started, `[~]` queued, `[-]` in progress or `[x]` done; only `[x]` counts as done. `T012*` marks a task
  optional: it may stay `[ ]` when the spec reaches Done, and `status` lists it as skipped. A phase may end in a
  checkpoint task, `- [ ] T013 Checkpoint: <command>`, which covers nothing and names no route or file; `gate tasks`
  refuses one that is optional, has no command, carries `covers:`, `route:` or `role:`, or is not the last task of its
  phase. `parseTasks` (and `fflow parse tasks.md`) now returns each task's `marker`, `optional` and `checkpoint`. Both
  presets' tasks templates describe the markers.
  
  New `fflow task start <key> <T###>` sets `[-]` on a Tasked or Implementing spec with its approvals and records the
  start (the session named by `--session` or `FFLOW_SESSION`, HEAD, the documents' digest) in Flow's record.
  `fflow task done <key> <T###> --command <cmd>` runs the check command (timed out after an hour), records the command, exit code, duration, HEAD, a clean tree and an output
  digest, and sets `[x]` only on exit 0 at a clean HEAD that the command did not move; a failed attempt stays `[-]` and
  is kept. A command that carries a secret or prints one (`env`, `printenv`, `export`, a `.env` file, `echo` of a
  secret-named variable) is refused before it runs. `fflow trace` counts a ticked task as done only with passing
  evidence once the spec has a record, and fails a Done spec that has a hand tick.
- 3b69d0c: The neutral preset is ready for repositories outside Figentra. It ships `templates/readme-template.md`, a README layout
  that names no brand: the same data file (`.flow/readme.yml`) and sections as the stackra layout, with a generic
  Development section (the data's `development`, or "install, then run the checks CI runs") and the `fflow` steps, a
  Contributing section, Docs, and a licence line with no copyright holder, and no footer. `fflow readme` and `fflow sync`
  now render a neutral repository's README instead of refusing. It also ships `surfaces/agents-md/agents.md` (the shared
  `AGENTS.md` blocks, with no brand, tracker or tool names of its own) and `surfaces/mcp.yaml`, which lists only `fflow
  mcp`, run from the installed package. Nothing else `fflow sync` renders for the neutral preset changes; the preset's
  digest does, so a neutral repository's next `fflow update` records the new one.
- ca3d1db: The Infisical OIDC identity's id can live in the Actions variable `FFLOW_OIDC_IDENTITY_ID` instead of
  `flow.config.json` (Infisical plan K7). `secrets.oidc.identityId` is now optional; the approval workflow's verdict,
  approve and merge jobs pass the variable to the minter, a config id wins, and a missing or malformed id still refuses
  before any network call.
- 838d665: Overrides and mandatory policies (STA-1945 PR 2). A repository changes what `sync` renders with owner-only
  overrides at `.flow/overrides/<surface>/<id>.yml` (schema: `schema/override.schema.json`), each one of `extend`
  (append `items` or `text` to an output, or to one Markdown section), `configure` (set a parameter the preset
  declares), `replace` (swap an output, or a preset command, agent, rule or template, for a file) or `disable` (drop
  an output); `replace` and `disable` need `reason`, `owner` and `review`. The header of each file an override shaped
  names it. The mandatory policies (`guard.secrets`, `guard.tenancy`, `owner-only`, `guard.wiring`) cannot be
  disabled, replaced or configured, and an `extend` of one may only add rules (no `!` item): `sync` skips an override
  that breaks one, or is invalid, and names it, and `validate` and `check` refuse it, naming the policy. An `extend` of
  `owner-only` adds its globs to `land`, CODEOWNERS and the approval workflow. A replacement that links outside
  `.flow/overrides/` is refused. `validate` also refuses an invalid override and one on a target `sync` does not
  render; `check` warns from 14 days before an override's review date and fails after it, and fails when
  `.flow/overrides/` changed without a `sync`. Today's whole-file overrides
  (`.flow/overrides/<name>.md`, `commands/`, `agents/`, `rules/`) keep working as `replace`, and `validate` warns until
  each gets its `.yml`. `.flow/overrides/**` is now an owner-only path, so the rendered CODEOWNERS changes on the next
  `sync`. `fflow check --help` and `fflow validate --help` describe the override and policy checks.
- de3119b: A preset can be an npm package (STA-2097). `flow.config.json` `"preset"` takes a package name such as
  `@acme/flow-preset`: Flow resolves it from the repository root and reads the folder its `package.json` names in
  `"flow": { "preset": "./preset" }`, which must stay inside the package. A bundled name still wins, and a repository
  folder by that name or path still works. A package name that is neither installed nor a folder is an error naming the
  fix. The lock and the provenance headers record the package's own version. A preset declares the Flow versions it
  supports in `peerDependencies["@figentra-oss/flow"]` and in `preset.yml` `requires.flow`. `fflow doctor` has a `preset`
  row that fails, with the fix, when the installed Flow is outside either range, and `sync` and `update` refuse such a
  preset. The new `fflow preset add <pkg> [--dry-run]` installs the package as a dev dependency with the lockfile's
  package manager (pnpm, npm or yarn) and sets the config line. Nothing installs on its own: there is no postinstall. The
  README's new Presets section covers using and writing a preset package.
- 04b9901: Profiles (STA-1945 PR 3). A preset's `preset.yml` declares `profiles: { <name>: { agents, skills, hooks } }` and a
  `default`, where `"*"` selects all; `flow.config.json` names one with `profile`, else the preset's default applies.
  `sync` renders only the selected profile's agents and `flow-*` skills, and `.flow/lock.json` records the profile's
  name. `validate`, `check` and `sync` refuse an unknown profile, naming the preset's profiles, and `check` names a
  profile changed without a `sync`. A repository's own `preset.yml` that Flow's YAML subset cannot read is now refused
  with its line, where before it fell back to the default approval secret names. `neutral` has one profile, `default`;
  `stackra` has `framework` (the default), `platform`, `product`, `brand` and `starter`, which all select everything
  until the preset's content is split. A preset without `profiles` has one implicit `default` that selects all.
  Narrowing a profile does not yet delete the agents and skills it drops; a later release does.
- a25e87f: Flow's record and the lifecycle, first part (STA-1945 PR 10): `.flow/record/<key>.json` on the task's branch with
  its schema (`schema/record.schema.json`); the stage table from `start` to `ship`; `fflow next [<key>]` names a task's
  stage and the command that moves it on, reading the record from the key's worktree or branch; `fflow resume <key>`
  rebuilds a dead session's worktree from its pushed branch, fast-forwards a stale one (refusing a diverged one) and
  re-runs a repeatable stage; `fflow session stop`, the SessionEnd hook, commits the tracked changes as a WIP commit and
  pushes it with the record (never an untracked file or one named like a secret, which it lists; hooks always run, even
  under `LEFTHOOK=0`, and a refusal is reported as that with the hooks' output, the work left uncommitted), named by the
  session's title (its last `/rename`, ADR 0001) rather than its id, and kept as one entry across renames by its
  `session_id`; `fflow session stop --save-only`, the Stop hook, only writes the record. `fflow guard` now also denies a
  push to the default branch, `gh pr merge`, and skipping the hooks (`LEFTHOOK=0` set as a variable, `--no-verify`,
  `commit -n`, a `core.hooksPath` override), also behind `env`, `command` or a program's path, each naming the Flow
  command to use instead.
  `next`, `resume`, `task start`, `task done` and `session stop` run on the console engine with declared arguments and
  options, so each has its own `--help` and a refusal is one error block; `next --json` writes the console's
  `{ ok, data }`, its data tagged `fflow.next/1`.
- 18f731b: `fflow check` holds tasks.md to Flow's records (STA-1945 FR-23, T024): it fails on a task ticked `[x]` by hand, with
  no passing evidence in the record (AC-22), and on a task in progress whose spec, plan or tasks changed since it
  started (AC-24), naming the task and the fix. `check` still writes nothing, so the reset is `fflow task start`'s: it
  first sets each such task back to `[ ]` and prints the reason, then starts the task asked for; a hand-ticked task
  starts again rather than reading as done.
- 7291631: `fflow release --preflight` (STA-1945): whether the owner may merge the version PR now. It reads only and fails (exit
  1, each failed item named with its fix) unless the checkout is on the default branch, clean and at its GitHub head;
  the Quality Gate's `verify` and `test` and the ruleset's required checks are green on main's head and on the version
  PR's head; changesets are pending; the version PR is based on main's head and carries the versions the changesets
  imply; each package publishes to the Release workflow's registry, which does not have the next version yet; and
  `pnpm-lock.yaml`'s importers match the `package.json` files. With `--offline` the network rows are skipped, not
  passed; `--json` prints the rows.
- 1698076: Live sessions, the owner's to-do and the ledger (STA-1945 FR-20, FR-21). `fflow status` now lists each
  running Claude Code or OpenCode session working in a repository or one of its worktrees, by its title (Claude Code's
  `sessions/<pid>.json`; an OpenCode session carries the note `title not readable for opencode`), state (`TRACK · …`,
  `hold · …`, `done · …`), worktree and stage (the worktree's record) in a Live sessions table, and warns (exit 1) when a
  title breaks Flow ADR 0001's pattern or disagrees with the record; with no process listing it shows the records' last
  sessions with a note. New `fflow todo [--repo <path>] [--json]` lists every open owner ask in the records across the
  workspace, each with the command or link that clears it. New `fflow ledger [--since <YYYY-MM-DD>] [--repo <path>]
  [--json]` lists what landed, released and shipped, by day and track, from the records' new optional `history`
  (`{ stage, state, at }[]`), which every record update now appends to when the stage or state changes. Both read each
  key's newest record from the checkouts, the local and origin branches and the default branch, list an unreadable record
  or a missing repository as a problem (exit 1), and are declared on the console with their options under `--help`.
- dfa2b7b: `fflow sync` renders the preset's surfaces (STA-1945 FR-7, part 2): `.claude/settings.json` (the preset's
  `surfaces/settings.json` with Flow's hooks: the guard on `PreToolUse`, its post-write checks, prompt hints and session
  context, and the session's `Stop` record and `SessionEnd` WIP commit and push, FR-19), the OpenCode projection
  (`opencode.jsonc` and `.opencode/plugins/fflow-guard.mjs`, which puts every OpenCode call to the same guard entry,
  an ask as a deny), `.mcp.yaml`, `AGENTS.md` and `CLAUDE.md`, and `lefthook.yml`, wherever the preset has the surface;
  with `lefthook.yml` rendered it pins `mise.toml`'s oxfmt and oxlint at the catalog's versions. Each carries the
  provenance header where its format allows (strict JSON carries none) and is in `.flow/lock.json`. The stackra preset
  gains core's settings and OpenCode configuration as surfaces, and the neutral preset a bare `settings.json`, so a
  neutral repository now gets `.claude/settings.json` and `lefthook.yml` too; a preset without `surfaces/` renders what
  it did before. A profile's `hooks` selects Flow's hooks by id (`guard`, `post-write`, `prompt-hints`,
  `session-context`, `session-save`, `session-stop`); the guard is mandatory and always rendered.
  `fflow guard --print-settings` prints the same hooks. `sync` now deletes every owned file the lock lists that it no
  longer renders and nobody edited (an agent, rule, skill, surface or hook file a narrower profile or preset drops), not
  only `flow-*` skills and commands; an edited one is kept, stays in the lock, and `check` names it until it is deleted
  by hand. `sync` never touches the spec folders (`.agents/specs/`). The configuration gains `mcp`, `lefthook` and
  `agentsMd` (`facts`). A surface replaces a repository's own file of the same name on its first `sync`.
- ecf14b0: Flow can render a repository's agent and hook surfaces from its preset (STA-1945 FR-7, part 1). `renderMcp` writes
  `.mcp.yaml` from the preset's `surfaces/mcp.yaml` and the configuration's `mcp` servers, and refuses any `env` value
  that is not a `$NAME` reference. `renderAgentsMd` writes `AGENTS.md` and a `CLAUDE.md` that imports it, from the
  preset's shared blocks and the repository's own facts. `renderLefthook` writes `lefthook.yml` from the preset's jobs and
  the configuration's `lefthook` jobs, and wraps every pre-push job so it passes on the registry's 401 alone; `pinTools`
  sets `mise.toml`'s oxfmt and oxlint pins to the catalog's versions. The stackra preset's hooks run oxfmt and oxlint as
  named mise tools (`mise exec npm:oxfmt -- oxfmt`) and skip them with a note where mise is missing, with no `pnpm exec`
  fallback (STA-2039). `stringifyYaml` and `surfaceYaml` are new helpers. `fflow sync` does not call the renderers yet:
  part 2 wires them in and adds their configuration keys to the schema.
- 3848302: The spec and plan templates of both presets ask for documents specific enough to check (STA-1945, A-3). A spec now
  states its Discovery before its requirements (current behaviour, topology, dependencies, ownership, the constraints
  already decided) and lists its `### Sources` as `SRC-###` lines that every requirement cites; it adds
  non-functional requirements as `NFR-###` EARS lines, measurable success criteria, and, for the small tier, a one-page
  `## Design` with its folder tree and interface declarations. A plan adds the key trade-off and research, an
  applicable-standards table, Mermaid architecture and sequence diagrams, per-component folder trees, interfaces,
  behaviour and failure modes, partial-failure ordering and open questions. Worked examples sit in comments, which the
  gate ignores. `/flow-specify` asks for the Discovery and its Sources.
- 2659c42: The stackra preset carries Stackra core's agent content (STA-1945, D2): 27 role agents beside the three stewards, 14
  more rules beside the worktree rule, 16 of its own skills, the agent reference (`reference/`), `routing.yaml` and `models.yaml`.
  `fflow sync` on the stackra preset now renders them: the agents and rules as before, each skill folder file for file
  to `.agents/skills/<name>/` (`.claude/skills/<name>/` with `--direct`), and the reference, routing and models to
  `.agents/reference/`, `.agents/routing.yaml` and `.agents/models.yaml`, each with its provenance header and recorded in
  `.flow/lock.json`. A stackra repository that keeps its own copies of these files gets them owned by Flow on its next
  sync. The neutral preset is unchanged. The stackra `preset.yml` splits the agents and skills by profile (FR-6, D3),
  and `sync` renders only the config's profile's share: `framework` (the default) gets all of it; `platform`, `product`
  and `starter` all but the `compiler-engineer` agent; `brand` twelve agents (the stewards, review, specs, ADRs,
  dependencies, design and accessibility, and the security, secrets and incident agents its routing and secrets rule
  name) and the `flow-*`, spec and ADR skills, plus the design ones its `third-party.yml` lists. The reference,
  routing and models go to every profile. Each of these files is a preset source an override may `replace`
  (`skills/<name>/<path>`, `reference/<path>`, `routing.yaml`, `models.yaml`), as the commands, agents and rules are.
  `fflow validate` names each agent or skill a profile selects that its preset
  lacks, and `sync` refuses a preset skill folder named `flow-*` (it would replace a rendered command) or a preset file
  that is not UTF-8 text. The secrets rule is owner-only at its `--direct` path (`.claude/rules/secrets.md`) as well as
  at `.agents/rules/secrets.md`. Upstream skills are not vendored (owner, 2026-11-04): the 20 that core
  copied in (archify, playwright, turborepo, vitest, pnpm, the Expo and EAS ones and others) are listed in
  `third-party.yml` by source and licence, and `fflow doctor` names where to install each.
- 18f731b: The stage commands write Flow's record (STA-1945 FR-14, T015), so `fflow next` always knows the stage: `fflow start`
  records `start` (or `worktree` for a spec already Tasked) on the new branch, committed and pushed; `fflow spec
  setup-plan` ends the spec stage the same way; `fflow gate run` writes the verdict on the gated sha (`gate` done or
  failed) without committing it, since a commit would move the head off the gated sha, and no longer counts the record as
  an uncommitted change; `fflow land` records `land` done with the PR in the task's worktree after the merge (committed
  there, never pushed; a failure only warns, exit 3); `fflow ship` records `ship` done in a landed task's checkout. Off a
  task's branch nothing is recorded, and a record that cannot be committed or pushed is a warning, never the stage's
  failure. `endStage` in the record library is the shared step.
- f0686a8: Stage workflows (STA-1945 FR-15). Three stages now run a Claude workflow that the stage command hands its input and
  whose output it validates and records in Flow's record.
  
  - **Plan.** `/flow-plan` also splits the approved spec into PR-sized tasks and writes tasks.md; `/flow-tasks` is gone,
    and `sync` removes its rendered skill and command when they are unedited (`fflow diff` lists them as deletes). The
    same goes for an unedited `flow-*` skill or command that a narrower profile no longer selects.
    `fflow plan <key> --input` prints the FRs and ACs to cover, the documents to read and the size budget (the most
    files a task may name: the preset's `plan.maxFilesPerTask`, default 10). `fflow plan <key> --record <tasks.md>`
    writes tasks.md into the spec folder only when `gate tasks` passes (its task, role and folder-tree checks), every
    FR and AC is covered and each task holds its budget, and records the plan stage; otherwise it names each problem
    and writes nothing. Readiness is the gate's own spec and approval checks: a
    draft, an unclarified spec, an unapproved feature or big spec, or a small spec (its tasks stay in spec.md) is
    refused, and so is a tasks.md that already carries issue keys or progress markers. A brace path
    (`a/{b,c}.md`) counts as each file it names; dotted names that are not files (`gate.shard`, `0.3.0`) do not.
  - **Review.** New `/flow-review`: four parallel reviewers (correctness, simplicity, security and tenancy, contracts),
    then one verifier per finding. `fflow review <pr> --input` prints what they read;
    `fflow review <pr> --record <findings.json>` refuses output that is not a list of findings, else records the
    verdict and the confirmed blocking findings. `fflow land` refuses a PR with a confirmed blocking finding in any
    review of its newest reviewed commit, and names it: only a review of a new head clears one. A record at the head
    that cannot be read refuses too.
  - **Gate.** New `/flow-gate`, and `fflow gate run --shards <n>` (a `command` runner, such as the testbed): the
    workspace's packages (`pnpm-workspace.yaml`) are dealt into at most n shards (up to 12), one
    `stackra testbed run … --json` call per shard runs all at once with `gate.shard`'s `{filters}`, and one
    `fflow/gate` status is posted, green only when every shard exited 0. A shard that finds no free slot or healthy box
    (73, 75) is tried once more; if it still fails and no other shard failed, nothing is posted, since that is never a
    test failure. Each `*` segment of a workspace pattern is expanded (`packages/*/*`); any other glob, a `packages`
    that is not a list, or a package folder a shell line cannot take is refused rather than skipped. The spec gate
    runs on the first shard only. New
    configuration key `gate.shard`: the shard's check command, with `{filters}` for its `--filter=./<package>` flags.
  
  The record's `review` entries gain `pr` and `blocking`.
- 3b69d0c: `fflow status --divergence` reports how far each repository of the workspace list (or `--repo <path>`) has moved from
  its preset (STA-1945 FR-9, AC-11): the Flow version, the preset (name, version, digest) and the profile its
  `.flow/lock.json` records, the preset lag (the locked version against the installed one), the overrides by kind with
  each `replace` and `disable`'s owner and review date and those past it, and the drift `fflow check` finds against the
  lock. A repository without a lock is "not synced", never skipped. It is read-only and makes no GitHub call; `--json`
  writes `{ repos: [...] }`, and the exit code is 1 when a repository drifts or holds an override past its review date.
  It refuses `--metrics`, `--web` and `--by`. The report is `divergence(root, options)` in `src/lib/divergence.mjs`.
- 885fe7a: Third-party skills (STA-1945 PR 7). A preset's `third-party.yml` lists each skill by source, version (a full commit id),
  licence and digest; `fflow sync` installs the ones the profile selects into the git-ignored `.agents/skills/.vendor/`,
  all or none and before it writes anything else, and pins them in `.flow/lock.json`'s `skills`. A licence outside MIT,
  Apache-2.0, BSD and ISC needs the owner's `ownerEntry` (`third-party.yml` is owner-only, so `land`, the approval check
  and CODEOWNERS hold it to the owner), a failed fetch names the skill with a mirror hint, a digest that is not the pinned
  one refuses, and a vendor folder that is a symbolic link refuses, with nothing installed. A `machineOnly` skill is never
  installed or locked: `fflow check` fails when one is committed to the repository (by folder name or its `SKILL.md` name,
  whatever the profile) and when git cannot list the tracked files, and `fflow doctor` lists each with where to install it
  (`~/.claude/skills/<id>/`) and its source. The stackra preset marks HeroUI Pro's two skills, Remotion's six and the
  owner's own 13 as machine-only.
- d3364a0: Waves and the parallel build (STA-1945 FR-24). New `fflow task wave <key> [--json]` prints the build's next wave (with
  `--json`, the console's `{ ok, data }` whose `data` holds `wave`, `of` and `tasks`) and sets its `[ ]` tasks to `[~]`
  (queued): each task comes after its `deps`, no two tasks of a wave share a path, a wave holds at most five tasks, and a
  checkpoint runs alone after every task above it, with nothing below it starting before. A wave that still holds a failed
  or unfinished task is printed again, so the next one never starts; an optional task left `[ ]` is never queued and holds
  nothing. A dependency cycle, or a spec not yet Tasked or Implementing with its approvals, is refused. `fflow next` and
  `fflow resume` now read the build from tasks.md's markers: they name the next wave (one a dead session left restarts at
  its first unfinished task), and the gate once every wave is done. Both presets ship a new `flow-build` command, the
  build workflow: it asks `task wave`, starts the wave's tasks, runs them as parallel subagents, commits each, runs
  `task done` for each, and stops at the wave boundary when one fails. `fflow plan` does not write the wave graph yet:
  that lands with `fflow plan` itself (STA-1945 T100).

### Patch Changes

- 603b742: The baseline gate no longer reports a task as missing when its task name (the part after `#`) was dropped from
  `baseline.tasks`: `gate baseline save` now writes the configured `baseline.tasks` into `baseline.json`, and `check`
  skips a missing task only when its name is in main's saved list but not in the PR's. Dropping `test` keeps Baseline
  green against a main baseline that still has `pkg#test`. A configured task the PR did not run, a dependency task
  nobody configured (such as `pkg#gen`), and anything against a main baseline saved before this release, are still
  missing until main saves a new baseline (STA-1945).
- 4783660: `passed`, which decides whether a task's recorded attempts include a passing one, is typed by the two fields it reads
  (`exit` and `clean`), so the attempts of a record, where `ms` is optional, type-check against it (STA-1945 FR-23).
- 2394a85: The guard engine also refuses an agent's write to `figentra-flow.config.json`, the configuration's legacy name, which
  is still read and so still picks the preset. When the configuration does not load (both names at once, or JSON that
  does not parse), the guard tables fail to load and every tool call is denied, instead of quietly falling back to the
  neutral preset's tables. `fflow help` now describes `guard` as the guard engine rather than the worktree hook.
- ac476c4: `landOne` (the function behind `fflow land`) given a `refs` issue no longer reads a key from the branch name. Before,
  a branch slug that only looked like a key, such as `adr/0008-sta-12-cleanup` for a reservation that refs STA-34, won:
  the squash said `Refs: STA-12`, that issue's spec was checked and that issue was moved to Done. Now `refs` is the PR's
  issue: the squash names it, no spec is read by the branch's key and nothing moves to Done, as `fflow adr reserve`
  intends.
- 4a09be1: `fflow linear tasks` titles each sub-issue with the task's id and the first clause of its text, cut at a word to 120
  characters, and puts the whole task line in the description. Linear no longer refuses long task lines with "Argument
  Validation Error".
- 375b733: The package describes Flow for any team, not only Stackra repositories, and its README shows the two `.npmrc`
  lines that install it from the Figentra registry without a token. The repository now has a security policy
  (`SECURITY.md`, private vulnerability reporting) and a contributing guide.
- f509997: The stackra and neutral presets' oxfmt pre-commit job no longer swallows oxfmt's exit 2. It passes
  `--no-error-on-unmatched-pattern`, so staged files that are all on oxfmt's ignore list still pass, and a staged file
  oxfmt cannot parse, which also exits 2, now fails the commit.
- de17041: The AI review reader now accepts one reviewer App slug or a list of them: a verdict counts only from the first line of
  a Bot comment posted through a listed App, an unlisted App or a User still never counts, and an empty list (or one
  holding only unset slugs) means no review App is configured, as before. An edit to any listed App's comment still voids
  every verdict before it, whatever the edited body says, so an edited FAIL cannot bring back an earlier PASS. `land`
  still reads only `apps.review.slug`; the Flow App's slug joins the list once its key is reachable only from main's OIDC
  workflow (STA-1945).
- d0ff5a1: `fflow status --web` answers only requests addressed to itself: a Host other than `127.0.0.1:<port>` or
  `localhost:<port>` (or none) is 421, and an Origin other than `http://127.0.0.1:<port>` or `http://localhost:<port>`
  is 403, so a web page that rebinds its own name to 127.0.0.1 can no longer read `/status.json` and the repositories,
  pull requests, branches and sessions it names. Every response also carries `Cache-Control: no-store` and
  `X-Content-Type-Options: nosniff`.

## 0.2.3

### Patch Changes

- 931644e: `sync` writes the baseline workflow's setup steps as block YAML, not JSON flow mappings, which the Stackra YAML
  standard (STA-299, `repo-checks/yaml-flow-maps`) refuses. The values are unchanged (STA-1942).

## 0.2.2

### Patch Changes

- f555847: The command is now `fflow` (owner, 2026-11-02). `figentra-flow` still works for this release and prints one notice.
  `sync` renames `figentra-flow.config.json` to `flow.config.json` once (it refuses when both exist) and replaces the
  `figentra-flow-*.yml` workflows with `fflow-approve.yml`; the approval environment is `fflow-approve` with the secrets
  `FFLOW_APPROVER_APP_ID` and `FFLOW_APPROVER_PRIVATE_KEY` (set them with the owner's setup script, then delete the old
  environment). The package name, `@figentra-oss/flow`, does not change.
  
  `fflow gate baseline` (STA-1942): in a repository whose main is red, the `Baseline` check lets a pull request land
  when it makes nothing worse than main: no new failure, no task dropped or skipped, no red `baseline.mustPass` task,
  and no more failures than main. A missing baseline fails closed. With `baseline` in the config, `sync` renders
  `fflow-baseline.yml`. It is a merge gate, not a release certificate.

## 0.2.1

### Patch Changes

- 1e757f1: The stackra preset's git-steward and both presets' worktree rule name `.claude/worktrees/<name>/` instead of the bare
  `.claude/worktrees/`, so a repository's agent check (Stackra core's `agents:check`) no longer reports a reference to a
  folder that a clean checkout doesn't have.

## 0.2.0

### Minor Changes

- af02ff3: `figentra-flow land` now refuses owner-only changes, matched case-insensitively:
  
  - workflows and actions;
  - what a deploy, promote or release runs, including the root package.json's scripts;
  - secrets and their guards;
  - the catalog, including a dependency moved off `catalog:`;
  - the Flow configuration;
  - repo settings;
  - billing and legal files;
  - a repository's own `approve.ownerOnly`.
  
  When the ruleset requires an approving review, `land` waits until every required check is green from its trusted source. It then dispatches the new `figentra-flow-approve.yml` and turns on auto-merge at the head instead of merging. It never uses an admin path.
  
  `land` on a PR that merged into the default branch finishes it. It deletes the branch only while it still points at the landed head.
  
  `sync` renders four things:
  
  - The approval workflow. It runs the tested `approve-check.mjs` at the pinned version in the `figentra-flow-approve` environment, which must allow only the default branch. It reads files and checks at the exact head, approves there, and dismisses its own approval if the head moved. The approving App's secrets have their own names.
  - A CODEOWNERS for the owner-only paths, when `apps.owner` is set.
  - Each preset's steward agents. Both presets ship `git-steward` and `ci-steward`; neutral adds `tracker-steward` and stackra adds `linear-steward`.
  - A new `approve` config block that holds `ownerOnly` and the trusted `checks`.
  
  STA-1856.
- 2f1d972: `figentra-flow clean` now keeps each repository within a worktree budget: `clean.budget`, default 10.
  
  - **Warning:** `clean` warns when the repository has more worktrees than the budget.
  - **Candidates:** `clean` lists worktrees that have been idle for 24 hours or more and whose work is merged or pushed.
  - **`clean --budget`:** removes those candidates after preserving what they hold:
    - uncommitted work and a detached HEAD go to a new local `keep/<repo>-<name>` branch (hooks run; a refused commit keeps the tree as it was);
    - ignored files outside the caches go into an archive under `~/Backups/figentra-flow/`.
  
    It never forces a removal and never deletes a branch.
  
  `doctor` warns, without failing, when the repository is over the budget and when the disk is low (under 10 GB or 10 % free).
  
  `sync` installs a worktree rule from the presets into the agent rules. `init` and `clean` write `.claude/worktrees/README.md`. Both presets' `git-steward` runs the budget.
  
  STA-1871.
- 62e000a: `figentra-flow readme [--check]` renders a repository's `README.md` from `.flow/readme.yml` through the preset's `readme-template` (STA-1879). The `stackra` preset ships Figentra's standard layout: banner, badges, tagline, What it is, Status, Quick start, Architecture at a glance, Development, Docs and playground, Release and changelog, Security, Licence and the footer. `sync` renders the README too, when the data file exists, and records it in `.flow/lock.json`, so `gate ci` catches a hand edit.

### Patch Changes

- 83c225f: The README data-file example points the banner at the brand kit's images at a pinned figentra/brand ref, as figentra/brand ADR 0001 asks (the brand is pulled, never copied), instead of copies committed in the repository.

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
