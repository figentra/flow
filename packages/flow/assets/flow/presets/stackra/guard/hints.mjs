/**
 * Stackra preset: the guard engine's prompt hints and session invariants, moved unchanged from core's
 * `.agents/hooks/prompt-hints.mjs` and `.agents/hooks/session-context.mjs`. Each hint points at the rule file that
 * owns its topic so the agent reads the source instead of trusting the one-liner.
 * Governing contract: ADR 0016 (agents source of truth); ADR 0002 (2026-10-27 amendment, docs paths); STA-1945.
 */

/** A hint for a prompt that names any of `ws`. */
const has =
  (/** @type {string[]} */ ...ws) =>
  (/** @type {string} */ p) =>
    ws.some((w) => p.includes(w));

/** @type {import("@figentra-oss/flow/guard").PromptTable} */
export const PROMPT = {
  title: "[STACKRA HINTS]",
  hints: [
    {
      match: has("endpoint", "route", " api", "handler", "controller"),
      text: "HTTP: services are plain TypeScript; behaviour is an action or query class (`extends Action({ key })`, `extends Query({ key })`), gen derives the route from the key and generates Encore (ADR 0091/0124/0294), never hand-written; input and output are the types of `handle` and gen compiles the Zod; authenticated by default; cursor pagination on lists; prefixed public ids; typed `Refusal` errors; Idempotency-Key on writes (.agents/rules/http-conventions.md).",
    },
    {
      match: has("secret", "api key", "token", "credential", ".env", "infisical"),
      text: 'Secrets: Infisical is the source of every value (ADR 0173); runway syncs app secrets into Encore `secret("NAME")`, Workers and EAS on deploy. Dev and MCP tokens reach a process only through the pnpm script or tools/scripts/mcp.sh that needs them; raw `infisical run` asks the owner. No .env files, never read or print a value (.agents/rules/secrets.md).',
    },
    {
      match: has("adr", "decision", "architecture decision", "supersede"),
      text: "Decisions are ADRs: `apps/docs/src/docs/adr/NNNN-slug.mdx` from `template.mdx` (number reserved first with `pnpm adr:reserve <slug> --issue STA-n` in `apps/docs/adr/numbers.yaml` on main), index row in `adr/index.mdx` (the adr folder entry in `src/config/docs.config.ts` lists it in the nav), same-commit supersession. Route the writing to docs-adr-steward; ADR 0011 lists rejected/deferred tech.",
    },
    {
      match: has("changeset", "changelog", "version bump", "release"),
      text: "Release: one changeset per consumer-visible member change (`.changeset/<slug>.md`, `@stackra/<member>` + bump); never run `changeset version` locally (guard-bash denies it) and never hand-edit CHANGELOG.md (apps/docs/src/docs/runbooks/release.mdx, ADR-0013).",
    },
    {
      match: has("test", "vitest", ".spec", "spec file", "spec.ts"),
      text: "Tests sit directly in a `__tests__/` folder beside their subject (`src/**/__tests__/<name>.test.ts`), anywhere in the repo; no root `tests/`, no `.spec` (ADR-0022, enforced by `pnpm validate`).",
    },
    {
      match: has("package", "dependency", "version", "catalog", "pnpm-workspace"),
      text: "Versions come only from catalogs in `pnpm-workspace.yaml` (`catalog:<name>`, exact pins) or `workspace:*` — never a literal version or range in a package.json (.agents/rules/versions.md).",
    },
    {
      match: has("service", "microservice", "encore service", "worker", "gateway"),
      text: "Services are independent workspace members under `services/` (`@figentra/service-<name>`), never importing each other or apps (ADR-0010). A member authors `stackra.config.ts` and one root module `src/<key>.module.ts`; gen writes the entry (ADR 0294/0295), though today's services still have an authored `src/main.ts` until they are converted (.agents/rules/service-checklist.md). Check `.agents/rules/not-built-yet.md` before introducing a framework or runtime.",
    },
    {
      match: has("component", "screen", "page", "button", "design token", "brand"),
      text: "Frontend: theme tokens live in `@stackra/tokens` and components in `@stackra/ui` (packages/design-system, ADR 0302); web uses HeroUI v3, mobile HeroUI Native + Uniwind; `@stackra/ui` shares the component contracts, never one component implementation across web and native (not-built-yet.md).",
    },
    {
      match: has("prisma", "drizzle", "typeorm", "knex", "orm", "migration", "database"),
      text: "Data: MikroORM is the ORM (ADR-0014); Prisma/Drizzle/TypeORM/Knex are rejected and blocked by `pnpm validate`. One database per service; the service owns its schema.",
    },
    {
      match: has("where should", "which package", "placement", "new package", "boundary"),
      text: "Placement: deployed → tier:app/tier:service; shared → tier:lib under `packages/<category>/`; build config → tier:config in `packages/tooling/`; script → `tools/scripts/`. Dependency direction config → lib → app → service, never upstream (.agents/rules/workspace-layout.md, module-boundary.md).",
    },
    {
      match: has("import", "barrel", "export"),
      text: "Boundaries: a package never imports an app, a service, `encore.dev`, or another package's `src/`; barrels name each re-export and declare nothing (enforced by `turbo boundaries` and oxlint boundaries.jsonc).",
    },
    {
      match: (p) =>
        /\b(new feature|feature request|i want (to|you to)|add support|implement|build (a|an|the)|let'?s build)\b/.test(
          p,
        ) && !p.includes("speckit"),
      text: "Feature work starts with spec-kit, not code: `/speckit.specify`, then `/speckit.clarify` (Impact questionnaire, Linear STA-n), then `/speckit.plan`. Specs live in `.agents/specs/sta-<n>-<slug>/`; `/speckit.plan` refuses until clarifications are complete (apps/docs/src/docs/agents/spec-lifecycle.mdx).",
    },
  ],
};

