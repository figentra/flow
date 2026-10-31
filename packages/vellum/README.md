# Vellum

Vellum is the spec CLI for Stackra repositories. It runs spec-driven development on
[GitHub spec-kit](https://github.com/github/spec-kit): it installs spec-kit's `.specify/` folder with the Stackra
preset, renders the `speckit-*` skills for Claude Code and OpenCode, and holds the gates that keep each spec, its plan,
its tasks and its tests in step. It is one package, `@stackra/vellum`, with one binary, `vellum`, published only to
the Stackra registry (`npm.stackra.figentra.com`, ADR 0453).

```sh
pnpm add -D @stackra/vellum   # with @stackra:registry=https://npm.stackra.figentra.com/ in .npmrc
pnpm exec vellum init         # .specify/ with the Stackra preset
pnpm exec vellum sync         # install the preset and render the speckit skills (needs the pinned `specify`)
```

## Commands

| Command                                                     | What it does                                                                                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `vellum init [--force]`                                     | installs `.specify/` (spec-kit 1.0.10, the Stackra preset, the gate in `setup-plan.sh`)                                                         |
| `vellum sync`                                               | installs the preset through `specify`, keeps the bundled workflow off, renders OpenCode and Claude                                              |
| `vellum gate run [--ref b] [--box host]`                    | the repository's checks on a testbed box (or `--box`) at the pushed head; the box posts `vellum/gate` as the Stackra Gate App                   |
| `vellum land [<pr>] [--stack] [--dry-run] [--manual-ok]`    | squash-merges a PR that is green on `vellum/gate` from the gate App on its head and has its approvals; Linear Done, worktree and branch removed |
| `vellum gate plan <spec.md>`                                | exits 1 until the spec may be planned (run by `setup-plan.sh`)                                                                                  |
| `vellum gate check <dir>` / `tasks <tasks.md>`              | the stage rules for the spec's `**Status**`; the tasks lint                                                                                     |
| `vellum gate lane` / `branch` / `ci` / `dir`                | the lane check, the branch warning, the CI gate with the spec-kit tripwire, the spec folder                                                     |
| `vellum trace trace <dir>` / `drift` / `ci`                 | the FR/P → task → `@covers` test matrix, spec-vs-diff drift, the Done rules                                                                     |
| `vellum parse <file>`                                       | what the parsers read from a `spec.md`, `plan.md`, `tasks.md` or `routing.yaml`, as JSON                                                        |
| `vellum linear issue <spec.md>` / `tasks <tasks.md>`        | the spec's Linear issue and one sub-issue per task; `--dry-run` needs no token                                                                  |
| `vellum start <STA-n> [--slug s] [--install]`               | branch `figentra/sta-n-<slug>` from `origin/<default>` into `.claude/worktrees/sta-n-<slug>`; issue In Progress                                 |
| `vellum clean [--dry-run] [--adopt] [--fix-ignore] [--all]` | removes finished worktrees (clean, saved, issue Done or idle 2 h), reports what it kept and the space freed                                     |
| `vellum guard [--print-settings]`                           | the PreToolUse hook that denies `git worktree add` outside `.claude/worktrees/`                                                                 |
| `vellum init --workspace <dir>…`                            | writes the workspace list (`~/.config/vellum/workspace.yaml`) that `--all` acts on                                                              |

A repository keeps one-line aliases: `"spec:gate": "vellum gate"`, `"spec:trace": "vellum trace"`,
`"speckit:sync": "vellum sync"`, and `"spec:linear": "infisical run --env=dev --path=/agents --silent -- vellum linear"`.
`vellum linear` reads its token from the environment only (`LINEAR_AGENT_TOKEN`, else `LINEAR_API_KEY`) and never
prints it.

## Configuration

A repository chooses Vellum's adapters in `vellum.config.json` at its root. The file is checked against the shipped
schema (`schema/vellum.config.schema.json`, which editors read through `"$schema"`), and an unknown key or a wrong
type stops every command, named by its path. Nothing defaults to an organisation's choice. A command that needs a
setting you have not made refuses and names it.

```json
{
  "$schema": "./node_modules/@stackra/vellum/schema/vellum.config.schema.json",
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
  `paths` per scope, e.g. `"gate": "/ci/gate"`. Vellum wraps the command and never reads a value.
- `gate.check` is the check command (default `pnpm verify`).

- `artifacts` is the guard `gate run` and `land` apply to a change. `paths` defaults to `.cache/`, `node_modules/`,
  `dist/`, `.turbo/` and `coverage/`, where a trailing `/` matches the folder at any depth and other entries are globs.
  `maxBytes` defaults to 5 MB. A change that adds or changes such a file is refused, with each file named.

The tracker, runner, apps, preset, `clean.keep` and `review.required` keys follow in the next steps of
the same phase. The older `package.json` `"vellum"` keys (`credentials`, `gate`, `gateApp`) are still read, with a
warning, until the next minor version.

## The gate

`vellum gate run` checks the pushed head of the current branch, never anything uncommitted. It clones that commit into
a temporary folder with a small poster beside it and runs `pnpm install --frozen-lockfile && <check>` on a testbed box
(`stackra testbed run`, Stackra ADR 0484), or on `--box <ssh host>` until testbed lands. `<check>` is `package.json`
`"vellum": { "gate": "…" }`, else `pnpm verify`, then `vellum gate ci` where Vellum is installed. On the box, the
poster posts the `vellum/gate` commit status and one PR comment as the "Stackra Gate" GitHub App. Its key lives only in
Infisical `/ci/gate`. The poster posts only while that commit is still the branch tip, and never `success` unless the
check exited 0. Nothing secret reaches the comment or the log. Exit codes: 0 green, 1 red, 2 refused, 4 not posted,
5 stale, 73 every box busy, 75 no healthy box.

## Landing

`vellum land` is the lander's checklist as code. The PR must be:

- open, not a draft and not conflicting, and based on the default branch (`--stack` lands a stack bottom-up);
- green on `vellum/gate` on its exact head, posted by `stackra-gate[bot]` (`"vellum": { "gateApp": "…" }` overrides
  it);
- titled with a conventional commit header;
- approved as its spec's tier requires (ADR 0502), and at Tasked or later for a feature or big spec.
- for a change with a spec: reviewed. The `stackra-reviewer` App's unedited `AI-REVIEW: PASS <head> base=<base>`
  comment, never from the change's own authors, is on its head (ADR 0230). Trivial work, with no spec, is exempt.

It lists every failing rule. Then it squash-merges with GitHub's `sha` guard, so the merge fails if the head moved. A
`Refs:` line and the co-author trailers go into the squash commit. After the merge it:

1. sets the Linear issue Done;
2. records the merge commit on the branch, so `vellum clean` counts the squashed branch as saved;
3. removes the worktree under `clean`'s rules;
4. deletes the remote branch;
5. comments on the PR.

GitHub calls use only the credentials the repository names in `package.json`. `"vellum": { "credentials":
"wrapper:bot:gh" }` runs a script that gives `gh` a bot's token. `"gh-user"` uses your own `gh` login, and only
because you said so. With neither, `land` refuses: Vellum never falls back to a personal login.

Until a repository's ruleset requires `vellum/gate` (phase 6), `land` refuses there without `--manual-ok`, which only
the tester passes. A stack's next PR is brought up to date by merging the default branch and pushing: no rebase, no
force push. The stack is gated again before that PR lands.

## Worktrees

A worktree lives only at `<repo>/.claude/worktrees/<name>` (Stackra ADR 0503), and `.gitignore` ignores that folder.
`vellum start` is the only way one is made; `vellum guard` refuses any other path. `vellum clean` never forces: it
keeps tester trees (`g-*`, `*-gate`, `land-*`, `tpl-core`, `c6-lock*`, `template-wt-lean`), dirty or unsaved trees,
trees whose issue is open, keyless trees used in the last 2 hours, and trees holding ignored files such as `.env` or
`ios/`, each with its reason. A tree is saved when its head is on a remote or every commit has landed by patch.

## The flow

Every spec lives in `.agents/specs/sta-<n>-<slug>/`, named by its Linear issue. spec-kit has no project-wide setting
for the folder, so each wrapped command first runs `vellum gate dir`, which reads the key from the branch name and
writes `.specify/feature.json`.

States: **Draft → Clarified → Planned → Tasked → Implementing → Done**, or Abandoned / Superseded. A status may lag
behind its artifacts, never run ahead of them.

| Status       | `vellum gate check` requires                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| Draft        | folder `sta-<n>-<slug>`; a `**Linear**` key, when set, equal to the folder's                                    |
| Clarified    | clarifications complete, a real key, every Impact line answered, no `[NEEDS CLARIFICATION`, a history line      |
| Planned      | `plan.md`: Constitution Check rows PASS or N/A with a reason, three deploy-mode rows, every FR validated by a P |
| Tasked       | `tasks.md` passes `vellum gate tasks`: ids, `covers:`, `route:`, acyclic `deps:`, full coverage, safe waves     |
| Implementing | at least one task ticked; `vellum trace drift`: the diff only touches members Impact names                      |
| Done         | every live task ticked; every FR and P covered by a test tagged `@covers sta-<n>:FR-001`; every SC has a method |

Lanes: **full** (a design PR, then one PR per user-story phase), **lite** (a small R0–R1 feature in one PR), **bug**
(`.specify/bugs/sta-<n>-<slug>/` with a regression test tagged `@covers sta-<n>:BUG`) and **chore** (no spec).
`vellum gate lane` fails a `feat` commit that no lite or full spec reaches through the branch key or a `Refs:` key.

Traceability runs FR/SC → P-### (plan properties, `Validates: FR-003`) → T### (`covers:`, `route:`, `deps:`) →
tests (`@covers`) → commits (`Refs: STA-n`) → PR. `vellum trace ci` makes it a gate.

The tripwire in `vellum gate ci` catches a spec-kit upgrade that breaks the Stackra wrap: the gate call in
`setup-plan.sh`, `common.sh` resolving `SPECIFY_FEATURE_DIRECTORY`, `linear-key` numbering, the wrap markers in every
rendered command, the installed preset equal to its source, and the bundled `speckit` workflow kept disabled.

`.specify/` keeps its name because spec-kit's `specify` CLI and the skills expect it. A later `vellum migrate` moves it
to `.vellum/` once Vellum replaces spec-kit rather than wrapping it.

## Develop

`pnpm install`, then `pnpm verify` (format, lint, typecheck, test, build). Release notes go in `.changeset/`. See
[AGENTS.md](AGENTS.md).

MIT licence.
