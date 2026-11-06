---
name: db-models-and-migrations
description: Model and migrate data in Stackra (programming model v3) - model classes that extend Model.with(...traits) with typed fields, relation decorators with thunks, Ref, Link and Collection, a Postgres schema per module, classification, the EntitySchema gen emits for MikroORM, state machines, @stackra/database as the only ORM importer, gen-ordered SQL migrations with expand-and-contract and timeouts, the raw SQL rule and approved extensions, row-level security as equality on tenant_id, one logical database per service, and factories, seeders and migrations in database/. Use when adding or changing a model, field, index, migration, RLS policy or seed.
---

# Models and migrations

MikroORM is the one ORM, it runs only on the server, and only `@stackra/database` imports `@mikro-orm/*` (ADR 0014,
0097). You write model classes whose TypeScript types are the columns; `stackra gen` emits the MikroORM `EntitySchema`
and orders the SQL migrations (ADR 0294 rule R4).

This is the v3 shape that `@stackra/model`, `@stackra/database` and gen implement; the package docs win where they
differ.

## Worked example: an order line

```ts
// src/modules/orders/models/order-line.model.ts — key `orders.order_line`, table `orders.order_lines`, ids `oln_…`
import { type Link, ManyToOne, Model, OnDelete, type Ref } from "@stackra/model";
import { BelongsToTenant, HasPublicId } from "@stackra/model/traits";
import type { Money } from "@stackra/money";
import { Int } from "@stackra/validation";
import { Variant } from "#modules/catalogue/models/variant.model";
import { Order } from "#modules/orders/models/order.model";

/** One product line, priced at placement. */
export class OrderLine extends Model.with(HasPublicId("oln"), BelongsToTenant) {
  /** Same module: a foreign key `fk_order_lines_order_id`, cascade on delete. */
  @ManyToOne(() => Order, { onDelete: OnDelete.Cascade })
  order!: Ref<Order>;

  /** Another module's model: a link (indexed `variant_id`, no foreign key); `load()` runs its query. */
  @ManyToOne(() => Variant)
  variant!: Link<Variant>;

  @Int({ min: 1 })
  quantity!: number;

  unitPrice!: Money; // two columns: unit_price_minor (bigint, read as a number), unit_price_currency
}
```

- **The type is the column.** `?:` is optional, `| null` is nullable, the initializer is the default. A `number` needs
  `@Int` or `@Num`. A literal union or `any` fails gen: use an `Enum.of` enum or a `Schema` class (ADR 0095 as amended).
- **Keys are derived** (`<module>.<snake(Class)>`, table snake_case plural in the module's Postgres schema, so
  `orders.tags` and `catalogue.tags` can both exist) and locked in `stackra.manifest.json`; a rename of a class or field
  needs `@Renamed(old)` (ADR 0133 as amended, ADR 0294 decision 20).
- **Relations** use thunks: `@ManyToOne(() => X)`, `@OneToMany`, `@ManyToMany` (declared on one side, `owner: true`),
  `@OneToOne`, typed `Ref<T>` or `new Collection<T>(this)` inside one module. A relation to another module's model is
  typed `Link<T>`: an indexed id column with no foreign key, join or cascade, and gen fails when the type and the
  module ownership disagree; `@Link` and `links/` are retired (ADR 0104 as amended, ADR 0294 decision 28).
- **No constructor-made state.** A loaded row skips the constructor, so no `#private` fields or transient initializers;
  narrow a trait field with `declare`; build models with `em.create`, a factory or `CrudService`, never `new`
  (ADR 0294 decision 27).
- **Facets**: `@Index([...], { unique })`, `@Searchable({ ... })`, `@Auditable`.
- **Status fields** are governed by a `StateMachine(Model, { field })` class in `models/<model>.state-machine.ts` with
  `@Transition({ from, to })` methods; nothing else writes the field (ADR 0161 as amended).
- Every field carries a classification before it stores personal data (ADR 0134); public ids are `<prefix>_<26>` over
  a UUIDv7 and the database id never leaves the service (ADR 0135); indexes, foreign keys and check constraints are
  named `idx_`, `fk_` and `ck_` (ADR 0231 as amended).