/** @type {import("@figentra-oss/flow/guard").SessionTable} */
export const SESSION = {
  title: "STACKRA SESSION",
  invariants: [
    "0. Layout: apps/{console,docs,mobile}, packages/<category>/<name>, services/*, workers/* (Cloudflare Workers, tier:app, ADR 0284) are independent members in plain TypeScript (entry src/main.ts; no Encore files in a service — Encore is the generated runtime in the gitignored .stackra/encore, ADRs 0091/0124), mobile uses code-based navigation, docs in apps/docs/src/docs.",
    "1. Packages live at packages/<category>/<name> (flat inside one category) and are named @stackra/<name>. A package never imports an app, a service or another package's src/ (packages/tooling/oxlint/src/boundaries.jsonc).",
    "2. Every member extends one @stackra/typescript-config preset, one @stackra/vitest-config preset, and declares exactly one turbo tier tag (tier:config|lib|app|service).",
    "3. Versions live only in pnpm-workspace.yaml catalogs (catalogMode: strict). A member's package.json names catalog:<name> or workspace:* — `pnpm validate` fails otherwise.",
    "4. Every test file sits directly in a __tests__/ folder beside its subject (src/**/__tests__/<name>.test.ts); there is no root tests/ folder and no .spec. An app's e2e lives in that app (ADR 0022, enforced by pnpm validate).",
    "5. Docs are apps/docs (Fumadocs on a Worker, ADR 0514). Pages and ADRs live in apps/docs/src/docs (ADRs in apps/docs/src/docs/adr, served at /adr/<file>), assets in apps/docs/src/assets, the site config in apps/docs/src/config/docs.config.ts; gen writes the Fumadocs site to apps/docs/.stackra/site.",
    "6. Secrets: never print, read or write a value. Values are set by a human; developer tokens live in the vault.",
    "7. Worktrees: WIP commits, never stash (refs/stash is shared by every worktree). Destructive git and rm -rf run only in your own worktree (ADR 0293).",
    "8. Done = `pnpm verify` green (format, lint, typecheck, test, build, validate, boundaries, knip). Conventional commits; changesets for releases.",
  ],
};
