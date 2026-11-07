---
title: Task vocabulary
description: The fixed set of package.json script names every member uses, and the root commands that fan them out.
always: false
applies_to: ["**/package.json", "turbo.jsonc"]
manual: false
---

# Task vocabulary

Members use these names and no synonyms (`tsc`, `check-types`, `fmt`, `cov`, `serve` are wrong):

| Script                                                           | Meaning                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`                                                            | local watch/serve (apps, services)                                                                                                                                                                                |
| `build`                                                          | produce `dist/` (or the app bundle)                                                                                                                                                                               |
| `typecheck`                                                      | type check only, no emit                                                                                                                                                                                          |
| `lint`                                                           | oxlint                                                                                                                                                                                                            |
| `test`, `test:coverage`, `test:int`, `test:contract`, `test:e2e` | vitest; test tiers are marked by filename infix (`.int`, `.contract`, `.e2e`, `.load`) per [0182](/adr/0182-testing-strategy-v2-tiers-coverage-infrastructure-and-policies); coverage runs for `packages/**` only |
| `format`, `format:check`                                         | oxfmt write / verify                                                                                                                                                                                              |
| `clean`                                                          | remove build output                                                                                                                                                                                               |
| `gen`                                                            | `stackra gen` in the member: `.stackra/` and `stackra.manifest.json` (services, workers); typecheck and the test tiers wait for it                                                                                |

A member declares only the scripts it has work for (a docs app has no `typecheck`; `tooling` presets have no
`build`). Services and apps also have `start`; Expo has `ios`, `android`, `doctor`; docs has `a11y`.

Root: `pnpm build|typecheck|lint|test|clean` run `turbo run <task>`. `pnpm gen` runs `turbo run gen:workspace gen`:
`gen:workspace` is the root-only `stackra gen` pass over every member with a `stackra.config.ts`, and `gen` each
member's own. Root `pnpm format|format:check` run oxfmt
over the whole repository (root files included) plus shfmt on `*.sh`, not turbo. `pnpm check` is
format:check + lint + typecheck. `pnpm verify` is the full gate (add `validate`, `boundaries`, `knip`);
`pnpm verify:affected` limits it to changed members. Run one member's tasks with
`pnpm turbo run <task> --filter=<name>` (e.g. `pnpm turbo run test --filter=<name>`): turbo runs `gen` first. A bare
`pnpm --filter <name> test` skips `stackra gen`, so vitest cannot load the generated `.stackra/vitest.config`. A pull
request's `Needs testing:` line names the same command, e.g. `Needs testing: pnpm turbo run test --filter=<name>`.

A new task name goes in `turbo.jsonc` and in every member of that shape together.

Enforcement: `stackra validate --repository` checks the script set per member shape; `turbo.jsonc` is the
task graph.
