---
title: Workspace Layout
always: true
description: Repository directory structure and placement rules
---

# Workspace Layout

Stackra follows a strict tiered structure enforced by Tiers and boundaries.

## Structure

```
stackra/
├── apps/                    # tier:app
│   ├── console/            # Vite web app (minimal entry)
│   ├── docs/               # Fumadocs documentation site
│   └── mobile/             # Expo SDK 57 app
├── packages/               # tier:lib
│   ├── application/        # Actions, AI, IR, registry
│   ├── commerce/           # Money, ledger and pricing primitives
│   ├── communication/      # Webhooks, versioning, integrations, notifications
│   ├── connectors/         # One provider's Integration and Connection classes per package
│   ├── cross-cutting/      # Concerns that span layers
│   ├── data/               # Model, database, content, media, search, state machine, assets, filesystem, storage
│   ├── design-system/      # Stackra Design System: tokens, ui, icons
│   ├── developer/          # CLI, gen (the codegen compiler), coding standard, Vite plugin
│   ├── experience/         # Experience, navigation, console, panel, builder, collaboration
│   ├── foundation/         # Contracts, validation, errors
│   ├── infrastructure/     # Pulumi-based infra-* packages
│   ├── runtime/            # Outbox, queue, scheduler, workflow, realtime, locking, cache
│   ├── security/           # Identity, IAM, scope, tenancy, entitlements, licensing
│   └── state/              # Settings, feature flags, theming
├── services/               # tier:service
│   ├── example/            # Reference service (plain TypeScript)
│   └── health/             # Health check service
├── workers/                # tier:app (Cloudflare Workers, ADR 0284)
│   └── static/             # stackra-static: hosted static files at static.stackra.figentra.com
└── tools/
    ├── scripts/            # validation, scaffolding
    └── scaffold/           # Templates
.notes/                     # private owner-only submodule; never referenced from public docs
```

## Tier Tags

Every member declares exactly one tier in its `turbo.jsonc`:

- `tier:config` - Tooling presets (no workspace dependencies)
- `tier:lib` - Packages (category-based, never depend on apps/services)
- `tier:app` - Apps and Cloudflare Worker members under `workers/` (never depend on services; ADR 0284)
- `tier:service` - Services in plain TypeScript; Encore is generated into `.stackra/encore` (ADR 0124)

After the tier tag come `category:<c>` (packages only) and one `runtime:<r>` per entry of the `package.json`
`stackra.runtimes`, in that order (ADR 0453 decision 11, amendment of 2026-10-27); the boundary rules read tier tags only.

## Placement Test

1. **Is it deployed?** → `tier:service` or `tier:app` (a Cloudflare Worker goes in `workers/<name>`, ADR 0284)
2. **Is it consumed by multiple apps/services?** → `tier:lib` in appropriate category
3. **Is it build/lint/test configuration?** → `tier:config` in `packages/tooling/`
4. **Is it a script?** → `tools/scripts/`
5. **Is it a template?** → `tools/scaffold/`

## What Goes Where

The programming model v3 (ADR 0294, 0295) is the target shape below. Today's members predate it: the console, mobile
app, example and health services and the static Worker still have an authored `src/main.ts`, and
`stackra validate --repository` (`checkService`) accepts a service in that shape (with a `stackra.module` field) or in the v3
shape that `pnpm new` writes until STA-344 converts them. Convert nothing by hand ahead of the codemod (STA-344); write
new code in the v3 shape where the member already allows it.

### Every member (ADR 0294 rule R12, ADR 0295)

- Authors `package.json`, `tsconfig.json`, `turbo.jsonc`, `stackra.config.ts` (one `defineApp`, `defineService`,
  `definePackage` or `defineWorker` call, static data only), `runway.yaml` when it needs runtime resources (ADR 0296),
  `src/**` and `assets/**`
- The root module is optional. `src/<key>.module.ts` (`src/node/<key>.module.ts` in a package) is written only when it states something gen cannot derive; a member with none is one module keyed by its folder name (ADR 0305, ADR 0294 2026-10-23 item 14)
- Exempt from `stackra.config.ts` and the root module: the docs app (`apps/docs`, Fumadocs, no TypeScript runtime) and
  the `tier:config` presets in `packages/tooling/` (tool configuration, no module); the planned `member-root` check
  (STA-339) skips them
- Nobody writes `main.ts`, an entry barrel or a tool config: gen writes the runtime entries to `.stackra/entry/<target>.ts`
  and every tool config into `.stackra/` (ADR 0295)
- Committed generated contracts at the member root: `stackra.manifest.json` and `openapi.json`; a package also commits
  its entity list, `src/node/entities.gen.ts`, because its built `./node` cannot import `.stackra/` (ADR 0294 R10 and
  ADR 0295, amended 2026-11-01, STA-1874)
- Tests: `src/**/__tests__/` only (ADR 0022)

### Packages (<category>/<name>)

- Shared code consumed by apps/services, organised by category: foundation, application, communication, etc.
- Entry folders: `src/contracts/` (the leaf: `ports/`, `enums/`, `types/`), `src/config/`, `src/core/`, `src/node/` (the
  module, with the module groups), `src/react/<name>/`, `src/native/<name>/`, `src/testing/` (ADR 0294 decision 15)
- Entries: `.`, `./contracts`, `./node`, `./react`, `./native`, `./testing`; the barrels are generated

### Services (<name>)

