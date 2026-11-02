# Implementation Plan: fflow owns every repository's agent and tool setup, under a governed preset

**Spec**: `.agents/specs/sta-1945-flow-owns-everything/spec.md` · **Linear**: STA-1945 · **Date**: 2026-11-02

**Input**: the spec, Clarified, with the owner's decisions D1 to D3 (2026-11-02, relayed by the leader session).

## Summary

Build 0.3.0 in nine Flow PRs, governance first: the lock, `check`, `diff`, `validate`, `update` and `--workspace`
come before any new surface, so every surface that follows is born locked and checkable. Then the surfaces, then
core's content, then third-party skills and the divergence report. The minor release waits for the last PR. Then
comes the migration (FR-10 steps 2 to 4), one PR per repository, with core first.

## Technical Context

- **Language**: plain ESM JavaScript with JSDoc, checked by `tsc`; Node 24; no runtime dependencies (the YAML that
  overrides and preset data need is read by `src/lib/yaml.mjs`, which already exists for the agent roster).
- **Testing**: `node:test` in `src/__tests__/`, on fixture repositories in temporary folders; no network. On the
  Mac only oxfmt and oxlint run; typecheck and tests run on box 1 and in CI.
- **What exists**:
  - `render.mjs` renders the `flow-*` skills, agents, rules, README, the approval and baseline workflows and
    CODEOWNERS;
  - `writeRendered` writes `.flow/lock.json` (`version`, `preset`, `files`); `installProblems` is `gate ci`'s
    drift check;
  - `.flow/overrides/` already exists, holding whole-file replacements of a command or template, keyed by file name;
  - `fflow guard` covers only the worktree rule.
- **Content to move** (core `origin/main`):
  - the guard engine: `.agents/hooks/`, 9 modules plus 6 test files, wired by `.claude/settings.json`
    (UserPromptSubmit, SessionStart, two PreToolUse and one PostToolUse entries);
  - 28 role agents, 48 skills (481 files), 15 rules, 29 reference docs, `routing.yaml` and `models.yaml`;
  - `opencode.jsonc` with `.opencode/`, `.mcp.yaml`, `lefthook.yml`, AGENTS.md and CLAUDE.md.

## Components

| File                                            | Change                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/lock.mjs` (new)                        | lock v2: read, write, `presetDigest`, `overridesDigest`; reads a v1 lock once and upgrades it on `sync`                                          |
| `src/lib/provenance.mjs` (new)                  | the header per comment syntax (`#`, `//`, `<!-- -->`, frontmatter `metadata:`); none for strict JSON                                             |
| `src/lib/overrides.mjs` (new)                   | load and validate `.flow/overrides/<surface>/<id>.yml`; apply `extend`, `configure`, `replace`, `disable`                                        |
| `src/lib/policies.mjs` (new)                    | the mandatory policies (FR-5) and the "extend only tightens" check                                                                               |
| `src/lib/profiles.mjs` (new)                    | resolve the config's `profile` against `preset.yml`'s `profiles`                                                                                 |
| `src/commands/{check,diff,validate,update}.mjs` | new commands; `sync` gains the locked-preset refusal; all five take `--workspace <dir>`                                                          |
| `src/lib/workspace-run.mjs` (new)               | find repositories under a folder (`flow.config.json`), run a command in each, one line per repository                                            |
| `src/guard/` (new)                              | the neutral engine: bash, paths, plan gate, session context, post-write checks, prompt hints                                                     |
| `bin/fflow-guard.mjs` (new)                     | the hook entry: no dispatcher and no config walk beyond the guard's, since it runs on every tool call                                            |
| `src/lib/render-*.mjs` (new, one per surface)   | `.claude/settings.json`, OpenCode, `.mcp.yaml`, `lefthook.yml`, AGENTS.md and CLAUDE.md                                                          |
| `src/lib/skills.mjs` (new)                      | third-party skills: install, licence check, digest; `machine-only` handling                                                                      |
| `src/commands/doctor.mjs` (new)                 | per machine: what `machine-only` skills to install and from where; Flow and preset versions                                                      |
| `src/commands/status.mjs`                       | `--divergence`                                                                                                                                   |
| `assets/flow/presets/stackra/`                  | `profiles`, `guard/` rule tables, `agents/`, `skills/`, `rules/`, `reference/`, `routing.yaml`, `models.yaml`, surface blocks, `third-party.yml` |
| `assets/flow/presets/neutral/`                  | the generic parts: guard engine defaults, settings, lefthook steps, AGENTS.md blocks                                                             |
| `schema/`                                       | `flow.config` gains `profile`, `mcp`, `lefthook`, `agentsMd`; new `override.schema.json`                                                         |

