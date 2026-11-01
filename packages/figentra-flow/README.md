# Figentra Flow

Figentra Flow is the spec CLI for Stackra repositories. It owns spec-driven development end to end (ADR 0510): the
templates, the presets, the eight `flow-*` commands it renders for Claude Code and OpenCode, the `.flow/` folder, and
the gates that keep each spec, its plan, its tasks and its tests in step. Its command texts and two templates derive
from [GitHub spec-kit](https://github.com/github/spec-kit) 1.0.10 (MIT; see `THIRD_PARTY_NOTICES.md`); nothing runs
spec-kit's `specify`. It is one package, `figentra-flow`, with two binaries, `figentra-flow` and its alias `fflow`, published on the Figentra registry (npmjs later, as `figentra-flow`).

```sh
pnpm add -D @figentra-oss/flow             # from the Figentra registry: @figentra-oss:registry in .npmrc
pnpm exec figentra-flow init         # .flow/ and the flow-* skills, with the configured preset
pnpm exec figentra-flow sync         # re-render the flow-* skills after a preset or Flow upgrade
```

## Commands

| Command                                                                       | What it does                                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `figentra-flow init [--force]`                                                | writes `.flow/` (README, a starter constitution, `.gitignore`) and renders the `flow-*` skills                                                                                                   |
| `figentra-flow migrate [--dry-run]`                                           | moves a spec-kit repository onto `.flow/` (constitution, `.specify/` and `.agents/speckit/` deleted, scripts, pins and skips), then syncs                                                        |
| `figentra-flow spec paths\|setup-plan\|setup-tasks\|template`                 | the spec folder, its documents and the resolved templates as JSON, for the `flow-*` commands                                                                                                     |
| `figentra-flow sync [--direct]`                                               | renders the `flow-*` skills (for the repository's projector, or Claude Code and OpenCode directly) and writes `.flow/lock.json`                                                                  |
| `figentra-flow gate run [--ref b] [--box host] [-- flags]`                    | the repository's checks through the configured runner (or on `--box`) at the pushed head; the box posts `figentra-flow/gate` as the gate App                                                     |
| `figentra-flow land [<pr>] [--stack] [--dry-run] [--manual-ok]`               | squash-merges a PR that is green on `figentra-flow/gate` from the gate App on its head and has its approvals; Linear Done, worktree and branch removed                                           |
| `figentra-flow train <open\|add\|close\|build\|eject\|depart\|status>`        | the release train: board green PRs, cut off, build `train/<version>` by merge commits with bisect ejection, depart by fast-forward (see [Release trains](#release-trains))                       |
| `figentra-flow ship <dev\|staging> [--workflow f] [--dry-run]`                | dispatches the product's Runway deploy workflow (`deploy.yml`, input `environment`) on main; production is refused: the owner promotes                                                           |
| `figentra-flow release [--json] [--offline]`                                  | what the next release would publish: pending changesets and next versions, the version PR, the Release workflow's last run and its notices, the registry's versions; it publishes nothing        |
| `figentra-flow doctor [--json] [--offline]`                                   | checks Node, git, the configuration, the `.flow/` install, the ignored worktree folder, the roster and the credentials, each with its fix                                                        |
| `figentra-flow gate plan <spec.md>`                                           | exits 1 until the spec may be planned (run by `figentra-flow spec setup-plan`)                                                                                                                   |
| `figentra-flow gate check <dir>` / `tasks <tasks.md>`                         | the stage rules for the spec's `**Status**`; the tasks lint                                                                                                                                      |
| `figentra-flow gate lane` / `branch` / `ci` / `dir`                           | the lane check, the branch warning, the CI gate with the install check, the spec folder                                                                                                          |
| `figentra-flow trace trace <dir>` / `drift` / `ci`                            | the FR/P → task → `@covers` test matrix, spec-vs-diff drift, the Done rules                                                                                                                      |
| `figentra-flow parse <file>`                                                  | what the parsers read from a `spec.md`, `plan.md`, `tasks.md` or `routing.yaml`, as JSON                                                                                                         |
| `figentra-flow linear issue <spec.md>` / `tasks <tasks.md>`                   | the spec's Linear issue and one sub-issue per task; `--dry-run` needs no token                                                                                                                   |
| `figentra-flow start <STA-n> [--slug s] [--install]`                          | branch `figentra/sta-n-<slug>` from `origin/<default>` into `.claude/worktrees/sta-n-<slug>`; issue In Progress                                                                                  |
| `figentra-flow clean [--dry-run] [--adopt] [--fix-ignore] [--budget] [--all]` | removes finished worktrees (clean, saved, issue Done or idle 2 h), reports what it kept and the space freed; warns over `clean.budget`, and `--budget` sweeps idle merged or pushed trees safely |
| `figentra-flow guard [--print-settings]`                                      | the PreToolUse hook that denies `git worktree add` outside `.claude/worktrees/`                                                                                                                  |
| `figentra-flow init --workspace <dir>…`                                       | writes the workspace list (`~/.config/figentra-flow/workspace.yaml`) that `--all` acts on                                                                                                        |
| `figentra-flow status [--repo p] [--json] [--offline]`                        | specs by status, worktrees, open PRs with their gate and review, and sessions, for every repository of the workspace                                                                             |
| `figentra-flow mcp`                                                           | a read-only MCP server over stdio: status, spec, trace, worktrees and metrics                                                                                                                    |
| `figentra-flow init --runner github-actions [--force]`                        | writes the gate workflow for the `github-actions` runner, and a starter config when there is none                                                                                                |
| `figentra-flow readme [--check]`                                              | renders `README.md` from `.flow/readme.yml` through the preset's `readme-template` (stackra); `--check` exits 1 when it differs                                                                  |

A repository keeps one-line aliases: `"spec:gate": "figentra-flow gate"`, `"spec:trace": "figentra-flow trace"`,
`"spec:sync": "figentra-flow sync"`, and `"spec:linear": "infisical run --env=dev --path=/agents --silent -- figentra-flow linear"`.
`figentra-flow linear` reads its token from the environment only (`LINEAR_AGENT_TOKEN`, else `LINEAR_API_KEY`) and never
prints it.

## The README

With the `stackra` preset, a repository's `README.md` is rendered from its data file `.flow/readme.yml`, so every
Figentra repository has the same layout and its own content. The sections are: banner, badges, tagline, What it is,
Status, Quick start, Architecture at a glance, Development, Docs and playground, Release and changelog, Security,
Licence, and the footer. `figentra-flow readme` writes it, `readme --check` fails when it was edited by hand, and
`sync` renders it too and records it in `.flow/lock.json`. A repository can override the layout with
`.flow/overrides/readme-template.md`.

```yaml
name: Figentra Pay # required: the product's name
repo: figentra/pay # required: owner/name, for the badges and links
tagline: Payments, wallet and payouts for every Figentra product. # required: one line, same as the GitHub description
status: In progress # required: Live | In progress | Planned
statusNote: dev pilot (pay#18) # optional: after the status, 80 characters at most
banner: # optional: the brand kit's images, committed in the repository
  light: .github/assets/brand/banner-light.png
  dark: .github/assets/brand/banner-dark.png
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

A repository chooses Figentra Flow's adapters in `figentra-flow.config.json` at its root. The file is checked against the shipped
schema (`schema/figentra-flow.config.schema.json`, which editors read through `"$schema"`), and an unknown key or a wrong
type stops every command, named by its path. Nothing defaults to an organisation's choice. A command that needs a
setting you have not made refuses and names it.

```json
{
  "$schema": "./node_modules/figentra-flow/schema/figentra-flow.config.schema.json",
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
  in a subshell for that one command and seen only by the login. There is no default for either. Figentra Flow wraps the command and never reads a
  value.
- `gate.check` is the check command (default `pnpm verify`).

- `tracker` names the issue tracker:
  - `linear` with `team` and `branchPrefix`, and optionally `token`, the names of the environment variables holding
    the token;
  - `github-issues` with `branchPrefix`, which uses keys `gh-<n>` for the repository's own issue `#<n>`.

  Issue keys are `<prefix>-<n>`. `figentra-flow start <key>` makes branch `<branchPrefix>/<key>-<slug>` and worktree
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
  - `gate.login`: the gate App whose status `land` trusts;
  - `review.slug`: the review App whose verdict counts;
  - `owner`: the owner whose `owner-approval` review also counts.

  There are no defaults. Without a gate App `land` refuses, and without a review App no verdict counts.

  `figentra-flow app create gate|review [--org <login>] [--name <name>] [--key-file <path>]` creates either App by
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

- `review.required` lists the spec tiers whose changes need the AI review before `land` (default `small`,
  `feature`, `big`; a spec with no tier counts as `small`).

- `runner` says where `gate run`'s checks run:
  - `ssh` with `host`, the same as `--box <host>` for one run;
  - `local`, the caller's machine;
  - `command` with `run`, an argument list where `{label}`, `{dir}` and `{command}` are replaced and `{flags}` takes
    the arguments after `gate run --`. Ours is `["stackra", "testbed", "run", "{label}", "{dir}", "{command}", "{flags}"]`.
    A command runner brings its own secrets; `"secrets": true` wraps the poster with the secrets port as `ssh` and
    `local` do.

  - `github-actions`, optionally with `workflow` (default `figentra-flow-gate.yml`), for repositories with no box.
    `figentra-flow init --runner github-actions` writes the workflow, and a starter config when there is none. Set
    the repository secrets `FIGENTRA_FLOW_GATE_APP_ID` and `FIGENTRA_FLOW_GATE_PRIVATE_KEY`. `gate run` dispatches it
    on the default branch, follows the run and passes its result through. The change's code runs in a `check` job
    with no secret; a separate `post` job, which never checks out the repository, posts the status.

  Without a runner, `gate run` refuses, naming the key (or pass `--box <ssh host>`).

- `preset` picks the preset `sync` renders and the rules the gate holds a spec to:
  - `neutral` (the default): the commands with only what the gates need (the spec
    location, the plan gate, the issue key, tiers and approval stops). The gate keeps the shared rules: the
    clarifications marker, statuses, tiers, approvals, EARS criteria and the design sections.
  - `stackra`: Stackra's preset, which adds the Impact questionnaire, the Constitution Check, deploy modes,
    correctness properties, task routes and the path floors of the tier check.
  - a path to the repository's own preset folder, held to the neutral rules.

  Without a config file the preset is `neutral`. A repository changes one template or command without forking a
  preset in `.flow/overrides/` (`<name>.md`, or `commands/flow-<verb>.md`).

- `specs` sets where specs live: `dir` (default `.agents/specs`) and `bugsDir` (default `.agents/specs/bugs`).

Only
`figentra-flow.config.json` is read; no other file stands in for it.

## The gate

`figentra-flow gate run` checks the pushed head of the current branch, never anything uncommitted. It clones that commit into
a temporary folder with a small poster beside it and runs `pnpm install --frozen-lockfile && <check>` through the
configured runner, or on `--box <ssh host>`. `<check>` is the configuration's
`gate.check`, else `pnpm verify`, then `figentra-flow gate ci` where Figentra Flow is installed. On the box, the
poster posts the `figentra-flow/gate` commit status and one PR comment as the gate App the configuration names. Its key reaches only
the box, through the secrets port (for us, a dedicated Infisical project only the box identity reads). The poster posts only while that commit is still the branch tip, and never `success` unless the
check exited 0. Nothing secret reaches the comment or the log. Exit codes: 0 green, 1 red, 2 refused, 4 not posted,
5 stale, 73 every box busy, 75 no healthy box.

## Landing

`figentra-flow land` is the lander's checklist as code. The PR must be:

- open, not a draft and not conflicting, and based on the default branch (`--stack` lands a stack bottom-up);
- green on `figentra-flow/gate` on its exact head, posted by the configuration's `apps.gate.login`;
- titled with a conventional commit header;
- approved as its spec's tier requires (ADR 0502), and at Tasked or later for a feature or big spec.
- for a change with a spec: reviewed. The `stackra-reviewer` App's unedited `AI-REVIEW: PASS <head> base=<base>`
  comment, never from the change's own authors, is on its head (ADR 0230). Trivial work, with no spec, is exempt.
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

It lists every failing rule. Then it squash-merges with GitHub's `sha` guard, so the merge fails if the head moved. A
`Refs:` line and the co-author trailers go into the squash commit. After the merge it:

1. sets the Linear issue Done;
2. records the merge commit on the branch, so `figentra-flow clean` counts the squashed branch as saved;
3. removes the worktree under `clean`'s rules;
4. deletes the remote branch, only while it still points at the landed head;
5. comments on the PR.

### When the ruleset requires an approving review

When the base's ruleset requires an approving review and the head has none, `land` does not merge.

- If a required check is still running, `land` waits and asks for nothing. Run it again once the checks are green.
- If a required check failed, or came from an untrusted source, `land` refuses.
- If every required check is green, `land` dispatches `.github/workflows/figentra-flow-approve.yml`, which `sync`
  installs, with the PR and its head. It then turns on auto-merge (squash) at that head. It never uses an admin
  path.

The workflow runs `approve-check.mjs` from this package, at the version `sync` pinned. It runs in the
`figentra-flow-approve` environment and refuses unless that environment allows only the default branch. It reads
everything at the checked head: the files from the merge base, and each required check from its trusted source. A
trusted source is the App the ruleset pins (`integration_id`), or the login `approve.checks` or the gate App names.
The author must not be the approving App.

The workflow then either approves at that head or comments the reasons. After approving, it re-reads the PR and
dismisses its own review if the head moved. The App's id and key are secrets of that environment, under names of
their own: `FIGENTRA_FLOW_APPROVER_APP_ID` and `FIGENTRA_FLOW_APPROVER_PRIVATE_KEY`, unless the preset's `approve`
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

GitHub calls use only the credentials the configuration names in `credentials`. `wrapper` runs your own command
that gives `gh` a bot's token, and `gh-user` uses your own `gh` login, only because you said so. With neither, `land` refuses: Figentra Flow never falls back to a personal login.

Until a repository's ruleset requires `figentra-flow/gate` (phase 6), `land` refuses there without `--manual-ok`, which only
the tester passes. A stack's next PR is brought up to date by merging the default branch and pushing: no rebase, no
force push. The stack is gated again before that PR lands.

## Status

`figentra-flow status` shows what is in flight, rebuilt on each call from git, the spec files and GitHub (nothing is
stored). For each repository of the workspace list (or `--repo <path>`, or the current one) it lists the specs by
status with their tier, session and gate problems (a worktree's copy wins for its own key); the worktrees with their
branch, key, dirty state, idle hours, whether a process works in them, and ahead/behind; the open PRs with
`figentra-flow/gate` on the head, the counted AI review and whether they are stacked; and the sessions, each a
spec's `**Session**:` with the worktree carrying its key and that head's gate. More building sessions (a spec at
Tasked or Implementing) than `sessionCap:` in the workspace file (default 2) is a warning, and the exit code is 1.
`--json` prints the snapshot (`figentra-flow.status/1`); `--offline` makes no GitHub call. `--web [--port 4747]` serves the same
snapshot as a local page on 127.0.0.1 that refreshes every 30 seconds (read-only; GET only; no external assets).

`figentra-flow status --metrics [--since 30d]` reports, for the PRs merged in the window, per repository and in total:
lead time (opened to merged) and cycle time (first commit to merged) as median and p90 hours, `figentra-flow/gate`
runs per PR and their red share, rework (heads pushed after the first gate), review rounds (`AI-REVIEW: FAIL`
verdicts) and approval latency (a merged spec's Draft line to its last approval), with the age of the open PRs. It
is computed from GitHub and the specs on each call; nothing is stored.

`figentra-flow mcp` is a read-only MCP server over stdio for agents. It offers five tools, each returning JSON:
`figentra_flow_status` (`repo?`, `offline?`), `figentra_flow_spec` (`repo`, `key`: status, tier, session, approvals
and gate problems), `figentra_flow_trace` (`repo`, `key`: the FR, AC and property to task to test matrix),
`figentra_flow_worktrees` (`repo?`) and `figentra_flow_metrics` (`since?` days). None writes, merges, lands, starts
or cleans. Register it in your MCP client as the command `figentra-flow mcp` (for example `pnpm exec figentra-flow
mcp` in a repository's MCP configuration); Figentra Flow never writes that configuration itself.

## Release trains

`figentra-flow train` runs a repository's release train, for repositories where GitHub's merge queue is not
available. A train is a milestone and a label, both named `<label><version>`. Its state (the members in board order,
the ejections, and the PRs waiting for the next train) is one marked line in the milestone's description. Every
subcommand that changes something takes `--dry-run`.

1. `train open [<version>]` opens the next train after a release. The version is the next one from changesets
   unless you give it. Only one train is open at a time.
2. `train add <pr>` boards a PR that is open, based on the default branch, and green on `figentra-flow/gate` from
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
`figentra-flow start` is the only way one is made; `figentra-flow guard` refuses any other path. `figentra-flow clean` never forces: it
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
- ignored files outside the caches go into `~/Backups/figentra-flow/<repo>__<name>-<stamp>.tgz`.

Removal never uses `--force` and never deletes a branch. `clean` also writes `.claude/worktrees/README.md`, and
`sync` installs the worktree rule into the agent rules (`.agents/rules/worktrees.md`, or `.claude/rules/` with
`--direct`).

## The flow

Every spec lives in `.agents/specs/sta-<n>-<slug>/`, named by its Linear issue. Each `flow-*` command first runs
`figentra-flow gate dir`, which reads the key from the branch name and writes `.flow/current.json`; the
`figentra-flow spec` subcommands read it.

States: **Draft → Clarified → Planned → Tasked → Implementing → Done**, or Abandoned / Superseded. A status may lag
behind its artifacts, never run ahead of them.

| Status       | `figentra-flow gate check` requires                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| Draft        | folder `sta-<n>-<slug>`; a `**Linear**` key, when set, equal to the folder's                                       |
| Clarified    | clarifications complete, a real key, every Impact line answered, no `[NEEDS CLARIFICATION`, a history line         |
| Planned      | `plan.md`: Constitution Check rows PASS or N/A with a reason, three deploy-mode rows, every FR validated by a P    |
| Tasked       | `tasks.md` passes `figentra-flow gate tasks`: ids, `covers:`, `route:`, acyclic `deps:`, full coverage, safe waves |
| Implementing | at least one task ticked; `figentra-flow trace drift`: the diff only touches members Impact names                  |
| Done         | every live task ticked; every FR and P covered by a test tagged `@covers sta-<n>:FR-001`; every SC has a method    |

Lanes: **full** (a design PR, then one PR per user-story phase), **lite** (a small R0–R1 feature in one PR), **bug**
(`.agents/specs/bugs/sta-<n>-<slug>/` with a regression test tagged `@covers sta-<n>:BUG`) and **chore** (no spec).
`figentra-flow gate lane` fails a `feat` commit that no lite or full spec reaches through the branch key or a `Refs:` key.

Traceability runs FR/SC → P-### (plan properties, `Validates: FR-003`) → T### (`covers:`, `route:`, `deps:`) →
tests (`@covers`) → commits (`Refs: STA-n`) → PR. `figentra-flow trace ci` makes it a gate.

The install check in `figentra-flow gate ci` fails when a rendered `flow-*` file differs from `.flow/lock.json` (a hand
edit), when the lock names another Flow version than the installed one (a forgotten `sync`), or when a spec-kit file
remains (`.specify/`, `.agents/speckit/`, a `speckit-*` skill: run `figentra-flow migrate`).

`.flow/` holds only what the repository owns: `README.md`, `constitution.md`, the optional `overrides/`, `lock.json` and
the git-ignored `current.json`. Templates, presets and command texts come from the installed package.

## Develop

`pnpm install`, then `pnpm verify` (format, lint, typecheck, test, build). Release notes go in `.changeset/`. See
[AGENTS.md](AGENTS.md).

MIT licence.
