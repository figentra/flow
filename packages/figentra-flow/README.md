# Figentra Flow

Figentra Flow is the spec CLI for Stackra repositories. It runs spec-driven development on
[GitHub spec-kit](https://github.com/github/spec-kit): it installs spec-kit's `.specify/` folder with the Stackra
preset, renders the `speckit-*` skills for Claude Code and OpenCode, and holds the gates that keep each spec, its plan,
its tasks and its tests in step. It is one package, `figentra-flow`, with two binaries, `figentra-flow` and its alias `fflow`, published publicly on npmjs.

```sh
pnpm add -D figentra-flow
pnpm exec figentra-flow init         # .specify/ with the Stackra preset
pnpm exec figentra-flow sync         # install the preset and render the speckit skills (needs the pinned `specify`)
```

## Commands

| Command                                                            | What it does                                                                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `figentra-flow init [--force]`                                     | installs `.specify/` (spec-kit 1.0.10, the Stackra preset, the gate in `setup-plan.sh`)                                                                |
| `figentra-flow sync`                                               | installs the preset through `specify`, keeps the bundled workflow off, renders OpenCode and Claude                                                     |
| `figentra-flow gate run [--ref b] [--box host] [-- flags]`         | the repository's checks through the configured runner (or on `--box`) at the pushed head; the box posts `figentra-flow/gate` as the gate App           |
| `figentra-flow land [<pr>] [--stack] [--dry-run] [--manual-ok]`    | squash-merges a PR that is green on `figentra-flow/gate` from the gate App on its head and has its approvals; Linear Done, worktree and branch removed |
| `figentra-flow gate plan <spec.md>`                                | exits 1 until the spec may be planned (run by `setup-plan.sh`)                                                                                         |
| `figentra-flow gate check <dir>` / `tasks <tasks.md>`              | the stage rules for the spec's `**Status**`; the tasks lint                                                                                            |
| `figentra-flow gate lane` / `branch` / `ci` / `dir`                | the lane check, the branch warning, the CI gate with the spec-kit tripwire, the spec folder                                                            |
| `figentra-flow trace trace <dir>` / `drift` / `ci`                 | the FR/P → task → `@covers` test matrix, spec-vs-diff drift, the Done rules                                                                            |
| `figentra-flow parse <file>`                                       | what the parsers read from a `spec.md`, `plan.md`, `tasks.md` or `routing.yaml`, as JSON                                                               |
| `figentra-flow linear issue <spec.md>` / `tasks <tasks.md>`        | the spec's Linear issue and one sub-issue per task; `--dry-run` needs no token                                                                         |
| `figentra-flow start <STA-n> [--slug s] [--install]`               | branch `figentra/sta-n-<slug>` from `origin/<default>` into `.claude/worktrees/sta-n-<slug>`; issue In Progress                                        |
| `figentra-flow clean [--dry-run] [--adopt] [--fix-ignore] [--all]` | removes finished worktrees (clean, saved, issue Done or idle 2 h), reports what it kept and the space freed                                            |
| `figentra-flow guard [--print-settings]`                           | the PreToolUse hook that denies `git worktree add` outside `.claude/worktrees/`                                                                        |
| `figentra-flow init --workspace <dir>…`                            | writes the workspace list (`~/.config/figentra-flow/workspace.yaml`) that `--all` acts on                                                              |

A repository keeps one-line aliases: `"spec:gate": "figentra-flow gate"`, `"spec:trace": "figentra-flow trace"`,
`"speckit:sync": "figentra-flow sync"`, and `"spec:linear": "infisical run --env=dev --path=/agents --silent -- figentra-flow linear"`.
`figentra-flow linear` reads its token from the environment only (`LINEAR_AGENT_TOKEN`, else `LINEAR_API_KEY`) and never
prints it.

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
  tracker. A tracker failure is a warning, never silent and never an exit code. Without a config file, the Linear
  `STA` scheme used before is kept, with a warning, until the next minor version.

- `clean.keep` lists worktree names `clean` never removes or adopts. These are globs such as `*-gate`.
- `artifacts` is the guard `gate run` and `land` apply to a change. `paths` defaults to `.cache/`, `node_modules/`,
  `dist/`, `.turbo/` and `coverage/`, where a trailing `/` matches the folder at any depth and other entries are globs.
  `maxBytes` defaults to 5 MB. A change that adds or changes such a file is refused, with each file named.

- `apps` names the GitHub Apps Flow trusts:
  - `gate.login`: the gate App whose status `land` trusts;
  - `review.slug`: the review App whose verdict counts;
  - `owner`: the owner whose `owner-approval` review also counts.

  There are no defaults. Without a gate App `land` refuses, and without a review App no verdict counts.

- `runner` says where `gate run`'s checks run:
  - `ssh` with `host`, the same as `--box <host>` for one run;
  - `local`, the caller's machine;
  - `command` with `run`, an argument list where `{label}`, `{dir}` and `{command}` are replaced and `{flags}` takes
    the arguments after `gate run --`. Ours is `["stackra", "testbed", "run", "{label}", "{dir}", "{command}", "{flags}"]`.
    A command runner brings its own secrets; `"secrets": true` wraps the poster with the secrets port as `ssh` and
    `local` do.

  `github-actions` follows. With a config file but no runner, `gate run` refuses; without a config file, the testbed
  command is kept, with a warning, until the next minor version.

- `preset` picks the spec-kit preset `sync` installs and the rules the gate holds a spec to:
  - `neutral` (the default with a config file): spec-kit's commands with only what the gates need (the spec
    location, the plan gate, the issue key, tiers and approval stops). The gate keeps the shared rules: the
    clarifications marker, statuses, tiers, approvals, EARS criteria and the design sections.
  - `stackra`: Stackra's preset, which adds the Impact questionnaire, the Constitution Check, deploy modes,
    correctness properties, task routes and the path floors of the tier check.
  - a path to the repository's own preset folder, held to the neutral rules.

  `neutral` and a path need `specify` on PATH to render; without a config file, `stackra` (or the repository's
  `.agents/speckit/presets/`) is kept until the next minor version.

