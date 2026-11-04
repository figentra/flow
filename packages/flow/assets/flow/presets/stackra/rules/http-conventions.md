---
title: HTTP Conventions
always: true
description: HTTP API conventions for Stackra services (authored as action and query classes; endpoints derived by convention; Encore is generated)
---

# HTTP Conventions

Services are plain TypeScript. You never write `encore.dev`, `api()` or `encore.service.ts` in a service: behaviour is
an action or a query class (ADR 0098 as amended by 0294), and `stackra gen` emits the Encore `api()` adapters into the
gitignored `.stackra/encore/` (ADR 0091, 0124). The rules below are what the generated endpoints must satisfy, so they
shape how you author actions.

The programming model v3 (ADR 0294) is what `@stackra/actions` and gen implement (shipped since 0.3.0); the package
docs win where they differ. Core's own `services/example` and `services/health` keep the older shape until STA-344.

## Action or query

| Question       | Action                              | Query                                   |
| -------------- | ----------------------------------- | --------------------------------------- |
| Changes state? | Yes: `extends Action({ key, ... })` | No: `extends Query({ key, ... })`       |
| Risk           | From its permission, L0 to L4       | From its permission, L0 or L1 only      |
| HTTP method    | `POST`, `PUT`, `PATCH` or `DELETE`  | `GET`                                   |
| MCP tool       | Only with `tool: true`              | Yes, under the caller's own permissions |
| Cache          | Never                               | May take a `cache` option (ADR 0305)    |
| Preconditions  | `preconditions: [...]`              | None                                    |

## Endpoints

An action or query is exposed over HTTP by convention: gen derives the route from its key, so nothing is declared per
action (ADR 0294 decision 21, ADR 0217 as amended). Input and output are the parameter and return types of `handle`.
A raw endpoint that is not an action (`/api/auth/*`, streaming) is a class that extends `Controller({ path })`, in
the module's `raw/` group; the `@Controller` decorator is retired (ADR 0294). An inbound webhook is a `WebhookEvent<Integration>({ type })`
class (ADR 0308).

| Key                                    | Route                       |
| -------------------------------------- | --------------------------- |
| `x.list`                               | `GET /xs`                   |
| `x.get`                                | `GET /xs/:xId`              |
| `x.create`                             | `POST /xs`                  |
| `x.update`                             | `PATCH /xs/:xId`            |
| `x.delete`                             | `DELETE /xs/:xId`           |
| Any other action verb, input has `xId` | `PUT /xs/:xId/<verb-kebab>` |
| Any other action verb, otherwise       | `POST /xs/<verb-kebab>`     |
| Any other query name                   | `GET /xs/<name-kebab>`      |

`endpoint: { method, path }` overrides the route and `endpoint: false` removes it. An action whose actors include
neither a user nor an agent gets no public endpoint.

```typescript
// src/modules/orders/schemas/cancel-order-input.schema.ts — the input, one declaration per file (ADR 0305)
export class CancelOrderInput extends Schema {
  orderId!: PublicId<"ord">;
}
```

```typescript
// src/modules/orders/actions/cancel-order.action.ts — orders.order.cancel@1, PUT /orders/:orderId/cancel
import type { CancelOrderInput } from "#modules/orders/schemas/cancel-order-input.schema";
import type { CancelOrderOutput } from "#modules/orders/schemas/cancel-order-output.schema";

export class CancelOrderAction extends Action({
  key: "order.cancel",
  actors: [ActorKind.User, ActorKind.Agent],
}) {
  constructor(private readonly orders: OrderService) {
    super();
  }

  async handle(input: CancelOrderInput, ctx: ActionContext): Promise<CancelOrderOutput> {
    const order = await this.orders.findOneOrFail(input.orderId);
    await ctx.authorize(order); // the permission from the key, refined by OrderPolicy#cancel
    // ...
  }
}
```

## Methods

HTTP methods **by idempotency**:

- `GET` - Safe, idempotent, no body (queries only)
- `PUT` - Idempotent state transition (`/archive`, `/activate`), per the HTTP and events law
- `DELETE` - Idempotent
- `POST` - Non-idempotent, creates resources
- `PATCH` - Non-idempotent, partial update

## Authentication

Every endpoint is authenticated by default. A public endpoint opts out explicitly with `auth: false` in the action's
or query's options; the flag applies to its API area (ADR 0082), and the gateway enforces it (ADR 0237):

```typescript
export class GetHealthQuery extends Query({ key: "health.get", auth: false }) {
  async handle(): Promise<HealthOutput> {
    // ...
  }
}
```

The caller is the typed `Actor` the action pipeline provides (ADR 0098); never read a user id from the request body.
The permission is derived from the key, and record rules run through `ctx.authorize(record)` (ADR 0132 as amended).

## Request/Response

### Always typed

Input and output are `Schema` classes whose TypeScript types are the rules (ADR 0095 as amended by 0294). Each Input and Output is its own file in `schemas/` (ADR 0305). A `number`
carries `@Int` or `@Num`; constraints are `@Str`, `@Int`, `@Num` and `@List`. Gen compiles each class to one Zod schema
in `#stackra/schemas`; authors write no Zod except through the `@Field(zod)` escape hatch with a `// reason:` comment.

```typescript
export class UserView extends Schema {
  id!: PublicId<"usr">;

  email!: Email;

  createdAt!: Date; // ISO 8601 on the wire
}
```

### Cursor pagination

```typescript
export class ListUsersInput extends CursorInput {} // cursor, limit 1–100 (default 20)

export class ListUsersOutput extends Page.of(UserView) {} // items, nextCursor, hasMore
```

### Prefixed IDs

Use prefixed ids externally (`usr_01H2J3K4L5M6N7P8Q9R0`, typed `PublicId<"usr">`); never expose database ids.

## Idempotency

Non-GET operations support the `Idempotency-Key` header. The action pipeline has an idempotency step (ADR 0098, 0138),
so an action declares `idempotency:` in its options and the pipeline deduplicates; do not hand-roll key storage in a
handler. The pipeline order is tenancy, then (inside the `CallIsolation` transaction, ADR 0495) permission, precondition, entitlement, flag, idempotency, interceptors, then
`handle` (ADR 0138 as amended).

## Versioning

**Versioned events, not endpoints.**

- Endpoints are immutable (no `/v1`, `/v2`)
- An integration event writes its `name` once; gen derives `<module-key>.<name>.v<n>` (`identity.user.created.v1`, ADR 0141 as amended). A breaking change sets `version: n` and adds a `Change<Subject>({ ... })` class beside the event (ADR 0305)
- New endpoint → new path
- API versions are dates: the `Stackra-Version` header, pinned per API key or OAuth app, through the dormant `@stackra/versioning` package. Paths stay unversioned (`/adr/0118-api-versioning-dormant-package`)

## Error Handling

Throw a typed error from the action: a class that extends `Refusal({ kind })`, whose code is derived from its name
(`OrderNotPayableError` → `order_not_payable`). The generated adapter maps it to the matching HTTP status (not found,
permission denied, invalid argument, precondition failed, and so on). The error envelope and its kinds follow ADR 0140.
Never build HTTP responses by hand and never import `APIError` in a service.

## Enforcement

- `stackra validate --repository` (`checkService`) refuses Encore files in a service (ADR 0124)
- planned — STA-340: the gen checks for an endpoint collision, GET on an action or non-GET on a query, a query above
  L1, `cache` on an action and a precondition on a query; until gen ships, review (`api-contract-reviewer`) checks this
  rule

## See Also

- Constitution: http-and-events
- ADR-0091, ADR-0124: Encore is generated into `.stackra/encore`
- ADR-0294: programming model v3 (kinds, endpoint convention, derived identities); ADR-0098: actions are the unit
- ADR-0010: Services are independent members
- ADR-0082 (API areas and auth), ADR-0237 (generated gateway), ADR-0140 (error envelope), ADR-0141 (event names)
- Standards: api-contracts