- Backend services in plain TypeScript; `stackra gen` emits the Encore app (ADRs 0091, 0124)
- Independent workspace members; feature modules in `src/modules/<key>/`, each with the module groups of ADR 0294
  decision 13 (`models/`, `actions/`, `queries/`, `schemas/`, `enums/`, `errors/`, `events/`, `listeners/`,
  `workflows/`, `access/`, `services/`, `drivers/`, `extensions/`, `integrations/`, `connections/`, `resources/<model>/`,
  `database/{migrations,factories,seeders,macros,sequences}/`, `ai/`, `functions/`, `constants/`, `types/`), a group appearing with its
  first file; `database/` is per module, its migrations numbered per module, and each module's tables live in its own
  Postgres schema
- Config classes in `src/config/`; the public type surface in `src/contracts/`
- Three kinds added by ADR 0294's amendment of 2026-10-24: a sequence is `database/sequences/<name>.sequence.ts` (ADR 0342), a
  product's data class is `access/<name>.data-class.ts` (ADR 0341), and an edition's model addition is
  `models/<base>.model-addition.ts` (ADR 0336)
- A migration is a frozen snapshot: it imports only `@stackra/database` and `#stackra/migrations`, and its tables and columns are literals (ADR 0159, v3.1 note)

### Apps (<name>)

- Console: Vite web app; Docs: Fumadocs documentation site (ADR 0514); Mobile: Expo React Native app
- App groups (ADR 0294 decision 14, ADR 0305): `src/<key>.module.ts` (optional), `config/`, `routes/<name>/`,
  `components/<name>/`, `blocks/<name>/`, `panels/`, `menus/`, `shortcuts/`, `documents/`, `stores/`, `flags/`,
  `analytics/`, `bridges/`, `hooks/` (two or more importers), `schemas/`, `errors/`, `enums/`,
  `types/`, `styles/`
- Overrides of any package or service live in one tree, `src/overrides/<owner>/`, which mirrors the owner's paths (ADR 0306)
- No hand-written native code in an app: Swift and Kotlin live only in Expo module packages, one package per hardware or OS capability, behind a TypeScript port with a mock driver (ADR 0478)
- Docs (`apps/docs`) has its own layout (ADR 0002, 2026-10-27 amendment): pages in `src/docs/`, `assets/` and `snippets/` in `src/`, the site in `src/config/docs.config.ts`; gen assembles the Fumadocs site into `.stackra/site/`

### Workers (<name>)

- Cloudflare Worker members, `@figentra/worker-<name>`, tier `tier:app` (ADR 0284)
- `wrangler.jsonc` at the member root is hand-written until gen writes the Workers config (ADR 0295, STA-339); deployed
  only from CI
- Tests: `src/**/__tests__/`

## Generated Output

- `stackra gen` writes real typed files to `.stackra/gen/` (`routes`, `navigation`, `i18n`, `resources`, `assets`, `clients`, `services`, `permissions`, `settings`, `capabilities`, `wiring`, `hooks`, `schemas`). Code imports them only as `#stackra/<name>`, through the member's `imports` map (ADR 0261, 0233); a package's entity list is the exception, the committed `src/node/entities.gen.ts` imported as `#node/entities.gen` (STA-1874)
- Target: `.stackra/` is fully gitignored, and the committed contracts are `stackra.manifest.json` at the member root and a package's `src/node/entities.gen.ts` (ADR 0294 rule R10, amended 2026-11-01). Today `.gitignore` still re-includes `.stackra/app-manifest.json`; STA-339 removes the exception
- DI wiring is generated into `.stackra/gen/wiring.ts`; a module is a folder, classes are the only tokens, and authors write no provider lists (ADR 0263 as amended by 0294)

## Forbidden Paths

- No root `tests/` - tests live beside code
- No `src/` in workspace root
- No packages directly in `packages/` - must have category folder
- No `assets/overrides/` folders and no `.override.tsx` files: overrides live in `src/overrides/<owner>/` (ADR 0306)
- Tooling presets live in `packages/tooling/<name>/src/` (one flat layer); no `packages/tooling/<name>/src/lib/`. There are
  exactly five: typescript, oxlint, vitest, tsdown and commitlint (ADR 0300)
- Folders named after a retired kind: `links/`, `permissions/`, `guards/`, `hooks/` (inside a module), `states/`,
  `search/`, `repositories/`, `seeds/`, `versions/`, `mails/`, `override-points/`, `tokens/`, `utils/`, `helpers/`
  (ADR 0294, 0130 as amended)

## Enforcement

- `turbo boundaries` checks dependency direction
- `stackra validate --repository` checks tier tags, file existence, and config formats: repo-owned config is YAML; `.jsonc` only where the reader has no YAML support (`MUST_STAY_JSONC`), `.json` only where it takes no comments (`MUST_STAY_JSON`)
- `packages/tooling/oxlint/src/boundaries.jsonc` enforces layer rules
- planned — STA-338: the `kind-path` check of the v3 group tables; STA-339: the `member-root`, `tool-configs`, `manifest` and `runway` checks; STA-340: the other v3 validator rows (ADR 0294 to 0296)
- Repo-owned YAML is block style: no flow mappings (`{ a: b }`, empty `{}` aside), flow sequences only for short scalar lists on one line, trailing comments only while the line stays within 100 characters; `checkYamlFlowMaps` in `stackra validate --repository` enforces it (STA-299)

## See Also

- ADR-0004: Package archetypes and layers
- ADR-0003: Tier dependency direction
- ADR-0294, ADR-0295, ADR-0296: programming model v3, build and entry, runway v3
- ADR-0305, ADR-0306: programming model v3.1 and the overrides tree
- Standards: members (required files per tier)