## Contracts

- **Lock v2** (`.flow/lock.json`):
  `{ lockVersion: 2, flow, preset: { name, version, digest }, profile, overrides, files: { path: sha256 }, skills: { id: { source, version, licence, digest } } }`.
  - `preset.digest` hashes the preset folder's files in path order, with line endings normalised.
  - `overrides` hashes `.flow/overrides/` the same way.
  - A v1 lock (`version`, `preset`, `files`) is read once and rewritten as v2 by the next `sync`.
- **The preset version is Flow's version**: presets ship inside the package. `sync` refuses when the installed
  Flow's preset digest differs from the lock's, naming `fflow update`. `update` adopts the installed preset: it
  prints the diff, rewrites the lock, then syncs. `update --preset <version>` refuses when the installed version is
  not that one, because pnpm stays the only installer.
- **Override file**: `{ kind, target, reason?, owner?, review?, … }`.
  - `target` names a rendered output or a preset parameter.
  - `extend` takes `items` or `section` with `text`; `configure` takes `values`; `replace` takes `file` (a path
    under `.flow/overrides/`); `disable` takes nothing more.
  - The current whole-file replacements (`.flow/overrides/commands/flow-<verb>.md`, the templates) are read as
    `replace` overrides with no review date, and `validate` warns until each gets a `.yml` beside it.
- **Mandatory policies** (FR-5): the guard's secret and tenancy tables, the owner-only paths, and the guard's wiring
  in `.claude/settings.json` and OpenCode. `validate` refuses `disable` and `replace` on any of them. `extend` is
  accepted only when the result holds every preset rule (a superset).
- **Profiles**: `preset.yml` gains `profiles: { <name>: { agents: [...], skills: [...], hooks: [...] } }`, with `*`
  for all. The config's `profile` defaults to the preset's `default`. Per D3, the stackra profiles are `framework`,
  `platform`, `product`, `brand` and `starter`, plus `pro` only if stackra-pro's needs differ.
- **Guard wiring**: `.claude/settings.json` runs `node node_modules/@figentra-oss/flow/bin/fflow-guard.mjs <event>`,
  not `pnpm exec`, to keep pnpm's start-up off every tool call. The OpenCode plugin imports the same engine.
