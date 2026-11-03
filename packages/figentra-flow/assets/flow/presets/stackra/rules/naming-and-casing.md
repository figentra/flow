---
title: Naming and casing
always: true
description: One naming convention for Stackra. Files kebab-case with a kind suffix, class names from the file, identities derived, machine codes snake_case, namespace lookups with ::, env and secrets SCREAMING_SNAKE.
---

# Naming and casing

Every name follows ADR 0231 (`/adr/0231-naming-and-casing-standard`) as amended by the programming model v3, ADR 0294
(`/adr/0294-programming-model-v3-grammar-folders-identities-and-naming`), as amended by v3.1, ADR 0305
(`/adr/0305-programming-model-v3-1-names-partners-files-and-class-components`). The summary is below. A name that no row covers
needs an ADR before use. v3 is the target: no member in this repository has been converted yet (STA-344), so existing
code may still show the older forms; write new code in the v3 form.

- **Code style**: whole words; acronyms cased as words (`userId`, `ApiClient`, `loadHttpUrl`); no `I` prefix; abbreviations only `id`, `url`, `api`, `db`, `i18n`, `ui` (so `kbd` is refused: the package is `@stackra/shortcuts`); booleans `is`, `has`, `can`; handlers `on` or `handle`; React hooks `use`; module-level constants SCREAMING_SNAKE.
- **Files**: kebab-case `<name>.<kind>.ts(x)` in the kind's one home group (ADR 0294 decisions 1 and 13 to 15). Input and Output schemas live in `schemas/`, and a component's Props in `<name>.props.ts` (ADR 0305). **Packages**: `@stackra/<kebab>`; services `@figentra/service-<kebab>`.
- **Class names**: one declaration per file, named `PascalCase(stem) + PascalCase(kind)`: `cancel-order.action.ts` exports `CancelOrderAction`. Noun kinds (model, schema, enum, event, signal, analytics event, type) take no suffix; error classes end in `Error`. No companions: `<Name>Input` and `<Name>Output` (action, query, prompt), `<Name>Props` (component) and `<Name>Data` (notification) each live in their own file (ADR 0305).
- **Overrides and kind bases** (ADR 0305, 0306): an override keeps the plain name of what it overrides and imports its base as `Base<Name>`. A kind base is named `PascalCase(kind)`, and a kind factory takes no `define` prefix (`Driver(...)`, not `defineDriver(...)`). `define*` is reserved for the four `stackra.config.ts` functions.
- **Identities are derived, not typed** (ADR 0294 decision 20): module key from the folder, member key from the member folder name, permission `<module>.<model>.<verb>` from a `<Model>Permissions` static, error code from the class name. Written once: an action or query `key` (`order.cancel`, which becomes `orders.order.cancel@1`), an event `name` (`order.paid`, which becomes `orders.order.paid.v1`), a route `path`. `stackra.manifest.json` locks each one; a change needs `@Renamed(old)`.
- **Public ids**: `<prefix>_<26 characters>`, typed `PublicId<"ord">`; only a seeder's `static ids` spells one out. **Branches**: `figentra/sta-<n>-<slug>`.
- **Wire identifiers keep dots**: action keys `orders.order.cancel@1`, permissions `orders.order.cancel`, events `orders.order.paid.v1`.
- **Machine codes** (categories, error codes, refusal codes, event reasons, gen error codes): snake_case.
- **URL paths**: kebab-case, plural, derived from the key by the endpoint convention (`http-conventions`). **JSON keys and query parameters**: camelCase.
- **Database**: snake_case plural tables in the module's Postgres schema (`orders.order_lines`); `idx_`, `fk_` and `ck_` names for indexes, foreign keys and check constraints.
- **Environment variables and secrets**: SCREAMING_SNAKE. Public values use `VITE_`, `EXPO_PUBLIC_` or `RENDERER_VITE_` and never hold a secret. Server values use `STACKRA_`, `FIGENTRA_` or `MAIN_VITE_`. Secrets are `<PROVIDER>_<PURPOSE>`. Tool-reserved prefixes are `ENCORE_`, `TURBO_`, `NODE_`, `CI`, `GITHUB_`, `INFISICAL_`, `EAS_`.
- **Namespace lookups** (i18n keys, assets, templates, stubs) use `<module>::<path>`, for example `orders::actions.order.cancel.confirm` and `flags::public/images/eg.svg`.
- **Locales**: folders and overlays use BCP 47 case (`assets/lang/ar-SA/`, `en-US`), and the catalogue layout is set by ADR 0305; URL prefixes stay lowercase (`/ar-sa/`, ADR 0297).
- **DI**: classes are the only tokens. A constructor parameter names its dependency by its type; a port is an abstract class; a named instance is the type `Named<Port, "x">`. `defineToken`, string tokens, `@Inject` and `@Injectable` are retired (ADR 0145, 0263 as amended by 0294).
- **One meaning per word** (ADR 0294 decision 23): Precondition, never Guard or Gate; extension point and extension, never a backend hook; an extension point's slots are `before` and `after`, and an `Interceptor` wraps one action call (ADR 0305); Hook means a React `use*` function only; Provider means a React context component only (DI registrations are bindings); Command means a CLI command only; Lifetime, never scope, for DI. Banned identifiers: `*Guard`, `*Gate`, `*HookPoint`.
- **The decorator test**: if the folder, the suffix, the base class, a field type, a method name or a derived name already says it, write no decorator. Only field, method (`@Step`, `@Transition`) and class-facet decorators exist; there are no kind decorators.

Enforcement: planned — STA-338 (`base-matches-suffix` and the validator's `kind-path` check), STA-340 (the decorator-registry checks, the `names` validator row for abbreviations and banned identifiers, the gen checks `kind_class_name` and `identity_changed`), and oxlint `unicorn/filename-case` and the house rules of ADR 0129. Nothing here is checked yet.
