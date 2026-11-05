---
name: backend-author-an-action
description: Write a Stackra action or query in the programming model v3 - a class that extends Action({ key }) or Query({ key }), input and output from the handle signature, the permission and endpoint derived from the key, risk from the permission, actors, preconditions, idempotency, tool, job and endpoint options, ctx.authorize, ctx.run, refusals and events through the outbox. Use whenever a service or package adds or changes behaviour, an endpoint, an MCP tool, a job or an event reaction.
---

# Author an action

Behaviour in Stackra is an **action** (a write) or a **query** (a read) (ADR 0098, 0294). One class drives REST, MCP,
the CLI, jobs, the console and the generated clients (ADR 0217); `stackra gen` emits the Encore adapters (ADR 0091).
You never write `api()`, a controller for business behaviour, or an HTTP response by hand.

This is the v3 shape (ADR 0294) that `@stackra/actions` and gen implement; core's own example and health services keep
the older shape until STA-344. The package docs win where they differ.

## Decide first

| Question                            | Answer                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Does it change state?               | Yes: `extends Action({ key })` in `actions/`. No: `extends Query({ key })` in `queries/`.     |
| Several steps, waits, compensation? | Still one action; it calls `ctx.run(SomeWorkflow, input)` only when the ADR 0101 criteria hit. |
| Risk (ADR 0099)                     | Set on the permission, not the action: `static readonly cancel = Permission.L2`.               |
| Who may call it?                    | `actors: [ActorKind.User, ActorKind.Agent, ...]`; any other actor is refused.                  |
| May it run right now?               | `preconditions: [AcceptingOrdersPrecondition]` (store paused, maintenance), never a "guard".   |
| Exposed how?                        | HTTP by convention from the key; MCP with `tool: true`; a queue or cron with `job:`.           |

## Worked example: cancel an order

```ts
// src/modules/orders/actions/cancel-order.action.ts
import { Action, type ActionContext } from "@stackra/actions";
import { ActorKind, type PublicId } from "@stackra/contracts";
import { Schema } from "@stackra/validation";
import { CancelReason } from "#modules/orders/enums/cancel-reason.enum";
import type { OrderStatus } from "#modules/orders/enums/order-status.enum";
import { OrderStateMachine } from "#modules/orders/models/order.state-machine";
import { OrderService } from "#modules/orders/services/order.service";

/** Which order to cancel. */
export class CancelOrderInput extends Schema {
  orderId!: PublicId<"ord">;
}

/** The order after the cancel. */
export class CancelOrderOutput extends Schema {
  orderId!: PublicId<"ord">;

  status!: OrderStatus;
}

/** `orders.order.cancel@1`; permission `OrderPermissions.cancel`; `PUT /orders/:orderId/cancel`. */
export class CancelOrderAction extends Action({
  key: "order.cancel",
  actors: [ActorKind.User, ActorKind.Agent],
  tool: true,
}) {
  constructor(
    private readonly orders: OrderService,
    private readonly lifecycle: OrderStateMachine,
  ) {
    super();
  }

  async handle(input: CancelOrderInput, ctx: ActionContext): Promise<CancelOrderOutput> {
    const order = await this.orders.findOneOrFail(input.orderId);
    await ctx.authorize(order); // the permission from the key, refined by OrderPolicy#cancel
    this.lifecycle.cancel(order, CancelReason.Staff); // records OrderCancelled through the outbox
    return { orderId: order.id, status: order.status };
  }
}
```

What gen derives, so you never write it:

- **Key** `orders.order.cancel@1`: the module key, the written `key`, and `@1` unless `version:` is set.
- **Permission** `orders.order.cancel`, the `cancel` static of `OrderPermissions` in `access/order.permissions.ts`; its
  risk is the action's risk.
- **Endpoint** by the convention in `http-conventions`; override with `endpoint: { method, path }` or remove with
  `endpoint: false`.
- **Input and output** from the `handle` signature, compiled to Zod in `#stackra/schemas`. Companion `Input` and
  `Output` classes stay in the action file until a second file needs them (then `schemas/`).
- **The class name** `CancelOrderAction` matches the file `cancel-order.action.ts`.

Other options: `idempotency: Idempotency.Required`, `job:` (a queue or cron schedule; jobs are actions, not a kind),
`intents: [...]` (palette and AI triggers), `auth: false` (a public endpoint), `version: 2`.

## What the pipeline does for you (ADR 0138 as amended)

tenancy → permission → precondition → entitlement → flag → idempotency → interceptors → `handle`. Do not re-implement
any step in `handle()`:

- **Tenant and actor** come from `ctx`, never from the input (ADR 0136).
- **Record rules** run inside `handle` through `ctx.authorize(record)`, which calls the policy method named after the
  permission verb.
- **Idempotency**: client writes send `Idempotency-Key`; a reused key with a different payload is `409`. Never store keys.
- **Transaction**: one per action; events go through the outbox inside it; `ctx.afterCommit(() => ...)` for external
  calls. A workflow starts with `ctx.run(Workflow, input)`.
- **Refusals** have stable snake_case codes (ADR 0137, 0140); a refused precondition is `precondition_failed`.

## Queries

```ts
// src/modules/orders/queries/list-orders.query.ts — orders.order.list@1, GET /orders, an MCP tool
export class ListOrdersInput extends CursorInput {
  status?: OrderStatus;
}

export class ListOrdersOutput extends Page.of(OrderView) {}

export class ListOrdersQuery extends Query({ key: "order.list", actors: [ActorKind.User, ActorKind.Agent] }) {
  constructor(private readonly orders: OrderService) {
    super();
  }

  async handle(input: ListOrdersInput, ctx: QueryContext): Promise<ListOrdersOutput> {
    // cursor pagination, capped limit, allow-listed sorts
  }
}
```

A query's permission is `<Model>Permissions.read` (L0 or L1); it is an MCP tool automatically, takes no preconditions
and may take a cache profile. See the skill `ai-mcp-tools`.

## Errors

Throw a class that extends `Refusal({ kind })` from `errors/`, named `<Reason>Error`; its code is derived
(`OrderNotPayableError` → `order_not_payable`). The transport mapping is generated from the kind (skill
`backend-errors`, ADR 0140, 0232).

## Versions

A breaking change is `version: 2` beside the `@1` class, and public versions get a deprecation with a sunset of at least
six months (ADR 0131, 0136). Never change the shape of a published version.

## Never

- `@Action`, `@Query`, `@AsEndpoint`, `@AsTool`, `@AsJob` or any other kind decorator: the base class is the kind.
- A hand-written `key` prefix, permission string, risk level or route that gen derives.
- `api()`, `encore.service.ts`, `APIError`, or any Encore import in a member (ADR 0124).
- A controller for business behaviour, or the retired `@Controller` decorator. A raw endpoint (`/api/auth/*`,
  streaming) is a class that extends `Controller({ path })` in `raw/`. An inbound webhook is a `WebhookEvent` class.
- Reading tenant, actor or user id from the body, query or a client header.
- Zod in a member, except the `@Field(zod)` escape hatch with a `// reason:` comment.

## Check

`pnpm --filter <member> test typecheck build`, then `pnpm verify` (and `stackra gen --check` once gen ships). Review:
`api-contract-reviewer`.
