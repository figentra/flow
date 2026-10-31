# Implementation Plan: Vellum runs the whole development workflow

**Spec**: `.agents/specs/sta-1729-vellum-workflow/spec.md` · **Linear**: STA-1729 · **Date**: 2026-10-31

**Input**: the spec, approved at its stop by the leader on 2026-10-31. This plan is the design of **phase 1** (the
worktree rule); each later phase adds its own design section here and stops for approval before its tasks.

## Summary

Phase 1 makes `<repo>/.claude/worktrees/<name>` the only place a worktree lives: `vellum start` creates it (branch and
Linear), `vellum clean` removes the finished ones, adopts the stray ones and fixes `.gitignore`, and `vellum guard` is
the hook check that refuses `git worktree add` anywhere else. Then the six repositories without the ignore line get it.

## Technical Context

- **Language**: plain ESM JavaScript with JSDoc, checked by `tsc` (`checkJs`); Node 24; no runtime dependencies
- **Members**: figentra/vellum `packages/vellum` (`@stackra/vellum`, binary `vellum`)
- **Testing**: `node:test` in `src/__tests__/`, against temporary git repositories with a local bare remote; no
  network, no real Linear call (the client is injected)
- **Storage**: none (git and `~/.config/vellum/workspace.yaml`)
- **Runtime target**: the `vellum` CLI, run in the repository it acts on

## Architecture overview

Three new commands on the existing dispatcher (`bin/vellum.mjs`): `start`, `clean` and `guard`. They share two small
libraries: `lib/git.mjs` (run git, parse `git worktree list --porcelain`, find the repository's main checkout, the
default branch and whether a commit is on a remote) and `lib/workspace.mjs` (read and write the workspace list).
Network git goes through the repository's own wrapper when it has one (`pnpm bot:git -- …`, the Figentra guard's
rule), else plain `git`. Linear goes through the vendored client in `lib/linear.mjs`; a Linear failure is reported and
never blocks (ADR 0065 rule 7).

## Components and responsibilities

- **`vellum start <STA-n> [--slug s] [--install] [--dry-run]`**: resolve the main checkout (also when run inside a
  worktree), fetch, read the default branch (`origin/HEAD`), derive the slug from the Linear title (lower-case words,
  at most 5 words and 40 characters) unless `--slug`, refuse when the folder or the branch (local or remote) exists,
  then `git worktree add <repo>/.claude/worktrees/sta-n-<slug> -b figentra/sta-n-<slug> origin/<default>`, move STA-n
  to In Progress with a comment naming the branch, and run `pnpm install` only with `--install`.
- **`vellum clean [--dry-run] [--adopt] [--fix-ignore] [--all]`**: for each worktree of the repository (or of every
  workspace repository with `--all`), the leader's revisions of 2026-10-31 included:
  - **skip** a tester worktree (`g-*`, `*-gate`, `land-*`, `tpl-core`, `c6-lock*`, `template-wt-lean`);
  - **clean**: `git status --porcelain` is empty (untracked files count);
  - **saved**: the head is on a remote ref (`git branch -r --contains`, or an ancestor of `origin/<default>`), or every
    commit is landed (`git cherry origin/<default> HEAD` lists no `+`), since core builders never push and stackra-f4
    lands by cherry-pick;
  - **finished**: with an issue key in the branch (`sta-n`), the issue is Done or Canceled; without one (a detached HEAD,
    or a builder sub-agent tree such as `agent-*`, `wf_*` or a random name), the tree has been idle for at least
    2 hours, from the modification time of its HEAD reflog (`<gitdir>/logs/HEAD`), not the index, which `git status`
    touches;
  - **no precious ignored files**: `git status --ignored --porcelain` lists nothing outside the usual caches
    (`node_modules`, `dist`, `build`, `coverage`, `.turbo`, `.cache`, `.stackra`, `.next`, `.expo`, `*.tsbuildinfo`,
    `.DS_Store`); a tree with anything else (`.env`, `ios/`, `android/`, …) is kept and the files are named;
  - a tree that passes every test is removed (`git worktree remove`), with its local branch when it has one, and its
    size (`du -sk` before removal) is added to the space freed, which the command reports;
  - every kept tree is reported with its reason (tester, dirty, unsaved, issue open, idle for less than 2 hours, precious
    ignored files, Linear unavailable);
  - `--adopt`: move each clean, non-tester worktree outside `.claude/worktrees/` inside with `git worktree move`, and
    list the tester ones for stackra-f4 and the dirty ones for their owner;
  - `--fix-ignore`: add `.claude/worktrees/` to `.gitignore` when missing and say a commit is needed.
- **`vellum guard [--print-settings]`**: read the agent's PreToolUse JSON from stdin; for a Bash command with
  `git … worktree add <path>` (including `-C <dir>` and `cd <dir> &&`), resolve the path against the command's
  directory and deny unless it is under that repository's `.claude/worktrees/`; anything else passes with no output.
  `--print-settings` prints the exact `.claude/settings.json` hook entry.
- **`vellum init --workspace <dir>…`**: find the git repositories under the given folders and write
  `~/.config/vellum/workspace.yaml` (path and GitHub slug per repository).

## Files and folders