- `Money` is stored in minor units in a `bigint` column read as a JavaScript `number`; the money type refuses a value
  above `Number.MAX_SAFE_INTEGER`.
- Lists: cursor pagination by default; eager loading or the DataLoader, never N+1.

## Tenancy (ADR 0239, `.agents/rules/tenancy.md`)

A tenant-owned table has `tenant_id`, row-level security **enabled and forced**, and one **equality** policy on
`tenant_id`. No tree logic in a policy; organisation and parent views come from read models built by audited jobs
(ADR 0163, 0239). The application layer scopes too: two layers, always. An isolation test proves tenant B sees nothing
of tenant A and an unscoped query returns zero rows.

## Migrations (ADR 0159)

Write each migration by hand (`stackra db diff`, which will write them, is not built yet: STA-1808) to the module's
`database/migrations/NNNN-<name>.migration.ts`, numbered per module from `0001` with no gaps (see
`packages/runtime/workflow/src/node/database/migrations/`), as a class that extends `Migration`; it changes only that module's schema. Gen orders
the streams, including migrations shipped in packages, into the host's ordered SQL (modules in dependency order, then by
number); Encore's runner applies them in SaaS, a pre-upgrade job on-prem. A migration has **no `down()`** (ADR 0159 as
amended).

1. **Expand and contract.** Add the new column, backfill, switch reads, and only in a later release drop the old one.
2. **Timeouts** on every migration: lock and statement.
3. **Concurrent index builds** in their own migration.
4. **Backfills** run as queue jobs, never inside the migration.
5. **Forward fix only.** Data is never rolled back by a migration.
6. The squawk lint runs in CI.

```sql
-- src/modules/orders/database/migrations/0003-add-order-due-at.migration.ts (expand), the SQL it runs
SET lock_timeout = '3s'; SET statement_timeout = '30s';
ALTER TABLE orders.orders ADD COLUMN due_at timestamptz;
-- src/modules/orders/database/migrations/0004-index-order-due-at.migration.ts (its own migration)
CREATE INDEX CONCURRENTLY idx_orders_tenant_id_due_at ON orders.orders (tenant_id, due_at);
```

## Raw SQL (ADR 0160)

Only in a module service method of `@stackra/database`, parameterised, typed by a `Schema` class, under the RLS
session, with a `// raw-sql:` comment giving the reason. Actions contain no SQL. Approved extensions: pgvector, pg_trgm, ltree, citext,
pgcrypto and PostGIS (0160, 0314).

## Databases (ADR 0238)

One Postgres server per environment; one logical database and one role per service, in every topology, with one
Postgres schema per module inside it. No service reads another service's tables; use its client or its events
(ADR 0014, 0142).

## Factories and seeders (ADR 0190 as amended)

- A factory is `database/factories/<model>.factory.ts`, `extends Factory(Model)`, with `definition()` and states; a
  model names no factory (`HasFactory` is retired). Factories are exported only from a package's `./testing` entry.
- A seeder is `database/seeders/minimal.seeder.ts`, `demo.seeder.ts` (the golden tenant) or `test.seeder.ts`; the file
  name is the profile and the identity is `<module>.<profile>`. It declares the public ids it creates in `static ids`,
  and other members read them through the generated client; no other file types a public id. A `minimal` seeder
  imports no factory. Synthetic data only.

## Never

- Another ORM or query builder, MikroORM decorators in a model, or `@Model`, `@MoneyColumn`, `@HasState`, `@Json` or
  `@Link` (retired).
- A `down()` in a migration, or a plain `number` field without `@Int` or `@Num`.
- A migration that drops or rewrites data in the same release that stops using it.
- An ORM on a client (client data is `@stackra/storage`, ADR 0256).
- A policy that walks the tenant tree.

## Check

`pnpm turbo run test --filter=<member>` (with the `.int` tier against Testcontainers), `stackra gen --check` once gen ships, then
`pnpm verify`. Review: `security-tenancy-reviewer` for any tenant-owned table, RLS policy or personal-data field.
