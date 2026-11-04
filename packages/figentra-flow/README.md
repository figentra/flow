# Figentra Flow

Figentra Flow is spec-driven development for agent teams. It owns the path from a spec to a landed change: the
templates, the presets, the `flow-*` commands it renders for Claude Code and OpenCode, the `.flow/` folder, and the
gates that keep each spec, its plan, its tasks and its tests in step. Its command texts and two templates derive from
[GitHub spec-kit](https://github.com/github/spec-kit) 1.0.10 (MIT; see `THIRD_PARTY_NOTICES.md`); nothing runs
spec-kit's `specify`. It is one package, `@figentra-oss/flow`, with the binary `fflow` (the old name `figentra-flow`
still works for one release). It is published on the Figentra registry, which anyone can read without a token:

```ini
# .npmrc
@figentra-oss:registry=https://npm.stackra.figentra.com/
@stackra:registry=https://npm.stackra.figentra.com/
```

```sh
pnpm add -D @figentra-oss/flow             # from the Figentra registry: @figentra-oss:registry in .npmrc
pnpm exec fflow init         # .flow/ and the flow-* skills, with the configured preset
pnpm exec fflow sync         # re-render the flow-* skills after a preset or Flow upgrade
```

## Commands

`fflow` runs on [`@stackra/console`](https://github.com/figentra/stackra/tree/main/packages/developer/console), the
one CLI engine of every Figentra CLI. `fflow` alone prints the banner, the version and the commands by group;
`fflow <command> --help` (or `fflow help <command>`) prints its usage and runs nothing; a mistyped command names the
closest one and exits 2. A failure is one error block: what failed, why, the fix and a docs link. Output is plain text
under `NO_COLOR` or in a pipe, and `doctor`, `status` and `status --metrics` take `--json`, which writes one document,
`{ "ok", "data" }`. That is a breaking change for scripts: `doctor --json` no longer writes
`{ "schema": "fflow.doctor/1", "checks" }` (its check rows, each with `id`, `ok`, `status` and `group`, are `data`), and
`status --json` and `status --metrics --json` put the snapshot and the metrics in `data`.

`doctor`, `status`, `next`, `resume`, `task start`, `task done`, `task wave`, `todo`, `ledger`, `session stop`, the
governance commands (`update`, `check`, `diff`, `validate`) and the stage commands (`plan`, `review`) are ported to the
engine (`next` takes `--json` too). Every other command is passthrough, keeping its own flags and output until it is
ported: `adr`, `app`, `clean`, `gate`, `guard`, `hooks`, `init`, `land`, `linear`, `mcp`, `migrate`, `parse`, `readme`,
`release`, `ship`, `spec`, `start`, `sync`, `team`, `trace` and `train`.

`@stackra/console` and `@stackra/validation` (0.7.1) are runtime dependencies of Flow (ADR 0506 decision 8, owner
2026-11-03; this replaces STA-1945 NFR-1's "no runtime dependency, an optional peer"). They come from the Stackra
registry, read without a token, so map the scope first (`@stackra:registry=https://npm.stackra.figentra.com/` in
`.npmrc`), never npmjs. Only the CLI layer loads them: the governance core (gate, approve, land, record, lock,
baseline) imports nothing from `@stackra/*`, and `fflow guard`, the agent hook, dispatches before the engine loads.
`pnpm-lock.yaml` is regenerated on the box with this dependency change.

| Command                                                               | What it does                                                                                                                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fflow init [--force]`                                                | writes `.flow/` (README, a starter constitution, `.gitignore`), a starter `flow.config.json` when there is none, and renders the `flow-*` skills                                                 |
| `fflow migrate [--dry-run]`                                           | moves a spec-kit repository onto `.flow/` (constitution, `.specify/` and `.agents/speckit/` deleted, scripts, pins and skips), then syncs                                                        |
| `fflow spec paths\|setup-plan\|setup-tasks\|template`                 | the spec folder, its documents and the resolved templates as JSON, for the `flow-*` commands                                                                                                     |
| `fflow spec ask <key> [--async]`, `fflow spec resume <key>`            | the spec's open questions; `--async` posts them on the issue and marks the spec waiting, `resume` records the answers given there (see [Asynchronous questions](#asynchronous-questions)) |
| `fflow sync [--direct]`                                               | renders the `flow-*` skills (for the repository's projector, or Claude Code and OpenCode directly), each with its provenance header, and writes `.flow/lock.json`; refuses a preset that differs from the lock |
| `fflow update [--preset <version>]`                                   | prints the diff, adopts the installed preset into the lock, then syncs; `--preset` refuses any version but the installed one |
| `fflow check`                                                         | the CI check: fails, naming each cause, on an owned file that differs from the lock, a preset that differs from its locked digest, an invalid config or override, a profile the preset lacks or the lock does not record, a mandatory policy off, an override changed without a `sync`, or an override past its review date (and warns 14 days before); writes nothing |
| `fflow diff`                                                          | prints every file `sync` or `update` would add, change or delete, with the lines; writes nothing |
| `fflow validate`                                                      | checks `flow.config.json` and `.flow/overrides/` against their schemas and the mandatory policies, naming each field, target or policy that breaks them and a `profile` the preset lacks; writes nothing |
| `… --workspace <dir>`                                                 | runs `sync`, `update`, `check`, `diff` or `validate` in every repository under `<dir>` that has `flow.config.json`, one line each |
| `fflow gate run [--ref b] [--box host] [--shards n] [-- flags]`       | the repository's checks through the configured runner (or on `--box`) at the pushed head, fanned out by package shard with `--shards`; one `fflow/gate` is posted as the gate App               |
| `fflow plan <key> --input \| --record <tasks.md>`                     | the plan workflow's input (FRs, ACs, documents, size budget), and its tasks.md written only when every FR and AC is covered within the budget and `gate tasks` passes                         |
| `fflow review <pr> --input \| --record <findings.json>`               | the review workflow's input, and its verified findings recorded; `land` refuses a confirmed blocking one                                                                                         |
| `fflow hooks run <pre-commit\|commit-msg\|pre-push>`                  | the stage's lefthook jobs here with the workspace install, else on the runner's box for the staged tree; the commit gets a `Hooks-Run:` trailer                                                  |
| `fflow land [<pr>] [--stack] [--dry-run] [--manual-ok] [--wait <m>] [--no-wait]` | squash-merges a PR that is green on `fflow/gate` from the gate App on its head and has its approvals, or asks main's land lane with `fflow:land` and waits for its merge; Linear Done, worktree and branch removed |
| `fflow adr reserve <slug> --issue <key> [--owner <who>]`              | under the `adr` queue lock (`flow/queue/adr`, stale after 15 minutes), lands the next number of the preset's `queues.adr` file on the default branch, then prints only it on stdout; a reservation that does not land is withdrawn |
| `fflow train <open\|add\|close\|build\|eject\|depart\|status>`        | the release train: board green PRs, cut off, build `train/<version>` by merge commits with bisect ejection, depart by fast-forward (see [Release trains](#release-trains))                       |
| `fflow ship <dev\|staging> [--workflow f] [--dry-run]`                | dispatches the product's Runway deploy workflow (`deploy.yml`, input `environment`) on main; production is refused: the owner promotes                                                           |
| `fflow release [--json] [--offline]`                                  | what the next release would publish: pending changesets and next versions, the version PR, the Release workflow's last run and its notices, the registry's versions; it publishes nothing        |
| `fflow preset add <pkg> [--dry-run]`                                  | installs a preset package as a dev dependency with the package manager whose lockfile the repository has (pnpm when none), then sets `"preset": "<pkg>"` in `flow.config.json`; run `fflow sync` after. `--dry-run` prints both and runs nothing |
| `fflow doctor [--json] [--offline]`                                   | checks Node, git, the configuration, the preset (installed, and this Flow inside its declared range), the `.flow/` install, the ignored worktree folder, the roster and the credentials, grouped (Machine, Repo, Flow, GitHub), each with its fix                 |
| `fflow gate plan <spec.md>`                                           | exits 1 until the spec may be planned (run by `fflow spec setup-plan`)                                                                                                                           |
| `fflow gate check <dir>` / `tasks <tasks.md>`                         | the stage rules for the spec's `**Status**`; the tasks lint                                                                                                                                      |
| `fflow gate lane` / `branch` / `ci` / `dir`                           | the lane check, the branch warning, the CI gate with the install check, the spec folder                                                                                                          |
| `fflow trace trace <dir>` / `drift` / `ci`                            | the FR/P → task → `@covers` test matrix, spec-vs-diff drift, the Done rules                                                                                                                      |
| `fflow parse <file>`                                                  | what the parsers read from a `spec.md`, `plan.md`, `tasks.md` or `routing.yaml`, as JSON                                                                                                         |
| `fflow linear issue <spec.md>` / `tasks <tasks.md>`                   | the spec's Linear issue and one sub-issue per task; `--dry-run` needs no token                                                                                                                   |
| `fflow start <STA-n> [--slug s] [--install]`                          | branch `figentra/sta-n-<slug>` from `origin/<default>` into `.claude/worktrees/sta-n-<slug>`; issue In Progress                                                                                  |
| `fflow clean [--dry-run] [--adopt] [--fix-ignore] [--budget] [--all]` | removes finished worktrees (clean, saved, issue Done or idle 2 h), reports what it kept and the space freed; warns over `clean.budget`, and `--budget` sweeps idle merged or pushed trees safely |
| `fflow guard [--print-settings]`                                      | the guard engine on the hook event on stdin: the preset's rules, the side doors and the secret files; `--print-settings` prints the hooks that wire `bin/fflow-guard.mjs` for four events        |
| `fflow init --workspace <dir>…`                                       | writes the workspace list (`~/.config/fflow/workspace.yaml`) that `--all` acts on                                                                                                                |
| `fflow status [--repo p] [--json] [--offline]`                        | specs by status, worktrees, open PRs with their gate and review, and sessions, for every repository of the workspace                                                                             |
| `fflow mcp`                                                           | an MCP server over stdio: status, spec, trace, worktrees, metrics, a spec's open questions, a docs lookup, and the one writer, recording an answer                                               |
| `fflow next [<key>] [--json]`                                         | the task's stage and the command that moves it on, from Flow's record on the key's worktree or branch                                                                                            |
| `fflow resume <key>`                                                  | re-enters the stage a stopped session left half done: the task's worktree, fast-forwarded to its pushed branch                                                                                   |
| `fflow task start\|done <key> <T###> [--command c]`                   | moves a task's marker: `[-]` on start; `[x]` only when the check command exits 0 at a clean HEAD, recorded                                                                                       |
| `fflow task wave <key> [--json]`                                      | queues the build's next wave (`[ ]` → `[~]`) and prints it; a wave with a failed or unfinished task is printed again                                                                              |
| `fflow session stop [--save-only]`                                    | the SessionEnd hook: commits and pushes the tracked work with the record; `--save-only`, the Stop hook, writes the record                                                                        |
| `fflow init --runner github-actions [--force]`                        | writes the gate workflow for the `github-actions` runner, and a starter config when there is none                                                                                                |
| `fflow readme [--check]`                                              | renders `README.md` from `.flow/readme.yml` through the preset's `readme-template` (stackra); `--check` exits 1 when it differs                                                                  |

A repository keeps one-line aliases: `"spec:gate": "fflow gate"`, `"spec:trace": "fflow trace"`,
`"spec:sync": "fflow sync"`, and `"spec:linear": "infisical run --env=dev --path=/agents --silent -- fflow linear"`.
`fflow linear` reads its token from the environment only (`LINEAR_AGENT_TOKEN`, else `LINEAR_API_KEY`) and never
prints it.

## The README

With the `stackra` preset, a repository's `README.md` is rendered from its data file `.flow/readme.yml`, so every
Figentra repository has the same layout and its own content. The sections are: banner, badges, tagline, What it is,
Status, Quick start, Architecture at a glance, Development, Docs and playground, Release and changelog, Security,
Licence, and the footer. `fflow readme` writes it, `readme --check` fails when it was edited by hand, and
`sync` renders it too and records it in `.flow/lock.json`. A repository can override the layout with
`.flow/overrides/readme-template.md`.

```yaml
name: Figentra Pay # required: the product's name
repo: figentra/pay # required: owner/name, for the badges and links
tagline: Payments, wallet and payouts for every Figentra product. # required: one line, same as the GitHub description
status: In progress # required: Live | In progress | Planned
statusNote: dev pilot (pay#18) # optional: after the status, 80 characters at most
banner: # optional: the brand kit's images at a pinned figentra/brand ref (pulled, never copied)
  light: https://github.com/figentra/brand/raw/brand-pay@1.0.3/brands/pay/3d/stills/pay-3d-og-light-en.png
  dark: https://github.com/figentra/brand/raw/brand-pay@1.0.3/brands/pay/3d/stills/pay-3d-og-dark-en.png
package: "@figentra/pay" # optional: the release badge's text (default "latest")
licence: Commercial # optional: overrides what LICENSE says (MIT, else Proprietary)
ci: ci.yml # optional: the CI workflow for the badge (default ci.yml)
docs: https://docs.example.com # optional: a badge and a link
playground: https://play.example.com # optional: a badge and a link
site: https://pay.figentra.com # optional: a link
what: | # required: Markdown
  …
quickstart: | # required: Markdown
  …
architecture: | # required: Markdown
  …
development: | # optional: replaces the `pnpm install` / `pnpm verify` block
  …
release: | # optional: replaces the Changesets paragraph
  …
```

## Configuration

A repository chooses Figentra Flow's adapters in `flow.config.json` at its root. The file is checked against the shipped
schema (`schema/flow.config.schema.json`, which editors read through `"$schema"`), and an unknown key or a wrong
type stops every command, named by its path. Nothing defaults to an organisation's choice. A command that needs a
setting you have not made refuses and names it.

```json
{
  "$schema": "./node_modules/fflow/schema/flow.config.schema.json",
  "version": 1,
  "credentials": { "kind": "gh-user" },
  "secrets": { "kind": "env" },
  "gate": { "check": "pnpm verify" }
}
```

- `credentials` says how GitHub calls and network git authenticate:
  - `env`: `GH_TOKEN` is set by the caller;
  - `gh-user`: your own `gh` login, on purpose;
  - `wrapper`: your own commands, e.g. `"gh": ["pnpm", "bot:gh", "--"]` and `"git": ["pnpm", "bot:git", "--"]`.

  There is never a fallback to a personal login. A local origin (a path) needs no credentials.

- `secrets` says how secrets reach the gate's poster on a box: `env` (the box's environment), or `infisical` with
  `paths` per scope, e.g. `"gate": "/ci/gate"`. On a box with no login, `"auth": "universal-auth"` logs in
  from the box's `INFISICAL_UNIVERSAL_AUTH_CLIENT_ID` and `INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET` inside the wrapped
  command, and `projectId`, `env` and `domain` name the project, environment and instance. The token goes only into the run
  process's environment, never onto a command line. When the box's ssh shell lacks the CLI or the identity, `bin` names the CLI
  (`"~/.local/bin/infisical"`) and `envFile` a file holding the two `INFISICAL_UNIVERSAL_AUTH_CLIENT_*` lines, read
  in a subshell for that one command and seen only by the login. There is no default for either. On a box, Figentra Flow wraps the command and never reads a
  value.
  `oidc` (`identityId`, the uuid of an Infisical OIDC machine identity, and `audience`, e.g. `"fflow-ci"`) names the
  identity main's approval job logs in as with its own OIDC token, to mint a narrowed Figentra Flow App token in
  process (`src/lib/app-token.mjs`); that path reads the App's key, in memory only. The `github-actions` runner's
  verdict uses it (see "The github-actions runner's verdict").
- `gate.check` is the check command (default `pnpm verify`). `gate.shard` is the check one shard of
  `gate run --shards <n>` runs, with `{filters}` for its packages as `--filter=./<folder>` flags, e.g.
  `pnpm format:check && pnpm turbo run lint typecheck test build {filters}`.

- `tracker` names the issue tracker:
  - `linear` with `team` and `branchPrefix`, and optionally `token`, the names of the environment variables holding
    the token;
  - `github-issues` with `branchPrefix`, which uses keys `gh-<n>` for the repository's own issue `#<n>`.

  Issue keys are `<prefix>-<n>`. `fflow start <key>` makes branch `<branchPrefix>/<key>-<slug>` and worktree
  `<key>-<slug>`; `otherBranchPrefixes` (e.g. `["delegate"]`) names further prefixes the branch check accepts. The
  spec gate and trace read the same scheme: spec folders are `<key>-<slug>`, a spec's `**Linear**:` or `**Issue**:`
  line names its key, and tests tag `@covers <key>:<ID>`. `start`, `clean`, `land` and the spec gate's stage comments read and move issues through the
  tracker. A tracker failure is a warning, never silent and never an exit code. Without a `tracker` block, keys of
  any prefix are read and the commands that move issues refuse, naming the key.

- `clean.keep` lists worktree names `clean` never removes or adopts. These are globs such as `*-gate`.
- `artifacts` is the guard `gate run` and `land` apply to a change. `paths` defaults to `.cache/`, `node_modules/`,
  `dist/`, `.turbo/` and `coverage/`, where a trailing `/` matches the folder at any depth and other entries are globs.
  `maxBytes` defaults to 5 MB. A change that adds or changes such a file is refused, with each file named.

- `apps` names the GitHub Apps Flow trusts:
  - `gate.login`: the gate App whose status `land` trusts; `gate.aliases` lists its other logins while the App is
    renamed, and its status counts from any of them. Add the new login as an alias before the rename; in the same step
    as the rename, make it the `login` and drop the alias, since GitHub frees the old name for another App;
  - `review.slug`: the review App whose verdict counts;
  - `owner`: the owner whose `owner-approval` review also counts.

  There are no defaults. Without a gate App `land` refuses, and without a review App no verdict counts.

  `fflow app create gate|review [--org <login>] [--name <name>] [--key-file <path>]` creates either App by
  GitHub's App-manifest flow, for a human at a terminal only (an agent or CI session is refused). It opens a local
  page that sends the manifest to GitHub (no webhook; the gate gets `contents: read`, `statuses` and
  `pull_requests: write`, the review App `contents: read`, `pull_requests` and `issues: write`), then hands the private
  key and the App id to the secrets port: with `infisical`, `infisical secrets set NAME=@<file>` under the role's path,
  so the key is on no command line; with `env`, a new 0600 file at `--key-file`. It prints the slug and login to set
  under `apps`.

- `train` holds the release train's settings, each a default you can change: `label` (default `train:`), `eject`
  (`bisect`, the default, or `manual`), `after` (the `owner/name` repositories whose train must be published before
  this one departs, default none) and `cutoff` (hours after a train opens when it cuts off by itself; without it,
  `train close` cuts off).

- `review.required` lists the spec tiers whose changes get the AI review (default `small`, `feature`, `big`; a spec
  with no tier counts as `small`). The review is advisory: `land` warns when such a change has no PASS on its head,
  and never refuses for it.

- `approve` shapes the approval workflow (see "When the ruleset requires an approving review"):
  - `ownerOnly`: globs only the owner lands, beside Flow's own list;
  - `checks`: a required context's trusted login, beside the gate App;
  - `workflows`: the workflow names (e.g. `["Quality Gate"]`) whose successful run wakes main's land lane;
  - `requesters`: the App slugs (e.g. `["stackra-bot"]`) whose `fflow:land` label counts as a land request.

- `runner` says where `gate run`'s checks run:
  - `ssh` with `host`, the same as `--box <host>` for one run;
  - `local`, the caller's machine;
  - `command` with `run`, an argument list where `{label}`, `{dir}` and `{command}` are replaced and `{flags}` takes
    the arguments after `gate run --`. Ours is `["stackra", "testbed", "run", "{label}", "{dir}", "{command}", "{flags}"]`.
    A command runner brings its own secrets; `"secrets": true` wraps the poster with the secrets port as `ssh` and
    `local` do.

  - `github-actions`, optionally with `workflow` (default `fflow-gate.yml`), for repositories with no box.
    `fflow init --runner github-actions` writes the workflow, and a starter config when there is none. It runs on
    every push to a PR, in one `check` job with a read-only token and no secret, and posts nothing. Main's approval
    workflow posts `fflow/gate` from it (see "The github-actions runner's verdict"). `gate run` dispatches
    nothing: it follows the PR's run of the workflow and passes through the status the gate App posted.

  Without a runner, `gate run` refuses, naming the key (or pass `--box <ssh host>`).

- `preset` picks the preset `sync` renders and the rules the gate holds a spec to:
  - `neutral` (the default): the commands with only what the gates need (the spec
    location, the plan gate, the issue key, tiers and approval stops). The gate keeps the shared rules: the
    clarifications marker, statuses, tiers, approvals, EARS criteria and the design sections.
  - `stackra`: Stackra's preset, which adds the Impact questionnaire, the Constitution Check, deploy modes,
    correctness properties, task routes and the path floors of the tier check.
  - an npm package name such as `@acme/flow-preset`: a preset package installed in the repository (see
    [Presets](#presets)).
  - a path to the repository's own preset folder, held to the neutral rules (or to `stackra`'s when its
    `preset.yml` declares `id: "stackra"`).

  Without a config file the preset is `neutral`. A repository changes what `sync` renders without forking a preset
  with overrides, owner-only files at `.flow/overrides/<surface>/<id>.yml` (schema: `schema/override.schema.json`):

  ```yaml
  kind: disable # or extend (items, or text with an optional section), configure (values), replace (file)
  target: .agents/agents/ci-steward.md # a rendered output, a preset source (commands/flow-plan.md), or a policy
  reason: we have no CI # replace and disable need reason, owner and review
  owner: figentra-usr
  review: 2027-01-31 # `fflow check` warns 14 days before and fails after
  ```

  The header of a file an override shaped names it. The mandatory policies (`guard.secrets`, `guard.tenancy`,
  `owner-only`, `guard.wiring`) cannot be disabled, replaced or configured; an `extend` of one may only add `items`
  (none starting with `!`), and an `extend` of `owner-only` reaches `land`, the approval workflow and CODEOWNERS.
  `sync` names each override it skips. A replacement that links outside `.flow/overrides/` is refused.
  A whole-file template (`<name>.md`) or command (`commands/flow-<verb>.md`) in `.flow/overrides/` still replaces
  the preset's, and `validate` warns until it gets its `.yml`.

- `profile` picks which of the preset's agents, skills and hooks `sync` renders, from the profiles its `preset.yml`
  declares (`profiles: { <name>: { agents, skills, hooks } }`, `"*"` for all); `.flow/lock.json` records it. Without
  it, the preset's `default` applies. `neutral` has one profile, `default`; `stackra` has `framework` (the default),
  `platform`, `product`, `brand` and `starter`, which all select everything for now. `validate`, `check` and `sync`
  refuse an unknown name, and `check` names a profile changed without a `sync`. A third-party skill from the preset's
  `third-party.yml` is selected by its id in `skills`, and `sync` removes one a profile drops from
  `.agents/skills/.vendor/`. Narrowing a profile does not yet delete the rendered agents and skills it drops: remove
  them by hand until a later release does.

- `specs` sets where specs live: `dir` (default `.agents/specs`) and `bugsDir` (default `.agents/specs/bugs`).

- `harnesses` names the tools `sync --direct` renders the `flow-*` commands for (see Harnesses below). Without it,
  `--direct` renders Claude Code's and OpenCode's files with the text-table questions, as before.

Only
`flow.config.json` is read; no other file stands in for it.

## Harnesses

A command names what a step needs, not the tool that does it: the question step of `flow-clarify` and `flow-specify`
is an `ask` block (`<!-- flow:ask -->` … `<!-- /flow:ask -->`; `todo`, `docs` and `subagent` are reserved the same
way). A harness adapter renders each command where one tool reads it and fills each block in for that tool. Choose the
tools in `flow.config.json` and run `fflow sync --direct`:

```json
{ "version": 1, "harnesses": ["claude-code", "copilot"] }
```

| Harness       | Files                                     | The `ask` step                                                            |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| `claude-code` | `.claude/skills/flow-<verb>/SKILL.md`     | the `AskUserQuestion` tool: 1 to 4 questions, 2 to 4 options, the recommended one first and labelled "(Recommended)", free text always possible |
| `opencode`    | `.opencode/commands/flow-<verb>.md`       | its `question` tool, the same way                                         |
| `copilot`     | `.github/prompts/flow-<verb>.prompt.md`   | the text table                                                            |
| `cursor`      | `.cursor/commands/flow-<verb>.md`         | the text table                                                            |
| `codex`       | `.agents/skills/flow-<verb>/SKILL.md`     | the text table                                                            |

Where a tool's question tool is unavailable, the command still carries the text table to ask with. Every file has the
provenance header and its digest in `.flow/lock.json`, and a tool removed from the list takes its unedited commands
with it. Without `harnesses`, nothing changes: `--direct` renders Claude Code's and OpenCode's files and a plain `sync`
the neutral `.agents/skills/` documents, both with the text table, byte for byte as before. A plain `sync` ignores
`harnesses`: the repository's own projector places those documents. Answers are recorded in the spec, never only in a
tool's chat; the MCP server's `fflow_clarification_record` (under Status) writes them the same way from any tool.

## Presets

A preset is the content `sync` renders and the gate reads: the `flow-*` command texts, templates, agents, rules, guard
tables and surfaces. Flow bundles `neutral`; any other preset is an npm package that the repository installs and
names.

### Using a preset package

```sh
pnpm exec fflow preset add @acme/flow-preset   # install it as a dev dependency and name it in flow.config.json
pnpm exec fflow sync                           # render it; .flow/lock.json records its name, version and digest
```

`preset add` runs `pnpm add -D` (`-w` at a pnpm workspace root), `npm install -D` or `yarn add -D`, chosen by the
lockfile (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`; pnpm when there is none), then writes the config line and
keeps the rest of the file. Installing by hand and writing `"preset": "@acme/flow-preset"` yourself is the same thing.
Nothing runs on install: there is no postinstall, and Flow loads code (the preset's guard tables) only from the
preset the configuration names.

`preset` resolves in this order: a bundled name (`neutral`), then an installed package of that name (resolved from the
repository root, as Node resolves `<pkg>/package.json`), then a folder of the repository at that path. A name that
looks like a package but is neither installed nor a folder is an error naming `fflow preset add <pkg>`.

Upgrading is a package upgrade (`pnpm up @acme/flow-preset`), then `fflow update`: `sync` refuses a preset whose
content differs from the lock until `update` adopts it, and `update` prints the diff first.

### Writing a preset package

The package names its preset folder in `package.json`, and declares the Flow versions it works with:

```json
{
  "name": "@acme/flow-preset",
  "version": "1.0.0",
  "files": ["preset"],
  "flow": { "preset": "./preset" },
  "peerDependencies": { "@figentra-oss/flow": ">=0.3.0 <1" }
}
```

- `flow.preset` is the folder, relative to the package. It must stay inside the package once links are followed.
- If the package has an `exports` map, it must export `./package.json`, or Flow cannot find the package.
- The `peerDependencies` range on `@figentra-oss/flow` says which Flow versions can run the preset. Flow reads
  `*`, exact and partial versions (`1.2`, `1.x`), `^`, `~`, and `>=`, `>`, `<=`, `<` comparators joined by spaces,
  with `||` between alternatives. Hyphen ranges (`1 - 2`) are not read, and Flow never meets them.

The folder has the bundled presets' layout (`assets/flow/presets/neutral` in this package is a complete example).
Every part is optional: a missing file or folder means the preset has none of that kind, except that templates fall
back to Flow's base ones and guard tables to the neutral ones:

```text
preset/
  preset.yml          # id, name, version, profiles; optional requires.flow, approve, queues, parameters
  commands/           # flow-<verb>.md: the command texts sync renders as the flow-* skills
  templates/          # spec-template.md, plan-template.md, tasks-template.md, … (Flow's base templates otherwise)
  agents/             # <id>.md: agent definitions rendered under .agents/agents/ (or .claude/agents/)
  rules/              # <id>.md: agent rules rendered beside them
  skills/<name>/      # the preset's own skills, rendered file for file (a folder may not be named flow-*)
  guard/              # bash-rules.mjs, path-rules.mjs, hints.mjs: the guard engine's tables
  surfaces/           # lefthook.yml, mcp.yaml, agents-md/agents.md: the repository files sync renders from them
  quality-words.yml   # vague words the spec gate flags
  third-party.yml     # third-party skills, each with its source and licence
  reference/, routing.yaml, models.yaml   # agent reference, routing and models, rendered under .agents/
```

The guard files are imported in place, from the installed package, so they may import only Node's built-ins
(`node:*`), other files of their own `guard/` folder (`./inbox.mjs`), and Flow's public entry points, which resolve
through the package's `peerDependencies` on Flow:

- `@figentra-oss/flow/guard`: `collectStrings` (every string in a tool input), `CONFIG_FILE` and `LEGACY_CONFIG_FILE`,
  and the types `BashRule`, `PathRule`, `PromptTable`, `SessionTable` and `Decision` for JSDoc
  (`/** @type {import("@figentra-oss/flow/guard").BashRule[]} */`).
- `@figentra-oss/flow/guard/neutral`: the neutral preset's `PATH_RULES`, `BASH_RULES` and `isSecretPath`, for a preset
  that extends them. The engine checks the neutral path rules after every preset's own table anyway.

Never a relative path into Flow's own files (`../../src/guard/io.mjs`): it does not exist in a package, and Flow's
tests hold the bundled presets to the same rule.

`preset.yml` can also declare the Flow range it needs, so a preset copied into a repository folder keeps the check.
Quote the range, since a YAML value cannot start with `>`:

```yaml
preset:
  id: "acme"
  name: "Acme's workflow"
  version: "1.0.0"
requires:
  flow: ">=0.3.0 <1"
default: default
profiles:
  default:
    agents: ["*"]
    skills: ["*"]
    hooks: ["*"]
```

When the installed Flow is outside either range, `fflow doctor` fails its `preset` row with the fix, and `sync` and
`update` refuse to render. Guard tables are ES modules that Flow imports from the preset folder: import only `node:`
built-ins and files inside the preset, since a relative path into Flow's own files does not reach it from another
package. Flow's neutral secret-file and config rules always apply after a preset's own. Every rendered file that can
carry a comment names the preset and its version (a package's own version) in its provenance header.

## The gate

`fflow gate run` checks the pushed head of the current branch, never anything uncommitted. It clones that commit into
a temporary folder with a small poster beside it and runs `pnpm install --frozen-lockfile && <check>` through the
configured runner, or on `--box <ssh host>`. `<check>` is the configuration's
`gate.check`, else `pnpm verify`, then `fflow gate ci` where Figentra Flow is installed. On the box, the
poster posts the `fflow/gate` commit status and one PR comment as the gate App the configuration names. Its key reaches only
the box, through the secrets port (for us, a dedicated Infisical project only the box identity reads). The poster posts only while that commit is still the branch tip, and never `success` unless the
check exited 0. Nothing secret reaches the comment or the log. Exit codes: 0 green, 1 red, 2 refused, 4 not posted,
5 stale, 73 every box busy, 75 no healthy box.

### The github-actions runner's verdict

With the `github-actions` runner, the PR's own workflow runs the check but cannot post the status: it holds only
a read-only token. When its run completes, GitHub starts `fflow-approve.yml` on `workflow_run`, from the default
branch's copy. Its `verdict` job runs `verdict.mjs` from the integrity-checked Figentra Flow tarball. That script
does the following:

1. It refuses unless the run is this repository's, of the gate workflow's path, for a `pull_request`, complete, and
   from a head in this repository that an open PR still points at.
2. It reads the `check` job's conclusion from the API (never an artifact or a log). A missing job is a failure.
3. If the PR changes `.github/workflows/**`, it posts `pending` ("the gate workflow changed: the owner reviews
   it") until `apps.owner` approves that head, because the PR controls its own copy of the gate workflow.
4. It mints a `statuses: write` Figentra Flow App token over the job's OIDC token (`secrets.oidc`) and posts
   `fflow/gate`.

The job has `id-token: write` and no App secret. It runs in the `fflow-approve` environment, one at a time for each
head. Like every job in that file, it runs only on the default branch and only while the organisation variable
`FIGENTRA_AUTOMATION` is `on` or `merge-only`. Unset or any other value is the freeze. The verdict job is rendered
only when `apps.owner` is set, the runner is `github-actions`, and `secrets` is `infisical` with `oidc` and `paths.gate`. Otherwise
the file is unchanged.

The owner sets it up once:

- Give the Figentra Flow App the `statuses: write` repository permission, and accept it on the installation.
- Create an Infisical OIDC machine identity that can read only `paths.gate`. Set issuer
  `https://token.actions.githubusercontent.com` and the audience in `secrets.oidc.audience`. Write the subject in
  GitHub's id form, `repo:<owner>@<owner id>/<repo>@<repo id>:environment:fflow-approve`. Bind `job_workflow_ref`
  to exactly `<owner>/<repo>/.github/workflows/fflow-approve.yml@refs/heads/<default branch>`, plus
  `ref=refs/heads/<default branch>`. Never bind `fflow-gate.yml`: it runs pull request code and needs no secret.
  Put the identity's id in the Actions variable `FFLOW_OIDC_IDENTITY_ID` (repository or organisation), or in
  `secrets.oidc.identityId`, which wins when both are set.
- Keep the `fflow-approve` environment's deployment branches at the default branch only.
- Set `FIGENTRA_AUTOMATION` to `on`, then run `fflow sync` and land the re-rendered `fflow-approve.yml`. The
  repository secrets `FFLOW_GATE_APP_ID` and `FFLOW_GATE_PRIVATE_KEY` are no longer used.

## Landing

`fflow land` is the lander's checklist as code. The PR must be:

- open, not a draft and not conflicting, and based on the default branch (`--stack` lands a stack bottom-up);
- green on `fflow/gate` on its exact head, posted by the configuration's `apps.gate.login` (or one of its `aliases`);
- titled with a conventional commit header;
- approved as its spec's tier requires (ADR 0502), and at Tasked or later for a feature or big spec.
- free of a blocking finding that Flow's own review (`fflow review --record`) confirmed on its newest reviewed head.
- free of owner-only changes (`src/lib/owner-only.mjs`, matched case-insensitively). Those are:
  - workflows and actions;
  - what a deploy, promote or release runs (`wrangler.*`, `eas.json`, `runway.yaml`, `.changeset/config.json`, the
    root package.json's scripts, and `approve.ownerOnly`);
  - secrets and the secret guards;
  - the catalog, including a dependency moved off `catalog:`;
  - this configuration;
  - repo settings and branch protection;
  - billing or legal files.

  The owner lands those.

The AI review is advisory (ADR 0523 decision 6). The verdict that counts is the reviewer App's unedited
`AI-REVIEW: PASS <head> base=<base>` (or `FAIL <head>`) comment on the exact head, never from the change's own
authors (ADR 0230). When a change in a `review.required` tier has no PASS, because the verdict is missing, stale or
a FAIL, `land` prints a warning and lands it anyway. The rules live in `src/lib/land-rules.mjs`, so the approval job
can run the same ones.

It lists every failing rule. When the base's own `fflow-approve.yml` (read through the contents API, not your
checkout) takes the `fflow:land` label, `land` only asks main's land lane (see "Main's land lane" below):

1. It adds `fflow:land`, or comments `/fflow land` once when the label is already there, since re-adding a label
   fires no event. It never dispatches, turns on auto-merge or merges, and needs only Issues and Pull requests write.
   A required check that failed or came from an untrusted source still refuses here; a running one does not.
2. It waits, reading the PR and the newest `fflow/land` status on the head every 10 seconds, for up to `--wait`
   minutes (default 10). A status counts only from the gate App's login, and only once it is newer than the one the
   head carried before this request. Each new step is printed once.

| Outcome                 | `land`                                                                        |
| ----------------------- | ----------------------------------------------------------------------------- |
| merged                  | runs steps 1 to 5 below; exits 0, or 3 on a warning                           |
| `failure`               | prints the reasons from the lane's comment; exits 1                           |
| `pending`, `owner:`     | the owner reviews it; exits 4                                                 |
| the head moved          | exits 1: a push removes the label, so land again                              |
| the wait ran out        | exits 4: the request stays, and `fflow land <n>` again finishes it            |
| `--no-wait`             | exits 0 right after asking                                                    |

`--dry-run` names the path it would take, and `--stack` waits on each PR before it brings up the next. When the
base's workflow does not take the label, `land` works as before and warns that the dispatch path is deprecated.

Otherwise it squash-merges with GitHub's `sha` guard, so the merge fails if the head moved. A
`Refs:` line, the AI review's verdict (`AI-Review: PASS <head>`, `AI-Review: FAIL <head>` or `AI-Review: none`) and the
co-author trailers go into the squash commit. After the merge it:

1. sets the Linear issue Done;
2. records the merge commit on the branch, so `fflow clean` counts the squashed branch as saved;
3. removes the worktree under `clean`'s rules;
4. deletes the remote branch, only while it still points at the landed head (a branch GitHub already deleted
   counts as deleted);
5. comments on the PR.

### When the ruleset requires an approving review

When the base's ruleset requires an approving review and the head has none, `land` does not merge.

- If a required check is still running, `land` waits and asks for nothing. Run it again once the checks are green.
- If a required check failed, or came from an untrusted source, `land` refuses.
- If every required check is green, `land` dispatches `.github/workflows/fflow-approve.yml`, which `sync`
  installs, with the PR and its head. It then turns on auto-merge (squash) at that head. It never uses an admin
  path.

The workflow runs `approve-check.mjs` from this package, at the version `sync` pinned. It runs in the
`fflow-approve` environment and refuses unless that environment allows only the default branch. It reads
everything at the checked head: the files from the merge base, and each required check from its trusted source. A
trusted source is the App the ruleset pins (`integration_id`), or the login `approve.checks` or the gate App names.
The author must not be the approving App.

The workflow then either approves at that head or comments the reasons. After approving, it re-reads the PR and
dismisses its own review if the head moved. The App's id and key are secrets of that environment, under names of
their own: `FFLOW_APPROVER_APP_ID` and `FFLOW_APPROVER_PRIVATE_KEY`, unless the preset's `approve`
names others.

The approval path needs an owner. Without `apps.owner`, `sync` writes neither the workflow nor CODEOWNERS. With it,
`sync` writes `.github/CODEOWNERS`, which maps every owner-only glob and the root `package.json` to the owner, so
GitHub itself asks the owner for those paths. The check refuses unless the base's ruleset requires the code owner's
review and the base has that file.

GitHub matches CODEOWNERS case-sensitively. A path in another case reaches only `land` and the check, which match
case-insensitively.

The workflow runs only the tarball whose sha512 matches the integrity that the repository's lockfile recorded for
this Flow version when `sync` ran. Without that integrity it refuses to run.

GitHub merges once the approval and every required check are in. After that, `land <n>` on the merged PR runs steps 1
to 5.

With `secrets.oidc`, main's land lane approves and merges instead (next section).


### Main's land lane: approve and merge on events

With `secrets.oidc` (and `paths.gate`), `sync` renders the approval workflow with an event lane, and main's copy
approves and merges. Nothing in it uses a repository secret: each job that writes mints a narrowed Figentra Flow App
token in process (`src/lib/app-token.mjs`) and revokes it when done.

A land request is the `fflow:land` label on a PR into the default branch. It counts only when the label's newest
adder is a User with write or admin, or an App whose slug `approve.requesters` lists. `github-actions` and the Flow
App never count. `HOLD` pauses one PR. A push removes the label (the `cancel` job, with the job's own token, even while
automation is frozen), so each request is for one head. A `/fflow land` comment wakes the lane again without the label
changing, for example after the owner's review.

- `cancel` runs on a push to a labelled PR, with the job's token (`pull-requests: write`).
- `route` runs on the label, ready for review, `fflow/gate`'s success, a `/fflow land` or `AI-REVIEW:` comment, the
  success of a workflow `approve.workflows` names, and every 15 minutes. It holds only a read-only token and says
  whether any PR asks to land.
- `approve` runs when `route` found one and automation is `on`, with an `approve` token (pull requests, statuses).
- `merge` runs after it, while automation is `on` or `merge-only`, with a `merge` token per PR.

Every run sweeps every request, so a lost or replaced event loses nothing. `approve` runs `approve-check.mjs` with
`MODE=event`: every rule above, plus `land`'s server-side rules (`src/lib/land-rules.mjs`: the gate on the head, a
conventional title, the spec's approvals and tier). It approves at most once per head and keeps one comment, whose
first line is `<!-- fflow/land -->` and whose second is `head: <sha> state: <state>`, and the `fflow/land` status on
the head:

| State      | Status    | Meaning                                                                        |
| ---------- | --------- | ------------------------------------------------------------------------------ |
| `approved` | `success` | approved at this head; `merge` merges it                                       |
| `waiting`  | `pending` | a required check or the gate still runs, or the PR is a draft; nothing to do   |
| `owner`    | `pending` | an owner-only change: once the owner approves this head, comment `/fflow land` |
| `refused`  | `failure` | the comment lists each reason; fix them and push, then ask again               |

Both are rewritten only when they change. `fflow/land` is never a required check.

`merge` takes the requests in PR order. It merges a PR only while `mergeable_state` is `clean`, `unstable` or
`has_hooks`, every required check is green from its trusted source, and either the Flow App approved this head and
nothing is owner-only, or `apps.owner` approved this head. It squash-merges with `sha`, the title with `(#n)` and the
`Refs:`, `AI-Review:` and co-author lines (the key from the default branch's configuration), then removes the label.
Only an owner-approved PR that changes `.github/workflows/**` or `.github/actions/**` gets a `workflows: write` token.
Auto-merge is never used.

The organisation variable `FIGENTRA_AUTOMATION` is the freeze switch: `on` runs everything, `merge-only` merges what
was approved but approves nothing new, and `frozen`, unset or any other value runs nothing but `cancel`. Every job
also runs only on the default branch.

The owner sets it up once, as for the verdict (see "The github-actions runner's verdict"): the App's permissions
(contents, pull requests, statuses and workflows write; issues, checks and actions read), the Infisical OIDC identity
bound to `job_workflow_ref` `<owner>/<repo>/.github/workflows/fflow-approve.yml@refs/heads/<default branch>` and
`ref=refs/heads/<default branch>`, `secrets.oidc`, `approve.requesters` and `approve.workflows`, then `fflow sync` and
landing the re-rendered, owner-only workflow. The dispatched `approve-dispatch` job with `FFLOW_APPROVER_*` stays for
one release as the fallback.

### When main is red: the baseline gate

A repository whose main already fails some tasks can require the `Baseline` check instead of its full gate, so routine
PRs can still land (STA-1942). Add `baseline` to the config:

```json
"baseline": {
  "tasks": ["lint", "typecheck", "test", "build"],
  "mustPass": ["*#test:isolation", "*#test:authz"],
  "install": "pnpm install --frozen-lockfile",
  "setup": [{ "name": "Registry auth", "uses": "./.github/actions/registry-auth", "with": { "token": "${{ secrets.STACKRA_REGISTRY_TOKEN }}" } }]
}
```

`sync` then renders `.github/workflows/fflow-baseline.yml`. Its `Baseline` job runs the `setup` steps as
written, the install, and one `turbo run <tasks> --continue --summarize`, then `fflow gate baseline save`:

- on a push to the default branch, it uploads the results as `fflow-baseline-<sha>`;
- on a pull request, `gate baseline check` compares them with the baseline of the base commit, or of its nearest
  ancestor that has one. It fails closed when no baseline exists, and it blocks on any of:
  - a task that passed on main, or a new task, failing;
  - a task main ran that the PR dropped or skipped, even one red on main: a PR cannot pass by deleting tasks;
  - a task matching `mustPass` (tenant isolation, authz, secrets and licence tests) that is not green, even when it
    is red on main;
  - more failed tasks than main has.

  A task that failed or never ran on main and passes now is a gain. A task main never ran because an upstream task
  of its own package failed there, and that now runs and fails, is newly reached: it is listed with the task that
  unblocked it and is neither a new failure nor debt. A task that passed on main and fails now is still a regression.
  The job summary lists all of these, plus tasks still failing; `check --json` prints the same result, or
  `{ ok: false, reason }` when it fails closed.

Only an artifact from a push run on the default branch, at exactly that commit, counts as a baseline. Security checks
(gitleaks, CodeQL, dependency review, the secrets checks) stay required on their own; `Baseline` replaces only the full
gate's requirement, and only while main is red.

`Baseline` is a merge gate, not a release certificate: a release still needs a fully green product matrix.

GitHub calls use only the credentials the configuration names in `credentials`. `wrapper` runs your own command
that gives `gh` a bot's token, and `gh-user` uses your own `gh` login, only because you said so. With neither, `land` refuses: Figentra Flow never falls back to a personal login.

Until a repository's ruleset requires `fflow/gate` (phase 6), `land` refuses there without `--manual-ok`, which only
the tester passes. `land --stack <top>` lands a stack bottom-up. After each squash, the next PR is brought up to date
by merging the default branch and pushing: no rebase, no force push. A conflict in a file whose default-branch
version is the landed parent's own is resolved: the child's side when it built on that version, the default
branch's when the child never changed the file after taking an older version of it (so a later parent commit is
not undone); any other conflict
aborts the merge and stops the stack, naming the file. The PR is retargeted to the default branch if GitHub has not
done it, gated unless its head is already green, and landed. Run it again after a stop and it resumes where it
stopped; `--dry-run` prints the plan.

## Status

`fflow status` shows what is in flight, rebuilt on each call from git, the spec files and GitHub (nothing is
stored). For each repository of the workspace list (or `--repo <path>`, or the current one) it lists the specs by
status with their tier, session and gate problems (a worktree's copy wins for its own key); the worktrees with their
branch, key, dirty state, idle hours, whether a process works in them, and ahead/behind; the open PRs with
`fflow/gate` on the head, the counted AI review and whether they are stacked; and the sessions, each a
spec's `**Session**:` with the worktree carrying its key and that head's gate. More building sessions (a spec at
Tasked or Implementing) than `sessionCap:` in the workspace file (default 2) is a warning, and the exit code is 1.
It prints one table each for specs, worktrees, PRs and sessions; each spec's problems are counted, and `--verbose`
lists them. `--json` writes the snapshot (`fflow.status/1`) as the document's `data`; `--offline` makes no GitHub call. `--web [--port 4747]` serves the same
snapshot as a local page on 127.0.0.1 that refreshes every 30 seconds (read-only; GET only; no external assets).

`fflow status --metrics [--since 30d]` reports, for the PRs merged in the window, per repository and in total:
lead time (opened to merged) and cycle time (first commit to merged) as median and p90 hours, `fflow/gate`
runs per PR and their red share, rework (heads pushed after the first gate), review rounds (`AI-REVIEW: FAIL`
verdicts) and approval latency (a merged spec's Draft line to its last approval), with the age of the open PRs. It
is computed from GitHub and the specs on each call; nothing is stored. `--json` writes the metrics as the document's
`data`.

`fflow mcp` is an MCP server over stdio for agents. It offers eight tools, each returning JSON. Seven read:

| Tool                   | Arguments                    | What it returns                                                                       |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| `fflow_status`         | `repo?`, `offline?`          | what is in flight: specs, worktrees, open PRs with their gate and review, sessions    |
| `fflow_spec`           | `repo`, `key`                | one spec's status, tier, session, approvals and gate problems                         |
| `fflow_trace`          | `repo`, `key`                | the FR, AC and property to task to test matrix                                        |
| `fflow_worktrees`      | `repo?`                      | each repository's worktrees                                                           |
| `fflow_metrics`        | `since?` (days)              | delivery metrics                                                                      |
| `fflow_questions_list` | `repo`, `key`                | each live `[NEEDS CLARIFICATION: …]` marker and unanswered Clarifications question    |
| `fflow_docs_lookup`    | `repo`, `query`, `limit?`    | matching lines of `.agents/specs`, `docs/` and `.flow/` text (at most 100; no links)  |

One writes: `fflow_clarification_record` (`repo`, `key`, `question`, `answer?`, `marker?`) records one answer in the
spec, the record of every question: a `- Q: <question> → A: <answer>` bullet under `## Clarifications` →
`### Session <today>`, and the `[NEEDS CLARIFICATION]` marker whose text is `marker` (else the question) replaced by
the answer. It writes only `.agents/specs/<key>-<slug>/spec.md`, by its real path (a symbolic link is refused).
Without `answer`, it asks the user with an MCP elicitation form, and only when the client declared `elicitation` when
it connected; otherwise the answer must come in the arguments. No tool merges, lands, starts or cleans; each carries
MCP's `readOnlyHint`. Register it in your MCP client as the command `fflow mcp` (for example `pnpm exec fflow mcp` in
a repository's MCP configuration); Figentra Flow never writes that configuration itself.

## Release trains

`fflow train` runs a repository's release train, for repositories where GitHub's merge queue is not
available. A train is a milestone and a label, both named `<label><version>`. Its state (the members in board order,
the ejections, and the PRs waiting for the next train) is one marked line in the milestone's description. Every
subcommand that changes something takes `--dry-run`.

1. `train open [<version>]` opens the next train after a release. The version is the next one from changesets
   unless you give it. Only one train is open at a time.
2. `train add <pr>` boards a PR that is open, based on the default branch, and green on `fflow/gate` from
   the gate App at its exact head. It gets the label and the milestone. After the cut-off, the PR waits for the next
   train.
3. `train close` is the cut-off (or set `train.cutoff`).
4. `train build` creates `train/<version>` from the default branch and merges each member in board order with merge
   commits, never a rebase or a squash. A member that conflicts, or is no longer open and green, is ejected with a
   comment, and the build goes on. Then it runs `gate run --ref train/<version>`. On red, `bisect` gates prefixes
   of the members to find the first one that breaks the train, ejects it with the red gate's report, rebuilds and
   gates again. `manual` stops and reports instead, and `train eject <pr>` ejects by hand. `train/<version>` is a
   scratch branch: a rebuild replaces it by deleting and pushing it, never by a force push.
5. `train depart` checks the gate is green on the tip's exact sha and the move is a fast-forward. It also checks
   that every `train.after` upstream's latest cut-off train has a published GitHub release. Then it moves the
   default branch to the tip (`force: false`), which marks the members merged, closes the milestone and opens the
   next train. Steps after the fast-forward only warn (exit 3).
6. `train status` shows the members and their gates, the ejections, the waiting PRs, the tip and the upstream
   chain.

The release itself stays the changesets Version Packages PR, approved by the owner. A default branch whose ruleset
requires pull requests must let the train's fast-forward through.

## Worktrees

A worktree lives only at `<repo>/.claude/worktrees/<name>` (Stackra ADR 0503), and `.gitignore` ignores that folder.
`fflow start` is the only way one is made; `fflow guard` refuses any other path. `fflow clean` never forces: it
keeps tester trees (`g-*`, `*-gate`, `land-*`, `tpl-core`, `c6-lock*`, `template-wt-lean`), dirty or unsaved trees,
trees whose issue is open, keyless trees used in the last 2 hours, and trees holding ignored files such as `.env` or
`ios/`, each with its reason. A tree is saved when its head is on a remote or every commit has landed by patch.

### The budget

A repository keeps few worktrees (STA-1871). `clean.budget`, 10 by default, is the most linked worktrees it should
hold. Above it, `clean` and `doctor` warn. `doctor` also warns when the disk has less than 10 GB or 10 % free.

Every `clean` lists the budget candidates: trees under `.claude/worktrees/` that have been idle for 24 hours or more
and whose head is merged or pushed. `clean --budget` removes them, after preserving their contents:

- uncommitted work, and a detached HEAD, go to a new local `keep/<repo>-<name>` branch, committed with the hooks
  running. If the hooks refuse, the tree stays as it was.
- ignored files outside the caches go into `~/Backups/fflow/<repo>__<name>-<stamp>.tgz`.

Removal never uses `--force` and never deletes a branch. `clean` also writes `.claude/worktrees/README.md`, and
`sync` installs the worktree rule into the agent rules (`.agents/rules/worktrees.md`, or `.claude/rules/` with
`--direct`).

## The flow

Every spec lives in `.agents/specs/sta-<n>-<slug>/`, named by its Linear issue. Each `flow-*` command first runs
`fflow gate dir`, which reads the key from the branch name and writes `.flow/current.json`; the
`fflow spec` subcommands read it.

States: **Draft → Clarified → Planned → Tasked → Implementing → Done**, or Abandoned / Superseded. A status may lag
behind its artifacts, never run ahead of them.

| Status       | `fflow gate check` requires                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| Draft        | folder `sta-<n>-<slug>`; a `**Linear**` key, when set, equal to the folder's                                    |
| Clarified    | clarifications complete, a real key, every Impact line answered, no `[NEEDS CLARIFICATION`, a history line      |
| Planned      | `plan.md`: Constitution Check rows PASS or N/A with a reason, three deploy-mode rows, every FR validated by a P |
| Tasked       | `tasks.md` passes `fflow gate tasks`: ids, `covers:`, `route:`, acyclic `deps:`, full coverage, safe waves      |
| Implementing | at least one task ticked; `fflow trace drift`: the diff only touches members Impact names                       |
| Done         | every live task ticked; every FR and P covered by a test tagged `@covers sta-<n>:FR-001`; every SC has a method |

Lanes: **full** (a design PR, then one PR per user-story phase), **lite** (a small R0–R1 feature in one PR), **bug**
(`.agents/specs/bugs/sta-<n>-<slug>/` with a regression test tagged `@covers sta-<n>:BUG`) and **chore** (no spec).
`fflow gate lane` fails a `feat` commit that no lite or full spec reaches through the branch key or a `Refs:` key.

Traceability runs FR/SC → P-### (plan properties, `Validates: FR-003`) → T### (`covers:`, `route:`, `deps:`) →
tests (`@covers`) → commits (`Refs: STA-n`) → PR. `fflow trace ci` makes it a gate.

The install check in `fflow gate ci` fails when a rendered `flow-*` file differs from `.flow/lock.json` (a hand
edit), when the lock names another Flow version than the installed one (a forgotten `sync`), or when a spec-kit file
remains (`.specify/`, `.agents/speckit/`, a `speckit-*` skill: run `fflow migrate`).

`.flow/` holds only what the repository owns: `README.md`, `constitution.md`, the optional `overrides/`, `lock.json` and
the git-ignored `current.json`. Templates, presets and command texts come from the installed package.

### Asynchronous questions

An agent that runs unattended cannot wait in a chat for an answer, so it asks on the issue instead (STA-2098):

```sh
fflow spec ask STA-12 --async   # one comment on STA-12 lists each [NEEDS CLARIFICATION: …] as Q1, Q2, …
fflow spec resume STA-12        # records the answers given since, and lists what is still open
```

`ask --async` posts the spec's open questions (its `[NEEDS CLARIFICATION: …]` markers) as one comment through the
tracker adapter (Linear or GitHub Issues) and adds `> Waiting on clarification: <comment link>` under the spec's
`**Clarifications status**`. The status stays as it is, so the gate keeps refusing Clarified while a marker remains.
Someone answers in a new comment on the issue, one line per question: `Q1: <answer>`. `resume` reads the comments after
the asking one (a later answer to the same question wins), replaces each answered marker with its answer, adds
`- Q: <question> → A: <answer>` under `## Clarifications` / `### Session <date>` (the spec is the record), removes the
waiting line once every asked question has an answer, and prints what it recorded and what remains. Setting
`**Clarifications status**: complete` stays with `/flow-clarify`. Without `--async`, `ask` only lists the questions.

## Develop

`pnpm install`, then `pnpm verify` (format, lint, typecheck, test, build). Release notes go in `.changeset/`. See
[AGENTS.md](AGENTS.md).

MIT licence.
