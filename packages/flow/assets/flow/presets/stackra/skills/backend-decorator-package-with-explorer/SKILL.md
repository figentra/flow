---
name: backend-decorator-package-with-explorer
description: Add a decorator or a kind base to a Stackra package in the programming model v3 - the three allowed decorator categories (field, method, class facet), createDecorator from @stackra/container registered with the kinds it may target, a kind declared as a base class the package exports, and the package's Explorer at src/<entry>/<pkg>.explorer.ts with its conformance test against stackra gen. Use when a package introduces or changes a decorator, a facet or a kind base.
---

# A decorator package with its Explorer

Each package owns its decorators and its kind bases (ADR 0117). A package that ships decorators also ships an
**Explorer**: at bootstrap it finds the decorated classes, fields and methods through the container's
`DiscoveryService` and registers them (ADR 0144). `stackra gen` reads the same facts statically, and a conformance test
proves the two agree. Decorators are TypeScript's legacy decorators over the container's own metadata store; there is
no global metadata polyfill (ADR 0005).

This is the v3 shape (ADR 0294, 0144 as amended) that `@stackra/container` implements; its docs win where they differ.

## First: decorator or base class?

| You need                                                              | Write                                                                |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| A new kind of declaration (a scheduled task, a price model, a report) | A **kind base** the package exports: `extends Report({ ... })`       |
| To constrain, transform, serialize, relate or source one field        | A **field decorator** (`@Str`, `@Trim`, `@Hidden`, `@Env`)           |
| An option on one workflow step or state transition                    | The existing **method decorators** `@Step` and `@Transition` only    |
| A table fact or a capability another package reads on a class         | A **class facet** (`@Index`, `@Searchable`, `@AccessLogged`)         |

The decorator test: if the folder, the suffix, the base class, a field type, a method name or a derived name already
says it, write no decorator. Kind decorators (`@OnSchedule`, `@Cron`, `@AsJob`, `@Command`, `@Processor` and the like),
parameter decorators, empty decorators and string tokens are banned. A new kind needs a row in ADR 0294's group and kind
tables before it is used: route the proposal to the ADR steward.

## Rules

1. Every decorator is made with `createDecorator` from `@stackra/container` and registered with the kinds it may
   target; lint (`facet-target`) refuses it elsewhere.
2. A decorator annotates; it never builds a value. Values are kind classes or config classes.
3. Options with two or more properties go one per line (lint `multiline-decorator-options`).
4. The Explorer lives at `src/<entry>/<pkg>.explorer.ts` (usually `src/node/`) and runs at bootstrap.
5. The decorator, its metadata type and the kind base are exported from the entry that owns them; a type that gen or
   another package reads also goes in `src/contracts/types/`.

## Worked example: the `@Searchable` facet in the search package

```ts
// src/core/decorators/searchable.decorator.ts
import { createDecorator } from "@stackra/container";
import type { SearchableOptions } from "#contracts/types/searchable-options.type";

/** Marks a model as indexed for search; read by the search Explorer and by gen. */
export const Searchable = createDecorator<SearchableOptions>({
  name: "searchable",
  category: DecoratorCategory.ClassFacet,
  targets: [Kind.Model],
});
```

```ts
// src/node/search.explorer.ts
import { DiscoveryService, type OnApplicationBootstrap } from "@stackra/container";
import { Searchable } from "#core/decorators/searchable.decorator";
import { SearchIndexRegistry } from "#core/services/search-index-registry.service";

/** Registers every searchable model's index at bootstrap. */
export class SearchExplorer implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly registry: SearchIndexRegistry,
  ) {}

  onApplicationBootstrap(): void {
    for (const { target, options } of this.discovery.classesWith(Searchable)) {
      this.registry.add(target, options);
    }
  }
}
```

```ts
// src/node/__tests__/search.explorer.test.ts — conformance with gen
it("registers what gen discovers", async () => {
  const app = await createTestingModule(FixtureModule).compile();
  const runtime = app.get(SearchIndexRegistry).keys();
  const generated = await discoverWithGen(FixtureModule, Searchable); // testing helper of the gen package
  expect(runtime).toEqual(generated.map((entry) => entry.key));
});
```

The consuming model stays declarative:

```ts
@Searchable({
  text: ["number", "tags.name"],
  filters: ["status", "createdAt"],
})
export class Order extends Model.with(HasPublicId("ord"), BelongsToTenant, Timestamps) {
  // ...
}
```

## Never

- A kind decorator, a parameter decorator or an empty decorator.
- A global registry populated at import time; registration happens in the Explorer at bootstrap.
- A separate `*-decorators` package; the package that owns the behaviour owns its decorators (ADR 0117).
- String or symbol DI tokens; classes are the only tokens (ADR 0145 as amended).

## Check

The conformance test above, `pnpm turbo run test typecheck build --filter=<package>`, then `pnpm verify`. Gen changes needed for a
new kind or facet go to `compiler-engineer`.
