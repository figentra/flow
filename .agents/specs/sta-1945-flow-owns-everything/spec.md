# Feature Specification: fflow owns every repository's agent and tool setup, under a governed preset

**Feature Branch**: `figentra/sta-1945-flow-owns-everything`

**Created**: 2026-11-02

**Status**: Clarified

**Tier**: big

**Approver**: owner (approved 2026-11-02, relayed by the leader session: "one command that syncs everything", after the
baseline gate); the governance model is the external review of 2026-11-02

**Linear**: STA-1945

**Clarifications status**: complete, except Q1 to Q3 below, which go to the owner before Planned

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
- **FR-6 Profiles.** A preset may declare profiles, for example `framework` for core, `product`, `platform` and
  `brand`. A profile selects which agents, skills and hooks a repository gets. The config names it; the lock records it.
- **FR-7 What `sync` renders** (stackra preset; the neutral preset gets the generic parts):
  - role agents, skills, rules, agent reference, routing and models;
  - the guard: `fflow guard` is a neutral engine covering bash, paths, the plan gate, session context, post-write
    checks and prompt hints, with core's rule tables as stackra preset data. It keeps behaviour parity, including the
    exact `figentra bot|linear|secrets` matches, proved by porting core's guard tests;
  - `.claude/settings.json` (hooks and permissions) and the OpenCode projection (`opencode.jsonc`, `.opencode/`, the
    guard plugin);
  - `.mcp.yaml`: the preset's servers plus the config's additions, secrets by name;
  - `lefthook.yml`: the preset's hook steps plus the config's, including `fflow gate branch`;
  - AGENTS.md and CLAUDE.md: the preset's shared blocks plus the repository's facts from the config and
    `.flow/readme.yml`.

  `sync` deletes an owned file that the preset no longer renders. It never touches specs (`.agents/specs/`), which
  are the repository's own work.

- **FR-8 Third-party skills** are not vendored. The preset lists each by source, version and licence, and `sync`
  installs it into a git-ignored folder, pinned by digest in the lock. A licence the preset hasn't allowed (anything
  but MIT, Apache-2.0, BSD or ISC) needs the owner's entry in the preset before it installs (Q1).
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

## Questions for the owner (before Planned)

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
