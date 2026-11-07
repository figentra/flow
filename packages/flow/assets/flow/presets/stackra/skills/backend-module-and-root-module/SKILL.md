---
name: backend-module-and-root-module
description: Structure Stackra code as modules in the programming model v3 - one root module per member at src/<key>.module.ts, feature modules in src/modules/<key>/ with the group folders, Module({ exports, imports, wrap }), derived keys, classes as the only tokens, @Lifetime, config classes, generated wiring and entries, and createTestingModule. Use when creating a service, a package's root module, a feature module, or wiring bindings.
---

# Modules and the root module

The module is the unit of contribution (ADR 0111): a feature module holds its actions, queries, listeners, settings,
permissions, resources and assets, and a service or app only hosts modules. Every member has **one root module** and
`stackra.config.ts`; gen writes the wiring and the runtime entries (ADR 0294 rule R12, ADR 0295).

This is the v3 shape that `@stackra/container` and gen implement. Core's own `services/example` and `services/health`
still have an authored `src/main.ts` and a `stackra.module` field in `package.json`, which `checkService` accepts beside
the v3 shape; the conversion is STA-344. The package docs win where they differ.

## Layout (ADR 0294 decisions 13 to 15)

```text
services/commerce/                      # or packages/<category>/<name>/
├── package.json  tsconfig.json  turbo.jsonc
├── stackra.config.ts                   # defineService({ ... }): static data only (ADR 0295)
├── stackra.manifest.json  openapi.json # committed, generated: the member contract
├── runway.yaml                         # what the member requires (ADR 0296)
├── assets/{lang,ai,data,public}/
└── src/
    ├── commerce.module.ts              # the root module; key `commerce` from the folder name
    ├── config/commerce.config.ts       # class CommerceConfig extends Config
    ├── contracts/index.ts              # type-only public surface
    └── modules/
        └── orders/
            ├── orders.module.ts        # OrdersModule extends Module({ exports: [OrderService] })
            ├── orders.settings.ts      # one settings group per module
            ├── models/  actions/  queries/  schemas/  enums/  errors/  events/  listeners/
            ├── workflows/  access/  services/  drivers/  extensions/  integrations/  connections/
            ├── resources/<model>/
            ├── database/{migrations,factories,seeders}/  ai/  functions/  constants/  types/
            └── __tests__/orders.module.int.test.ts
```

A group folder appears with its first file. Each suffix has one home (`.permissions.ts`, `.policy.ts`, `.role.ts`,
`.precondition.ts` and `.flag.ts` all live in `access/`). Retired folders: `controllers/`, `dtos/`, `repositories/`,
`guards/`, `links/`, `permissions/`, `policies/`, `states/`, `hooks/`, `seeds/`, `versions/`, `mails/`,
`override-points/`, `tokens/`, `utils/`, `helpers/`. In a package the module is `src/node/` and its root module is
`src/node/<key>.module.ts`.

## Worked example

```ts
// src/modules/orders/orders.module.ts — key `orders`, from the folder name
import { Module } from "@stackra/container";
import { OrderService } from "#modules/orders/services/order.service";

/** Orders: placement, payment, fulfilment. Exports the service other modules may inject. */
export class OrdersModule extends Module({ exports: [OrderService] }) {}

// src/commerce.module.ts — the root module; only a root lists imports
export class CommerceModule extends Module({ imports: [OrdersModule, CatalogueModule, AccessLogModule] }) {}
```

- **No `providers` list.** Gen finds every binding in the module's group folders by its base class and prints them, with
  their lifetimes, in `.stackra/gen/wiring.ts` (ADR 0263 as amended).
- **Keys are derived and locked.** The module key is the folder name; the member key is the member's folder name
  (`commerce` for `services/commerce`). `stackra.manifest.json` locks them; a rename needs `@Renamed(old)`.
- **`wrap`** (`Module({ wrap: [MapProvider] })`) is the one escape hatch for a React provider, on an app's root module
  only.
- **Siblings** import only another module's exported classes and public groups (`module-boundary` rule).

## Injection (ADR 0005, 0143, 0145, 0263 as amended by 0294)

- Classes are the only tokens. A constructor parameter's type is its token: no `@Injectable`, no `@Inject`, no string
  or symbol token, no `defineToken`. A port is an abstract class that extends `Port`; a driver extends `Driver(Port)`.
- A named instance is the type `Named<LoyaltyLedger, "primary">`.
- Lifetime: a singleton by default; `@Lifetime(Lifetime.Request)` or `@Lifetime(Lifetime.Transient)` otherwise. A
  singleton never injects a request-lifetime class (checked at boot).
- Swap a binding with `@Replaces(Port)` on the replacing class.
- A closed platform set (container, config, actions, request context, clock, database, cache, queue, events and
  outbox, workflow, settings, i18n, logger, iam, realtime and every Config class) is injectable everywhere; authors
  cannot declare a global.
- A circular dependency is a boot error; there is no `forwardRef`.

## Configuration (ADR 0146 as amended)

```ts
// src/config/commerce.config.ts — key `commerce`
export class CommerceConfig extends Config {
  storefrontBaseUrl = "http://localhost:4001";

  @Env("STOREFRONT_TIMEOUT_MS")
  @Int({ min: 100 })
  timeoutMs = 5_000;

  @Secret("PRICING_API_KEY")
  pricingApiKey!: SecretRef;
}
```

A host overrides a package's config with a `<Host><Base>` subclass that declares `override` members only. No
`defineConfig`, `forRoot` or `registerAs`.

## Testing

```ts
const app = await createTestingModule(CommerceModule).override(PaymentGateway, fakeGateway).compile();
const action = app.get(CancelOrderAction);
```

## Never

- An authored `main.ts`, entry barrel, `providers` array or `imports` on a non-root module.
- `@Module`, `@Injectable`, `@Inject`, `@Provider` or any other kind decorator.
- `app()`, `config()`, `logger()` global helpers; inject instead (ADR 0145).
- A global metadata polyfill or type-based auto-wiring through reflection (ADR 0005).
- `../` imports; use the member's `#` aliases (ADR 0233).

## Check

`pnpm validate`, `pnpm turbo run test --filter=<member>`, `pnpm verify`.