The `review.required` key follows in the next step of the same phase. Only
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

It lists every failing rule. Then it squash-merges with GitHub's `sha` guard, so the merge fails if the head moved. A
`Refs:` line and the co-author trailers go into the squash commit. After the merge it:

1. sets the Linear issue Done;
2. records the merge commit on the branch, so `figentra-flow clean` counts the squashed branch as saved;
3. removes the worktree under `clean`'s rules;
4. deletes the remote branch;
5. comments on the PR.

GitHub calls use only the credentials the configuration names in `credentials`. `wrapper` runs your own command
that gives `gh` a bot's token, and `gh-user` uses your own `gh` login, only because you said so. With neither, `land` refuses: Figentra Flow never falls back to a personal login.

Until a repository's ruleset requires `figentra-flow/gate` (phase 6), `land` refuses there without `--manual-ok`, which only
the tester passes. A stack's next PR is brought up to date by merging the default branch and pushing: no rebase, no
force push. The stack is gated again before that PR lands.

## Worktrees

A worktree lives only at `<repo>/.claude/worktrees/<name>` (Stackra ADR 0503), and `.gitignore` ignores that folder.
`figentra-flow start` is the only way one is made; `figentra-flow guard` refuses any other path. `figentra-flow clean` never forces: it
keeps tester trees (`g-*`, `*-gate`, `land-*`, `tpl-core`, `c6-lock*`, `template-wt-lean`), dirty or unsaved trees,
trees whose issue is open, keyless trees used in the last 2 hours, and trees holding ignored files such as `.env` or
`ios/`, each with its reason. A tree is saved when its head is on a remote or every commit has landed by patch.

## The flow

Every spec lives in `.agents/specs/sta-<n>-<slug>/`, named by its Linear issue. spec-kit has no project-wide setting
for the folder, so each wrapped command first runs `figentra-flow gate dir`, which reads the key from the branch name and
writes `.specify/feature.json`.

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
(`.specify/bugs/sta-<n>-<slug>/` with a regression test tagged `@covers sta-<n>:BUG`) and **chore** (no spec).
`figentra-flow gate lane` fails a `feat` commit that no lite or full spec reaches through the branch key or a `Refs:` key.

Traceability runs FR/SC → P-### (plan properties, `Validates: FR-003`) → T### (`covers:`, `route:`, `deps:`) →
tests (`@covers`) → commits (`Refs: STA-n`) → PR. `figentra-flow trace ci` makes it a gate.

The tripwire in `figentra-flow gate ci` catches a spec-kit upgrade that breaks the Stackra wrap: the gate call in
`setup-plan.sh`, `common.sh` resolving `SPECIFY_FEATURE_DIRECTORY`, `linear-key` numbering, the wrap markers in every
rendered command, the installed preset equal to its source, and the bundled `speckit` workflow kept disabled.

`.specify/` keeps its name because spec-kit's `specify` CLI and the skills expect it. A later `figentra-flow migrate` moves it
to `.figentra-flow/` once Figentra Flow replaces spec-kit rather than wrapping it.

## Develop

`pnpm install`, then `pnpm verify` (format, lint, typecheck, test, build). Release notes go in `.changeset/`. See
[AGENTS.md](AGENTS.md).

MIT licence.
