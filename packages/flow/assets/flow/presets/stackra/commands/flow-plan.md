---
description: Plan the feature and split it into PR-sized tasks; refuses until the spec gate passes.
derived-from: github/spec-kit 1.0.10 (MIT)
---

## Stackra: feature directory (runs first)

Specs live in `.agents/specs/sta-<n>-<slug>/` (ADR 0120 D1), never in `specs/`. Before anything else run
`pnpm spec:gate dir` (add `--key STA-n` when the branch name carries no key). It prints the
spec folder for the branch's Linear key and writes `.flow/current.json`, which every `fflow spec` call reads. If it fails,
STOP and report it; never fall back to a numbered folder.

## Stackra: gate (runs first)

`fflow spec setup-plan` runs the plan gate and exits non-zero until the spec has
`**Clarifications status**: complete`, a `**Linear**: STA-n` key and a fully answered `## Impact`
section. If it fails, STOP: print its output, tell the user to run `/flow-clarify`, and write
nothing. Never edit the marker yourself to get past the gate.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

1. **Setup**: Run `fflow spec setup-plan --json` from repo root and parse its JSON for `data.FEATURE_SPEC`, `data.IMPL_PLAN`, `data.FEATURE_DIR` and `data.BRANCH` (the fields are under `data`). For single quotes in args like "I'm Groot", use escape syntax: e.g 'I'\''m Groot' (or double-quote if possible: "I'm Groot").

2. **Load context**: Read FEATURE_SPEC and `.flow/constitution.md`. Load IMPL_PLAN template (already copied).

3. **Execute plan workflow**: Follow the structure in IMPL_PLAN template to:
   - Fill Technical Context (mark unknowns as "NEEDS CLARIFICATION")
   - Fill Constitution Check section from constitution
   - Evaluate gates (ERROR if violations unjustified)
   - Phase 0: Generate research.md (resolve all NEEDS CLARIFICATION)
   - Phase 1: Generate data-model.md, contracts/, quickstart.md
   - Re-evaluate Constitution Check post-design

## Completion Report

Command ends after Phase 1 design. Report branch, IMPL_PLAN path, and generated artifacts.

## Phases

### Phase 0: Outline & Research

1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Generate and dispatch research agents**:

   ```text
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For each technology choice:
     Task: "Find best practices for {tech} in {domain}"
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

**Output**: research.md with all NEEDS CLARIFICATION resolved

### Phase 1: Design & Contracts

**Prerequisites:** `research.md` complete

1. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable

2. **Define interface contracts** (if project has external interfaces) → `/contracts/`:
   - Identify what interfaces the project exposes to users or other systems
   - Document the contract format appropriate for the project type
   - Examples: public APIs for libraries, command schemas for CLI tools, endpoints for web services, grammars for parsers, UI contracts for applications
   - Skip if project is purely internal (build scripts, one-off tools, etc.)

3. **Create quickstart validation guide** → `quickstart.md`:
   - Document runnable validation scenarios that prove the feature works end-to-end
   - Include prerequisites, setup commands, test/run commands, and expected outcomes
   - Use links or references to contracts and data model details instead of duplicating them
   - Do not include full implementation code, model/service/controller bodies, migrations, or complete test suites
   - Keep this artifact as a validation/run guide; implementation details belong in `tasks.md` and the implementation phase

**Output**: data-model.md, /contracts/*, quickstart.md

## Key rules

- Use absolute paths for filesystem operations; use project-relative paths for references in documentation
- ERROR on gate failures or unresolved clarifications

## Done When

- [ ] Plan workflow executed and design artifacts generated
- [ ] Completion reported to user with branch, plan path, and generated artifacts

## Stackra: Planned

`plan.md` follows the Stackra plan template: every Constitution Check row is PASS or N/A with a reason, the three
deploy modes have rows, and every FR is validated by a `P-###` property (or the FR says `example-only`). Then set
`**Status**: Planned`, append the Status history line, and run `pnpm spec:gate check <folder>`.
Then the approval stop (below), then the tasks: this command writes tasks.md too; there is no separate tasks command.

## Stackra: approval stop (ADR 0502)

A `feature` spec stops once, after the spec and plan; a `big` spec stops after the spec (before planning) and after
the plan (before tasks). At a stop, ask the approver named in `**Approver**` with the question tool: Approve, Revise
with notes, Reject; to the owner, plan.md is "the design" (its nine sections, ADR 0502). On Approve, add `— Approved by <who> <YYYY-MM-DD>` to the `**Status**` line and to its Status
history line. On Revise, apply the notes and ask again. On Reject, set `**Status**: Abandoned`. Never record an
approval nobody gave; the gate and the plan-gate hook read it before tasks and code.

## Stackra: tasks (the plan workflow, after the Planned approval)

The plan stage splits the approved spec into PR-sized tasks and writes tasks.md. `fflow plan` hands the workflow
its input and validates and records its output; never write tasks.md by hand.

1. **Input**: run `fflow plan STA-n --input`. It prints the FRs and ACs to cover, the documents to read and the size
   budget (the most files one task may name). If it refuses (the spec is not approved, or is small: a small spec keeps
   its tasks in spec.md's `## Tasks`), STOP and report it.
2. **Template**: run `fflow spec setup-tasks --json` and use its `data.TASKS_TEMPLATE_CONTENT` as the structure.
3. **Split**: read the documents and write the tasks, grouped into phases, one PR each, in stack order (a phase comes
   after the phases it builds on). Each task names its files in backticks, at most the budget, and every line follows
   `- [ ] T012 [P] [US1] <desc> in <path> — covers: FR-003, AC-004, P-002 — route: <task type> — deps: T010`.
   Together the tasks cover every FR and AC; `[P]` tasks in one phase share no file.
4. **Record**: write the result to a scratch file and run `fflow plan STA-n --record <file>`. It writes tasks.md
   into the spec folder only when `gate tasks` passes, every FR and AC is covered and each task holds its budget;
   otherwise it names each problem. Fix them and record again.
5. **Tasked**: set `**Status**: Tasked`, append the Status history line and run `pnpm spec:gate check <folder>`.
6. **Linear**: preview `pnpm spec:linear tasks <folder>/tasks.md --dry-run`, show the user the list, then run it
   without `--dry-run`. Each `T###` line without a key becomes a sub-issue of the spec's issue, labelled `agent`; the
   script appends ` [STA-m]`, and a re-run skips linked lines. A Linear failure never blocks a gate (ADR 0065 rule 7).
   The token reaches it only through `pnpm spec:linear`, which decrypts it from the sops `agents` scope into its own
   environment. Never print it.

The next step is `fflow start STA-n` (the worktree), then `/flow-implement`.
