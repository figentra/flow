# Vellum

Vellum is the spec CLI for Stackra repositories. It runs spec-driven development on
[GitHub spec-kit](https://github.com/github/spec-kit): it installs spec-kit's `.specify/` folder with the Stackra
preset, renders the `speckit-*` skills for Claude Code and OpenCode, and holds the gates that keep each spec, its plan,
its tasks and its tests in step. It is one package, `@stackra/vellum`, with one binary, `vellum`, published only to
the Stackra registry (`npm.stackra.figentra.com`, ADR 0453).

```sh
pnpm add -D @stackra/vellum   # with @stackra:registry=https://npm.stackra.figentra.com/ in .npmrc
pnpm exec vellum init         # .specify/ with the Stackra preset
pnpm exec vellum sync         # install the preset and render the speckit skills (needs the pinned `specify`)
```

## Commands

| Command                                              | What it does                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `vellum init [--force]`                              | installs `.specify/` (spec-kit 1.0.10, the Stackra preset, the gate in `setup-plan.sh`)            |
| `vellum sync`                                        | installs the preset through `specify`, keeps the bundled workflow off, renders OpenCode and Claude |
| `vellum gate plan <spec.md>`                         | exits 1 until the spec may be planned (run by `setup-plan.sh`)                                     |
| `vellum gate check <dir>` / `tasks <tasks.md>`       | the stage rules for the spec's `**Status**`; the tasks lint                                        |
| `vellum gate lane` / `branch` / `ci` / `dir`         | the lane check, the branch warning, the CI gate with the spec-kit tripwire, the spec folder        |
| `vellum trace trace <dir>` / `drift` / `ci`          | the FR/P → task → `@covers` test matrix, spec-vs-diff drift, the Done rules                        |
| `vellum parse <file>`                                | what the parsers read from a `spec.md`, `plan.md`, `tasks.md` or `routing.yaml`, as JSON           |
| `vellum linear issue <spec.md>` / `tasks <tasks.md>` | the spec's Linear issue and one sub-issue per task; `--dry-run` needs no token                     |

A repository keeps one-line aliases: `"spec:gate": "vellum gate"`, `"spec:trace": "vellum trace"`,
`"speckit:sync": "vellum sync"`, and `"spec:linear": "infisical run --env=dev --path=/agents --silent -- vellum linear"`.
`vellum linear` reads its token from the environment only (`LINEAR_AGENT_TOKEN`, else `LINEAR_API_KEY`) and never
prints it.

## The flow

Every spec lives in `.agents/specs/sta-<n>-<slug>/`, named by its Linear issue. spec-kit has no project-wide setting
for the folder, so each wrapped command first runs `vellum gate dir`, which reads the key from the branch name and
writes `.specify/feature.json`.

States: **Draft → Clarified → Planned → Tasked → Implementing → Done**, or Abandoned / Superseded. A status may lag
behind its artifacts, never run ahead of them.

| Status       | `vellum gate check` requires                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| Draft        | folder `sta-<n>-<slug>`; a `**Linear**` key, when set, equal to the folder's                                    |
| Clarified    | clarifications complete, a real key, every Impact line answered, no `[NEEDS CLARIFICATION`, a history line      |
| Planned      | `plan.md`: Constitution Check rows PASS or N/A with a reason, three deploy-mode rows, every FR validated by a P |
| Tasked       | `tasks.md` passes `vellum gate tasks`: ids, `covers:`, `route:`, acyclic `deps:`, full coverage, safe waves     |
| Implementing | at least one task ticked; `vellum trace drift`: the diff only touches members Impact names                      |
| Done         | every live task ticked; every FR and P covered by a test tagged `@covers sta-<n>:FR-001`; every SC has a method |

Lanes: **full** (a design PR, then one PR per user-story phase), **lite** (a small R0–R1 feature in one PR), **bug**
(`.specify/bugs/sta-<n>-<slug>/` with a regression test tagged `@covers sta-<n>:BUG`) and **chore** (no spec).
`vellum gate lane` fails a `feat` commit that no lite or full spec reaches through the branch key or a `Refs:` key.

Traceability runs FR/SC → P-### (plan properties, `Validates: FR-003`) → T### (`covers:`, `route:`, `deps:`) →
tests (`@covers`) → commits (`Refs: STA-n`) → PR. `vellum trace ci` makes it a gate.

The tripwire in `vellum gate ci` catches a spec-kit upgrade that breaks the Stackra wrap: the gate call in
`setup-plan.sh`, `common.sh` resolving `SPECIFY_FEATURE_DIRECTORY`, `linear-key` numbering, the wrap markers in every
rendered command, the installed preset equal to its source, and the bundled `speckit` workflow kept disabled.

`.specify/` keeps its name because spec-kit's `specify` CLI and the skills expect it. A later `vellum migrate` moves it
to `.vellum/` once Vellum replaces spec-kit rather than wrapping it.

## Develop

`pnpm install`, then `pnpm verify` (format, lint, typecheck, test, build). Release notes go in `.changeset/`. See
[AGENTS.md](AGENTS.md).

MIT licence.
