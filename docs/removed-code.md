# Code removed because nothing called it

Removed on 2026-10-25, on the way to the STA-298 spike. None of it was reachable: the engine's
index exported none of these modules, and no package imported the renderer files. It came with
the imported earlier codebase (commit `f213a98`) or was written for slices that are not built.
Every file is still in git: restore one with `git show 4ec809b:<path>`.

| Path (at `4ec809b`)                         | Source lines | Test lines | Why it went                                                                                                                                                           |
| ------------------------------------------- | -----------: | ---------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine/src/gate/`                 |        1,878 |        697 | Merge, release and review gates. `pr:merge` stays the only merger (ADR 0286 d12); the release gate's four checks were `NOT_CHECKED` (backlog E-02). Spec 004's scope. |
| `packages/engine/src/metrics/`              |        2,230 |        353 | Lead, cycle and stage time, rework, rollback and the rest, computed from the ledger. No command reached them. Spec 005's scope.                                       |
| `packages/engine/src/policy/`               |        1,221 |        742 | Control resolver, policy reader, model-tier, risk-class, section-write and spec-size rules. The live Approval Policy is read by `@vellum/storage`. Spec 003's scope.   |
| `packages/engine/src/domain/`               |          312 |          0 | Decision and policy types used only by the folders above.                                                                                                             |
| `packages/renderers/src/cli-output.ts`      |          237 |          0 | The CLI formats its own output.                                                                                                                                       |
| `packages/renderers/src/json.ts`            |          224 |          0 | The storage queries build every `--json` document.                                                                                                                    |
| `packages/renderers/src/markdown.ts`        |          165 |          0 | No caller.                                                                                                                                                            |
| `packages/renderers/src/context.ts`         |          244 |          0 | An earlier context bundle; `vellum context` uses the engine's `buildTaskContext` (decision 17 in 002's design).                                                       |
| **Total**                                   |    **6,511** |  **1,792** |                                                                                                                                                                       |

`@vellum/renderers` now holds only the assistant dialects (`assistant.ts`), which the three
plugin packages use. Per ADR 0286 d6 the renderer layer belongs to `@stackra/renderers`; Vellum
switches to it once that package is published, and this package goes then.

Still unreachable and kept for now: most of `packages/engine/src/quality/` (EARS, glossary,
vague-term and planning checks; `coverage` and `buildTaskContext` use only its criterion and
property parsers) and the engine's per-folder `index.ts` barrels. Specs 003, 004 and 005 still
describe what was removed; they need cutting down to the approval and evidence scope before any
of it is rebuilt.
