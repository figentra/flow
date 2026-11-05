---
name: code-naming-and-casing
description: Name and shape TypeScript in Stackra (programming model v3) - the naming and casing table (files, class names from the file, packages, public ids, derived keys, permissions, events, machine codes, URLs, JSON, tables, env vars, branches, namespace keys), the one-meaning-per-word dictionary, # subpath imports including #modules, kind suffixes and group folders, Enum.of enums, private not #private, component folders, companion types, docblocks. Use when writing or reviewing any source file, and when code-standards findings appear.
---

# Naming, casing and code conventions

One table, enforced by the house lint plugin and the validator as they land (ADR 0129). ADR 0231 as amended by the
programming model v3 (ADR 0294) is the source. v3 is the target: no member is converted yet (STA-344) and the checks
are planned (STA-338, STA-340), so write new code in this form even where old code differs.

## The table

| Thing                                     | Convention                                                     | Example                                                  |
| ----------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------- |
| Files                                     | `<name>.<kind>.ts(x)`, kebab-case, in the kind's home group    | `actions/cancel-order.action.ts`, `models/order.model.ts` |
| Class names                               | `PascalCase(stem) + PascalCase(kind)`; noun kinds no suffix    | `CancelOrderAction`, `Order`, `OrderNotPayableError`     |
| Packages                                  | `@stackra/<kebab>`; services `@figentra/service-<kebab>`       | `@stackra/shortcuts`, `@figentra/service-identity`       |
| Member and module keys                    | Derived: member folder, module folder; snake_case              | `loyalty_kit`, `orders`                                  |
| Public ids                                | `<prefix>_<26 characters>`, typed `PublicId<"ord">`            | `ord_01jh4q...`                                          |
| Action and query keys                     | Write `key`; gen adds `<module>.` and `@<major>`               | `order.cancel` → `orders.order.cancel@1`                 |
| Permissions                               | Derived from `<Model>Permissions` statics                      | `OrderPermissions.cancel` → `orders.order.cancel`        |
| Integration events                        | Write `name`; gen adds `<module>.` and `.v<n>`                 | `order.paid` → `orders.order.paid.v1`                    |
| Machine codes (errors, refusals, reasons) | snake_case; error codes derived from the class                 | `order_not_payable`, `step_up_required`                  |
| URL paths                                 | Derived from the key, kebab-case, plural                       | `PUT /orders/:orderId/cancel`                            |
| JSON keys and query parameters            | camelCase                                                      | `{ "orderId": "..." }`                                   |
| Database tables                           | snake_case, plural, in the module's Postgres schema            | `orders.order_lines`                                     |
| Indexes, foreign keys, check constraints  | `idx_` / `fk_` / `ck_` prefixes                                | `idx_order_lines_order_id`, `ck_orders_status`           |
| Environment variables                     | SCREAMING_SNAKE; public prefixes never hold secrets            | `STACKRA_COMMERCE__TIMEOUT_MS`                           |
| Branches                                  | `figentra/sta-<n>-<slug>`                                      | `figentra/sta-334-v3-adr-wave`                           |
| Design tokens                             | CSS property and dotted forms                                  | `--color-ink-900`, `color.ink.900`                       |
| Asset, i18n, template, stub keys          | `<module>::<path>`                                             | `orders::actions.order.cancel.confirm`                   |
| DI tokens                                 | The class itself; a named instance is `Named<Port, "x">`       | `constructor(private readonly ledger: LoyaltyLedger)`   |

A derived identity is locked in `stackra.manifest.json`; changing it needs `@Renamed(old)`.

## One meaning per word (ADR 0294 decision 23)

- **Precondition**, never Guard or Gate. **Extension point** and **extension**, never a backend hook. **Hook** is a React
  `use*` function only. **Provider** is a React context component only; DI registrations are **bindings**.
- **Command** is a CLI command only; palette and key entries are **shortcuts**; the client's `.queue()` is a **queued
  call**. **Lifetime**, not scope, for DI. **Toast** for a transient in-app message, **notification** for a message to
  people.
- Banned identifiers: `*Guard`, `*Gate`, `*HookPoint`, `defineToken`, `defineConfig`, the `kbd` abbreviation.

## Code style

- Whole words; acronyms cased as words (`userId`, `ApiClient`, `loadHttpUrl`); abbreviations only `id`, `url`, `api`,
  `db`, `i18n`, `ui`. No `I` prefix on interfaces. Booleans read `is`, `has`, `can`. Handlers `on`/`handle`. Hooks `use`.
  Module-level constants SCREAMING_SNAKE.
- **One primary export per file.** Companions in the same file: `<Name>Input` and `<Name>Output` (action, query,
  prompt), `<Name>Props` (component), `<Name>Data` (notification). A type a second file imports moves to
  `types/<name>.type.ts` (or `src/contracts/types/` when it is a package's public type). No anonymous object type with
  two or more members in an exported signature.
- **Enums**: `Enum.of({...})` plus a type of the same name, in `enums/<name>.enum.ts`; labels come from i18n; the `enum`
  keyword is banned (ADR 0128 as amended).

  ```ts
  export const OrderStatus = Enum.of({
    PendingPayment: ["pending_payment", { tone: Tone.Warning }],
    Paid: ["paid", { tone: Tone.Success }],
  });

  export type OrderStatus = Enum.Value<typeof OrderStatus>;
  ```

- **Classes**: `private` keyword, never `#private`; injected dependencies are `private readonly`; one blank line between
  members; decorator and base-factory options with two or more properties go one per line.
- **Components** are functions in a folder `components/<name>/{<name>.tsx, index.ts, __tests__/}`; `index.ts` exports
  only the component and its Props. No class components and no story files (ADR 0128).
- **Plain functions** live in `functions/<name>.function.ts`. There are no `utils/` or `helpers/` folders.
- **Errors** extend `Refusal({ kind })` and end in `Error` (skill `backend-errors`).

## Imports (ADR 0233 as amended)

Each member declares aliases in the `imports` field of its `package.json`:

```json
{ "imports": { "#modules/*": "./src/modules/*", "#contracts/*": "./src/contracts/*", "#stackra/*": "./.stackra/gen/*" } }
```

- Every import that leaves the current folder uses a `#` alias; `./` only for a file in the same folder. A sibling
  module is imported as `#modules/<key>/<group>/...`, and only its public groups (`module-boundary` rule).
- Generated output only as `#stackra/<name>`.
- `../` is banned everywhere; tsconfig `paths` and `@/`-style aliases are banned.
- Entry barrels are generated, never authored; `index.ts` appears only in a component folder.

## Docblocks (ADR 0007)

Every source file opens with the four-field header (Purpose, Boundary, Runtime, Governing contract); every member
carries a one-line TSDoc that says what it is for. A comment explains why, not what.

## Check

`pnpm lint`, `pnpm validate`, `pnpm knip`, then `pnpm verify`. Sweeps: `code-standards-steward`.