- `packages/vellum/bin/vellum.mjs`: add `start`, `clean` and `guard` to the commands
- `packages/vellum/src/commands/start.mjs`, `clean.mjs`, `guard.mjs` (new); `init.mjs` (the `--workspace` option)
- `packages/vellum/src/lib/git.mjs`, `workspace.mjs` (new)
- `packages/vellum/src/__tests__/start.test.mjs`, `clean.test.mjs`, `guard.test.mjs`, `workspace.test.mjs` (new)
- `packages/vellum/README.md`, `AGENTS.md`; `.changeset/vellum-worktree-rule.md`; `.gitignore` (`.claude/worktrees/`)
- In billing, invoicing, brand, stackra/notes and stackra/pro: `.gitignore` gains `.claude/worktrees/` (one trivial
  commit each, after the commands land)

## Data models and migrations

none

## Contracts

- CLI: `vellum start`, `vellum clean`, `vellum guard`, `vellum init --workspace`, with the options above; exit 0 on
  success, 1 on a refusal or a failed step, 2 on a usage error.
- The guard's output is Claude Code's PreToolUse hook contract: `{ "hookSpecificOutput": { "hookEventName":
"PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": … } }` on a denial, nothing otherwise.
- `~/.config/vellum/workspace.yaml`: a `repos:` list of `{ path, github }`.

## Error handling

Every refusal names what blocked it and changes nothing (an existing folder or branch, an unknown issue without
`--slug`, a dirty worktree). A failed git step stops the command with git's message. A Linear failure is printed as a
warning after the worktree exists. The guard fails open on input it cannot parse, as every hook does, and never on a
`worktree add` it can read.

## Security and tenancy

No secret is read or printed: the Linear token comes from the calling wrapper's environment, network git from the
repository's bot wrapper. `vellum clean` never deletes a worktree with uncommitted or unpushed work, nor a tester's.

## Testing strategy

`node:test` against temporary repositories with a bare remote: start (folder, branch, refusals, slug, injected Linear),
clean (each keep reason, saved by remote and by cherry, detached and keyless trees with the idle time, precious ignored files, space freed, tester names, adopt, fix-ignore), guard (allowed and denied paths, `-C`, `cd &&`,
non-matching commands, unreadable input) and the workspace file. Run on a box by stackra-f4 (`pnpm verify`), never on
the Mac. Each test carries `@covers sta-1729:AC-###`.

## Rollout

1. Land the commands in Vellum and publish with the next Vellum release.
2. The leader takes the printed guard entry to the owner, who wires it into each repository's `.claude/settings.json`
   (and core's `_rules.mjs`).
3. Add `.claude/worktrees/` to the six repositories' `.gitignore`.
4. Run `vellum clean --adopt --dry-run --all`, review the list with the leader and stackra-f4, then run it for real.

## Constitution Check

| Law                                   | Result | Note                                                    |
| ------------------------------------- | ------ | ------------------------------------------------------- |
| Boundaries (tier direction, ADR 0003) | N/A    | Vellum is its own repository with one package           |
| Secrets (ADR 0009)                    | PASS   | tokens only from the wrapper's environment, never read  |
| Security                              | PASS   | never deletes unpushed or dirty work; tester trees kept |
| HTTP and events                       | N/A    | a CLI, no endpoint or event                             |
| Tenancy                               | N/A    | no tenant data                                          |
| Delegation                            | PASS   | one builder session, stackra-f4 gates                   |
| Not built yet (ADR 0011)              | PASS   | nothing on the list                                     |
| Test placement (ADR 0022)             | PASS   | `src/__tests__/` beside the subjects                    |
| Versions and catalogs                 | PASS   | no dependency                                           |
| Deploy modes (ADR 0076)               | PASS   | a developer tool, same everywhere                       |
| Licence tier (ADR 0077)               | PASS   | free                                                    |
| Docs and ADRs                         | PASS   | ADR 0503 in core; Vellum README and AGENTS.md           |

## Deploy modes

| Mode       | Behaviour         |
| ---------- | ----------------- |
| SaaS       | same (a dev tool) |
| On-prem    | same (a dev tool) |
| Air-gapped | same (a dev tool) |

## Correctness properties

- **P-001**: `vellum start` creates exactly one branch and one worktree under `.claude/worktrees/`, or changes nothing — Validates: FR-1
- **P-002**: the guard denies a `worktree add` path outside `.claude/worktrees/` and passes every other command — Validates: FR-2
- **P-003**: `--fix-ignore` leaves every repository ignoring `.claude/worktrees/` exactly once — Validates: FR-3
- **P-004**: `vellum clean` removes a tree only when it is clean, saved (on a remote or landed by patch), finished (issue closed, or idle 2 hours without a key) and free of precious ignored files, and never a tester tree — Validates: FR-4
- **P-005**: phase 2's gate posts `vellum/gate` only for the head it ran on (designed in phase 2) — Validates: FR-5
- **P-006**: phase 3's land merges only on a green gate and recorded approvals (designed in phase 3) — Validates: FR-6
- **P-007**: phase 4's status lists every workspace repository (designed in phase 4) — Validates: FR-7
- **P-008**: phase 5's release publishes only to the Stackra registry and ship never reaches production (designed in phase 5) — Validates: FR-8
- **P-009**: no phase adds a check that runs on the Mac beyond oxfmt and oxlint — Validates: FR-9
