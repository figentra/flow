---
name: frontend-resource-console
description: Build console screens as declarations in the programming model v3 - a class that extends Resource(Model, { navigation, operations }) in resources/<model>/ with table, form and infolist builders bound to actions, widgets as a query plus a display kind in typed slots, Widget.place, Document instead of @Page, notifications on the Messages tab, toasts, route folders with .error.tsx and .fallback.tsx, and path-bound overrides - rendered by @stackra/panel on @stackra/ui. Use for any admin, operator, tenant-admin or customer-portal screen.
---

# Console resources

Console screens are **declared by modules and rendered generically** (ADR 0164, 0294). A module declares a resource,
its widgets and documents in `resources/<model>/`; gen and the registry publish them; `@stackra/panel`, built on
`@stackra/ui`, draws them on web and native. Coded screens are the exception. Panels: platform admin, product
operator, tenant admin, customer portal.

This is the v3 shape that `@stackra/panel` and gen implement; the console is still a hello-world entry until STA-344
converts it. The package docs win where they differ.

## Decide first

| Need                                   | Use                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| List, view, create, edit a model       | `extends Resource(Model, { navigation, operations })` in `resources/<model>/`        |
| A dashboard tile, a stat, a chart      | `extends Widget({ slot, query, display })`: a query bound to a display kind          |
| Put a package's widget on your page    | `Widget.place(Base, { slot, params })`                                               |
| A saved, tenant-editable page          | `extends Document({ kind, path, blocks })` (`@Page` is retired, ADR 0110 as amended) |
| A tenant wants a different block       | An override at `overrides/<owner>/<block-or-widget>.override.tsx` (ADR 0234)         |
| Nothing above fits                     | A route folder in the app (escape hatch), reviewed by design and a11y               |

## Worked example

```ts
// src/modules/orders/resources/order/order.resource.ts
import { Resource } from "@stackra/panel";
import { CancelOrderAction } from "#modules/orders/actions/cancel-order.action";
import { Order } from "#modules/orders/models/order.model";

/** Orders in the tenant admin: List, View and Create; no Edit page, because there is no `update` operation. */
export class OrderResource extends Resource(Order, {
  navigation: { group: NavigationGroup.Sales, icon: "receipt", order: 10 },
  operations: { list: true, get: true, create: true },
}) {
  table = this.tableOf({
    columns: (t) => [t.text("number").sortable().searchable(), t.money("total").sortable(), t.enum("status")],
    filters: (f) => [f.enum("status"), f.dateRange("createdAt")],
    defaultSort: { createdAt: SortDirection.Desc },
  });

  actions = [CancelOrderAction]; // bound by reference; buttons hide when the policy denies

  toasts = { [CancelOrderAction.key]: "orders::toasts.order_cancelled" };
}
```

- **`operations`** says which pages exist and makes gen write the standard actions over `CrudService(Order)`; an
  operation needs a permission verb on `OrderPermissions` (ADR 0105, 0164 as amended).
- **Builders** (`table`, `form`, `infolist`, `relations`, `actions`, `bulkActions`, `toasts`) are the only builders in
  a module. Form keys are checked against the action's input; field types, validation and labels come from the types
  (ADR 0095 as amended), so the form repeats no rules.
- **Toasts** are transient messages (Filament's "notifications"); a **notification** in the same folder
  (`extends Notification({ category })` with its `.mail.tsx`) appears on the View page's Messages tab.
- **Widgets**: display kinds are Kpi, KpiGroup, Chart, Table, List, Progress, Timeline, View and Custom; only Custom
  takes a renderer. Slots are typed (`Slots.Orders.Order.List.Header`); `refreshEvery` is at least 30 seconds;
  `refreshOn` names integration events only (a domain event fails gen).

## Routes and components (ADR 0053, 0165, 0232 as amended)

- A route is a folder `routes/<name>/` with `<name>.route.ts` (`extends Route({ path, ... })` with `loader`, `submit`
  and `meta`), `<name>.tsx`, optional `<name>.error.tsx` (`ErrorBoundary`) and `<name>.fallback.tsx`
  (`HydrateFallback`), `<name>.server.ts` for server-only code and `__tests__/`. The class is never a component.
- A component is a folder `components/<name>/` with `<name>.tsx`, optional parts and `use-<name>.ts`, an `index.ts`
  that exports only the component and its Props, and `__tests__/`. No class components.
- Presentation (Page, Modal, Sheet, Drawer, FullScreen) is a route option; menus are `extends Menu({ kind })`.
- Code-based routes, compiled to React Router 7 on web and React Navigation on mobile; no file-system routing.

## Web rules

- Vite and React Router 7 framework mode; no other React framework (ADR 0165).
- HeroUI v3 through `@stackra/ui`; form adapters live in `@stackra/ui`, never in the app. No HeroUI Pro anywhere:
  free HeroUI and Stackra's own components only (ADR 0165, 0469).
- Strings are `<module>::key` i18n keys; logical properties; tokens only; light and dark (ADR 0080, 0231).
- Budgets: entry 200 KB gzipped, route chunk 100 KB, LCP 2.5 s, INP 200 ms, CLS 0.1 (ADR 0183).

## Never

- `@Resource`, `@Widget`, `@Page`, `@Route` or any other kind decorator.
- A hand-coded list or edit screen for a model that a resource covers.
- Business logic in a component; a button calls an action.
- Code, markup or expressions in tenant document or override data (ADR 0110).

## Check

`pnpm turbo run test typecheck build --filter=@figentra/console`, then `pnpm verify`. Review: `design-brand-reviewer`,
`accessibility-reviewer`, `performance-reviewer`.
