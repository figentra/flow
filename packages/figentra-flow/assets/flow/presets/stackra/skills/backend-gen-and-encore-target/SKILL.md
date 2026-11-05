---
name: backend-gen-and-encore-target
description: Understand and change what stackra gen reads and emits - discovery through each member's root module, the IR, the committed app-manifest.json and openapi.json, gen --check, inspect and diff, the generated Encore app in .stackra/encore (mode A and B), secrets and databases declared for Encore, migrations ordering, the asset collector, the desktop bridge and the generated gateway. Use when working on the generator, debugging generated output, or deciding where a runtime concern belongs.
---

# `stackra gen` and the Encore target

Authors write plain TypeScript with decorators. `stackra gen` turns the module graph into everything the runtime needs.
Encore.ts is the runtime, **as a generated target only** (ADR 0091, 0124): nothing outside `.stackra/` and the Encore
emitter knows about Encore. Gen lives in the developer category, `packages/developer` (`cli` and `gen`, ADR 0258).

## What gen reads (ADR 0090, 0144)

1. Each member declares its root module: `package.json` → `"stackra": { "module": "./src/<name>.module.ts" }`.
2. Gen imports the root module in Node and runs only the container's scan and plan steps. It never instantiates a
   provider; metadata comes from the container's store.
3. ts-morph reads only the request and response types of the handlers discovery found.
4. The Explorers read the same metadata at runtime; a conformance test proves gen and the Explorers agree.

## What gen emits

| Output                                  | Where                        | Committed? | ADR              |
| --------------------------------------- | ---------------------------- | ---------- | ---------------- |
| `app-manifest.json` (every endpoint, topic, subscription, cron, route, area, middleware chain, asset, capability) | member root | yes | 0091, 0158, 0237 |
| `openapi.json`                          | member root                  | yes        | 0158             |
| The Encore app: `encore.app`, one `encore.service.ts` per service, `api()`, `Topic`, `Subscription`, `CronJob` adapters that call built service packages through the container | `.stackra/encore/` | no (gitignored) | 0091 |
| Encore `secret()` declarations from config `secret('<PROVIDER>_<PURPOSE>')` refs | `.stackra/encore/` | no | 0146 D5 |
| MikroORM `EntitySchema` and ordered SQL migrations | generated / migration stream | migrations yes | 0097, 0159 |
| The `AssetKey` union and the manifest's assets section | `.stackra/` | no | 0234 |
| The typed IPC bridge and allow-list from `@DesktopAction`, the capability and offline maps, the PWA manifest, electron-builder config | app target | no | 0249–0251 |
| The gateway layers: one auth handler (ZITADEL → Actor), CORS per area, request id, per-endpoint middleware ordered by phase | `.stackra/encore/` | no | 0237 |
| The TypeScript and Python clients      | generated from the manifest in the repository; CI-published for outside consumers | never | 0158, 0260 |

## The loop

- `stackra dev` = `gen --watch` + `encore run` (+ a small compose file with ZITADEL, ADR 0199).
- Mode B (dev): `gen --watch --src` makes `.stackra/encore` import service **source** through generated TypeScript
  `paths`; the generated `tsconfig.json` sets `experimentalDecorators` and `useDefineForClassFields: false`; a
  `<svc>/dist-stamp.ts` hash file inside the app root makes Encore notice changes. Production and CI import built `dist`.
- `stackra build` = gen + `encore build docker`, only in CI deploy and release jobs (ADR 0168).
- `stackra gen --check` fails CI when `app-manifest.json` or `openapi.json` is stale.
- `stackra inspect <kind> [key]` prints the manifest; `stackra diff <base>` classifies contract changes and raises the
  change risk; a breaking change without a new version or deprecation fails CI (ADR 0157).

## The validation pass (ADR 0090, 0098, 0131, 0141)

Gen fails on: a duplicate path; an action without a permission, risk or `actors`; an `@AsTool` on L4 without approval;
an unversioned or unregistered event name; exposed PII; a module key collision; a contribution with no owning module; a
resource bound to a missing action; an unknown asset kind folder; an undeclared IPC channel.

## When you need Encore itself

Read the fenced reference in `.agents/reference/encore/` (ADR 0258): it shows what the emitter must produce. It is wrong
for authoring: never copy its `api()`, `encore.service.ts`, `~encore/clients` or `APIError` code into a member.

## Where does it belong?

| Concern                               | Author it as                                          |
| ------------------------------------- | ----------------------------------------------------- |
| An endpoint                           | `@Action`/`@Query` + `@AsEndpoint`                    |
| A raw webhook or stream               | `@Controller` in `raw/`                               |
| A subscription                        | `@OnEvent` on a versioned event       |
| A cron                                | `@Cron` or a scheduler decorator                      |
| A secret                              | `secret('<PROVIDER>_<PURPOSE>')` in `config/<pkg>.config.ts`           |
| A database                            | the service's database module; gen declares one per service (ADR 0238) |
| Auth, CORS, rate limits               | the generated gateway and the action pipeline, never per endpoint code |

## Never

- An `encore.*` file, a `__generated__/` folder or an `encore.dev` import in a member.
- A hand edit to anything gen emits; fix the emitter or the declaration.
- A committed client.

## Check

`stackra gen --check`, the gen golden tests and the conformance test, then `pnpm verify`. Review:
`architecture-guardian` for any emitter change.