- **Third-party skills** (`third-party.yml` in the preset): `{ id, source, version, licence, digest, machineOnly? }`.
  - Installs go to `.agents/skills/.vendor/` (git-ignored) and are pinned in the lock.
  - Licences outside MIT, Apache-2.0, BSD and ISC need an owner entry.
  - `machineOnly` skills (D1: HeroUI Pro's two, Remotion's six, and the owner's 13) are never installed or locked;
    `check` fails if one is committed; `doctor` lists them.

## Constitution Check

| Law                       | Result | Note                                                                                              |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| Secrets (ADR 0009)        | PASS   | Flow reads none; `.mcp.yaml` and the guard's tables carry secret names only                       |
| Security                  | PASS   | the guard's rules become mandatory policies; overrides are owner-only paths; `check` fails closed |
| Not built yet (ADR 0011)  | PASS   | no skill-publish pipeline (D2); `sync --workspace` opening PRs stays out ("Not now")              |
| Test placement (ADR 0022) | PASS   | `src/__tests__/`; core's guard tests are ported there                                             |
| Versions and catalogs     | PASS   | no dependency; third-party skills are pinned by digest, not installed as packages                 |
| Licences                  | PASS   | per D1, nothing proprietary or unlicensed is redistributed                                        |

## Build order (Flow PRs, each green on box 1 and in CI)

1. **Governance core.** Lock v2, provenance headers on today's outputs, `check`, `diff`, `validate`, `update`, the
   locked-preset refusal in `sync`, and `--workspace` for all five. No new surface.
2. **Overrides and policies.** The four kinds, review dates (a warning 14 days before, a failure after), the
   mandatory-policy refusal, and today's whole-file overrides read as `replace`.
3. **Profiles.** `preset.yml` profiles, the config's `profile`, and the lock's `profile`.
4. **The guard engine** (R3). Port `.agents/hooks/` into `src/guard/`, with core's rule tables as stackra preset
   data. Port the six test files unchanged in their cases. Add a differential test: every input in the ported
   corpus gets the same decision from the engine with the stackra tables as core's tests expect. The worktree rule
   becomes one rule among the rest.
5. **Surfaces.** `.claude/settings.json`, OpenCode, `.mcp.yaml`, `lefthook.yml`, AGENTS.md and CLAUDE.md, each from
   preset blocks plus the config's additions. `sync` deletes an owned file the preset no longer renders and never
   touches `.agents/specs/`. The lefthook oxfmt and oxlint jobs use core's STA-1865 pattern: `mise exec --` first,
   `pnpm exec` only without mise, and exit 2 ("all ignored") counted as a pass. `sync` adds or corrects the
   `npm:oxfmt` and `npm:oxlint` pins in `mise.toml` to the catalog's versions, and changes no other line of that
   file. Tests cover: mise present, mise missing, all files ignored, and a pin that disagrees with the catalog.
   Two more lefthook rules (os#112):
   - commit-msg runs commitlint only when `node_modules/.bin/commitlint` exists; otherwise it skips with a note
     (the Quality Gate commitlints every PR commit anyway).
   - pre-push skips only when the install or pnpm's lockfile trust-policy check fails with the registry's 401
     (`ERR_PNPM_META_FETCH_FAIL`, or "Lockfile failed supply-chain policy check" with a 401), and prints "pre-push
     skipped: no registry read on this machine; the PR must cite a ci-box run for this commit". Any other failure
     still blocks. Tests cover each skip, and a non-401 failure that blocks.
   - The oxlint job runs only when `node_modules/@stackra/oxlint-config` exists, since `.oxlintrc.jsonc` extends a
     config there; otherwise it prints "oxlint skipped: no workspace install on this machine; CI lints this commit"
     (os; the same guard as commitlint's). Tests cover both cases.
6. **Core's content.** The 28 agents, 48 skills (FR-12), 15 rules, 29 reference docs, routing and models go into the
   stackra preset, split by profile. Before this lands, the package tarball size is measured and stated in the PR.
7. **Third-party skills and `doctor`.** The FR-8 list from brand's census, with D1's `machine-only` marks.
8. **Divergence report** (`status --divergence`) and the docs: README, AGENTS.md, the preset docs, a Flow ADR for the
   governance model, and the 0.3.0 changeset made final.
9. **CLI output and error handling** (the owner's requirement after trying 0.2.3; the full list is in the notes'
   `plans/after-freeze-backlog.md`, "Owner requirement: Flow CLI output and error handling" and the two CLI test rounds
   above it). Every command moves onto it:
   - `doctor` is a table (Check, Status, Detail, Fix) with coloured ✓ / ⚠ / ✗, rows grouped as Machine, Repo, Flow and
     GitHub, and a summary line ("7 passed · 1 warning · 1 error") that sets the exit code. A missing `credentials`
     on a fresh local repo is information, not an error.
   - `status` shows tables for Specs (stage, problem count with the first problem), Worktrees (state, idle time,
     ahead/behind, coloured when stale or dirty), PRs and Sessions; `--verbose` lists every problem. A session working
     in a listed worktree shows up.
   - An error is one boxed block: what failed, why, the exact fix command and a docs link. Raw git and pnpm output
     (`fatal: not a git repository`) appears only with `--verbose`. A command checks for the repository before
     anything else.
   - `fflow` alone prints a banner, the version and the commands grouped, each with a one-line summary. `--help` on
     any command prints its usage and never runs it. An unknown command names the closest match and exits non-zero.
   - The brand theme comes from `@stackra/console`. Flow keeps no runtime dependency: it loads `@stackra/console` as an
     optional peer with a dynamic import, and otherwise (and under `NO_COLOR` or a pipe) prints the same tables as
     plain text from its own small renderer.
   - `--json` on `doctor`, `status` and `spec`, with the same data in a stable shape.
   - Fresh repositories: `init` writes a starter `flow.config.json`, then syncs, so `lefthook.yml`, AGENTS.md,
     CLAUDE.md and the CI workflows (from PR 5) come with it. The first `sync` works without `--direct`. `init` lists
     what it rendered and why the counts differ from a later `sync`, and says `/flow-specify` is a Claude Code command.
   - `spec paths` and `gate dir` fall back to the spec folder that matches the branch's slug when the branch has no
     issue key, or say exactly which branch name they expect; neither suggests the other in a loop.

   Tests cover each table's plain and JSON forms, the error block with and without `--verbose`, `--help` on every
   command (nothing runs), the unknown-command suggestion and exit code, `NO_COLOR` and a pipe, and a fresh-repo
   `init` followed by `doctor` with no error.

Each PR carries its changeset entry. The owner holds the version PR until PR 9 merges, so no partial 0.3.0 ships.

### Added by amendment A-1 (Flow first; after the owner approves it)

10. **The record and the lifecycle** (FR-13, FR-14, FR-19): `.flow/record/<key>.json`, `fflow next` and `resume`, the
    stop hook that commits and pushes a session's work, and the guard rules for the side doors.
11. **Stacks** (FR-16): `fflow stack`, the merge-up after a squash with the "parent-identical file keeps the child"
    resolution, retargeting, and `land --stack`.
12. **Queues** (FR-17): the queue lock and `fflow adr reserve`.
13. **Hooks on the testbed** (FR-18): the lefthook fallback to a box run, the `Hooks-Run:` trailer and `gate`'s
    refusal.
14. **Stage workflows** (FR-15): the `plan`, `review` and gate fan-out workflows in the agent bundle, and the stage
    commands that hand them the spec and record their output.
15. **Sessions, to-do and ledger** (FR-20, FR-21): live session detection, the session-names ADR
    (`docs/adr/0001-session-names.md`), `fflow todo` and `fflow ledger`.
16. **The baseline-aware merge bot** (FR-22): the newly-reached category in the baseline (os#114) and `land` on a
    baseline-green gate.

### Added by amendment A-2 (tasks that commands move)

17. **Markers and evidence** (FR-23, FR-25): four markers, optional and checkpoint tasks in the template and
    `parseTasks`; `fflow task start` / `task done` with evidence in the record; `check`, `trace` and `status` count
    evidence, not ticks; the reset on a changed spec.
18. **Waves and the parallel build** (FR-24): the wave graph from `plan`, the build workflow's wave dispatch (at most
    5 subagents), and `next`/`resume` from markers. Lands with PR 14 (stage workflows).

### Added by amendment A-3 (specs specific enough to check)

19. **Templates** (FR-26, FR-27): Discovery and Sources, measurable success and non-functional EARS lines in the spec
    template; the plan template's standards table, diagrams and per-component tree, interfaces, behaviour and failure
    modes; the small tier's one-page design; worked examples. Both presets.
20. **Gates** (FR-28 to FR-30): placeholder and open-question refusal, the vague-word list, scope drift in `gate`,
    the interface check in `trace`, and content-bound approvals.

PR 9 (CLI output) moves onto `@stackra/console` once STA-1966's engine (core #290) is published as a prerelease.

## Rollout (FR-10)

1. Release 0.3.0.
2. Core, in one PR: lefthook, the plan gate and `.claude` hooks point at `fflow`, and core deletes `.agents/hooks/`,
   its spec code and its shims, with a `@stackra/repo-checks` changeset. Before it merges, box 1 runs core's old
   guard tests against the new engine, for the exact commit.
3. Each other repository, one PR each: re-sync on 0.3.0 with its profile, deleting `.specify`, copied hooks,
   `.opencode` guard copies and vendored skills in the same PR. os's guard copy goes here.
4. Dead files and old names are removed. The owner gets the list of `~/.local/bin` scripts to remove, and the
   deprecated `figentra-flow` bin is dropped.

## Risks

- **The guard (R3).** A missed match lets a forbidden command through, and a wrong one blocks every agent. The
  ported tests, the differential test and the box-1 run in core's PR are the proof. Until core's PR merges, core
  keeps its own engine.
- **Package size.** 481 skill files ship in the tarball (D2). PR 6 measures this; if it is too large, the fallback is
  the registry `skill` items that D2 deferred, which is a decision for the owner.
- **Digest stability.** Line endings and file order are normalised before hashing, so the same preset always gives
  the same digest on every machine.
- **Override migration.** Repositories with today's whole-file overrides keep working, read as `replace`, and
  `validate` names each one that still lacks its `.yml`.
