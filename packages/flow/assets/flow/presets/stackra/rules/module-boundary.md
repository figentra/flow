---
title: Module Boundary
always: true
description: Module boundary and import rules for Stackra
---

# Module Boundary

Packages and services are isolated by tier. The dependency graph flows one way: config → lib → app and service. Apps and services are peers (ADR 0003): neither imports the other.

## Direction

```
config → lib → app
             → service
(never upstream; app and service never import each other)
```

## Rules

1. **No upstream imports** - A tier never imports from tiers above it
2. **No cross-app imports** - Apps don't import from other apps
3. **No cross-service imports** - Services don't import from other services (use events or the generated client)
4. **Packages import from own layer or below** - Never from apps/services
5. **Inside a package, entries point one way** - `src/contracts/` is a leaf; `core` imports `contracts`; `node`, `react` and `native` import `core`; `testing` imports them all. No symbol is exported from two entries (ADR 0294 decision 15, ADR 0117 as amended)
6. **Sibling modules import only public groups** - a module reaches a sibling only through its exported classes, `schemas/`, `enums/`, `events/`, `errors/`, `access/*.permissions.ts` and `extensions/*.extension-point.ts`, and through `models/` only from `models/` and `database/`, for relations (ADR 0294 decision 24). Imports use `#modules/<key>/<group>/...` (ADR 0233 as amended)

## Forbidden Patterns

```typescript
// ❌ App importing from service
import { user } from "@figentra/service-auth";

// ❌ Package importing from app
import { Login } from "@figentra/console";

// ❌ Service importing from another service
import { stripe } from "@figentra/service-payments";

// ❌ Cross-app import
import { Header } from "@figentra/console/src/header";

// ❌ A sibling module's private group
import { OrderPricingService } from "#modules/orders/services/order-pricing.service"; // not exported by OrdersModule
```

## Allowed Patterns

```typescript
// ✅ App importing from package
import { STACKRA_THEME } from "@stackra/tokens";

// ✅ Service importing from package
import { logger } from "@stackra/logger";

// ✅ Package importing from lower package
import { config } from "@stackra/config";

// ✅ A sibling module's public group
import { OrderPermissions } from "#modules/orders/access/order.permissions";
```

## Services

Services communicate through the generated Encore app (ADRs 0091 and 0124):

- **Integration events** - a class that extends `IntegrationEvent({ name })` from `@stackra/events` (ADR 0305); the author writes `name` once and gen derives the wire name `<module-key>.<name>.v<n>` (`identity.user.created.v1`). A consumer is a `Listener` whose `handle(event: E)` parameter type is the producer's event (ADR 0078, 0141 and 0264 as amended by 0294)
- **Typed client calls and events** - `stackra gen` generates one typed client per service from its committed `stackra.manifest.json`, injected through the constructor from `#stackra/clients`: `client.x.y(input)` to call and `client.x.y.queue(input)` for a queued call (ADR 0260, 0261 as amended by 0294). A consumed module is imported by name from its service's client subpath, `import { OrdersModule } from "#stackra/clients/commerce"`, and never as a namespace walk such as `Commerce.modules.Orders` (ADR 0305)
- **Read models** - a consumer's copy of another service's data is a class that extends `Projection<Source>({ ... })` in the module's `models/` group, fed by that service's integration events (ADR 0163, 0260 and 0294)
- Transport is a driver behind the port (ADR 0142). Never direct imports of another service's source, tables or `Topic`
- A Stackra package that needs service data defines a port (an abstract class) in `src/contracts/ports/`; the service implements it (ADR 0260)
- Feature modules live in one of three homes: the service (default), a figentra-os `@figentra/*` package used by two or more OS consumers, or a `@stackra/*` package with no Figentra rules. The module layout is the same in all three (ADR 0259 as amended by 0294)

Classes are the only DI tokens, and configuration is a `Config` class declared as `Config({ schema, env })` (ADR 0145 and 0146 as amended by 0294 and ADR 0305). Names and casing follow ADR 0231 and 0294.

Today's code: the v3 shapes above are the target. No framework package ships yet, the example service still has an
authored `src/main.ts`, and older pages still name `app-manifest.json`; the conversion is STA-344.

## Enforcement

- `turbo boundaries` enforces tier direction
- `packages/tooling/oxlint/src/boundaries.jsonc` blocks forbidden imports
- `stackra validate --repository` checks tier tags
- planned — STA-340: the `contracts`-is-a-leaf and sibling-module boundary rules in `boundaries.jsonc`; STA-339: the `entries` validator check

## See Also

- ADR-0003: Tier dependency direction
- ADR-0004: Package archetypes and layers
- ADR-0294: Programming model v3 (groups, entries, sibling imports)
- ADR-0305: Programming model v3.1 (partners, one declaration per file, optional root modules, events, extensions)
- ADR-0141 (event names), ADR-0142 (transport drivers), ADR-0145 (tokens are classes), ADR-0231 (naming and casing standard)
- Constitution: boundaries (placement test)
