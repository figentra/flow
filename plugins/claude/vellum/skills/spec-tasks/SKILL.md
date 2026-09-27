---
name: spec-tasks
description: Turn an approved requirements.md and design.md into tasks.md for a spec — a checkbox implementation plan of coding tasks only, two levels deep, with optional test sub-tasks marked *, a _Requirements:_ traceability trailer on every leaf, periodic checkpoints, and a Task Dependency Graph assigning every leaf to a wave. Use after spec-design, when the user says "break this into tasks", "write the plan", "spec-tasks". Refuses if either prior document is missing. Plans only; never implements.
---

# spec-tasks — design into an executable implementation plan

You produce the third of three documents in a spec:
`requirements.md` -> `design.md` -> **`tasks.md`**.

**Persona:** this contract is run by the `spec-planner` agent (`agents/spec-planner.md` in the method), on the **frontier** tier. Dispatch it as that agent rather than inline when the work is delegated — the pin is what makes the model choice deliberate instead of whatever the session happens to be running.

## THIS SKILL NEVER IMPLEMENTS ANYTHING

You write a plan. You do not write the code the plan describes. You do not create,
modify, or delete a single file outside `<specs-root>/<NNN>-<slug>/tasks.md`. You do not
run a build, a test, a formatter, a package manager, or a migration. If the plan's
first task looks trivial and you are tempted to just do it — do not. Planning and
executing are separate turns with separate approval, and conflating them is how a
spec engine turns into an unreviewed commit.

## Step 0 — locate the spec and refuse if either input is absent

1. Determine the spec directory: the one the user named, or the most recently
   most recently modified spec that has both prior documents. **Get this from the
   stage detector, not from `ls`** — every other skill in this method calls it, and
   five callers reimplementing directory resolution is exactly how they drift apart:

   ```bash
   npx vellum status --json
   ```

   Each entry's `specId` is `<NNN>-<slug>` and the documents it has are the keys of
   its `artifacts`; the JSON has no `stage` or `root` field. Specs live in
   `.agents/specs/` at the repository root, the only place Vellum reads them;
   `<specs-root>` below means that directory. If the spec is ambiguous, list the
   candidates and ask which.

2. Check for **both** inputs:

   ```bash
   ls <specs-root>/<NNN>-<slug>/requirements.md <specs-root>/<NNN>-<slug>/design.md
   ```

3. **If `requirements.md` is missing, refuse:**

   > There is no `requirements.md` in `<specs-root>/<NNN>-<slug>/`. Run the `spec-new`
   > skill first, then `spec-design`.

4. **If `design.md` is missing, refuse:**

   > There is `requirements.md` but no `design.md` in `<specs-root>/<NNN>-<slug>/`. A
   > task plan traces to a design; without one I would be inventing the
   > architecture inside the task list, where nobody reviews it. Run the
   > `spec-design` skill first.

   Then stop. Do not create a stub. Do not plan from the requirements alone.

5. **If `tasks.md` already exists,** read it and preserve state: a task marked
   `[x]`, `[-]`, or `[~]` keeps its marker and its number. You are amending a
   live plan, not regenerating it. Never reset a completed task to `[ ]`.

## Step 1 — read both documents and build the trace inventory

Read `requirements.md` and `design.md` in full. Record, for your own use:

- every criterion number, so you can prove trailer coverage later
- every Property number and its `**Validates:**` list
- every component and its stated file or module location
- every migration, event, and interface named in the design

The design's component locations become the `files` entries in the wave graph.
Where the design named a directory rather than a file, resolve it to concrete file
paths — read the directory if it exists.

## Step 2 — decompose into coding tasks only

### What a task is

A task is one concrete change to this repository that a competent engineer can
complete and verify without further design decisions. It names the files it
touches. It is small enough to review in one sitting.

### What a task is not — the forbidden list

**Refuse to include any of these, even if the user asks for them.** They are not
coding work, they do not belong in a coding plan, and their presence makes the
wave graph meaningless:

- **user acceptance testing** — UAT sessions, sign-off meetings, stakeholder demos
- **deployment** — releasing, provisioning, promoting an environment, rolling out,
  flipping a feature flag in production, DNS or infrastructure changes
- **performance-metric gathering** — running benchmarks for numbers, load testing a
  live environment, collecting production latency data
  (writing a performance _test_ that asserts a bound is allowed; _gathering
  metrics_ as an activity is not)
- **manual end-to-end runs** — manual QA passes, exploratory testing, "click
  through the flow and confirm"
- **training and documentation** — onboarding sessions, user guides, runbooks,
  release notes
  (a code comment or a docstring is part of the coding task that produces it, not
  a task of its own)
- **business process changes** — policy updates, vendor negotiation, pricing,
  contract or legal work
- **marketing** — launch communication, announcements, positioning

If the user explicitly asks for one, say plainly that it is excluded by rule, and
where it belongs instead (a release checklist, a QA plan, a launch doc). Then
write the plan without it.

### Structure

- **Exactly two levels.** `### `-free: tasks are list items. Top level is `1`,
  `2`, `3`; sub-tasks are `1.1`, `1.2`. There is no `1.1.1` — if you need one, the
  top-level task is too big; split it into two top-level tasks.
- A top-level task is either a parent with sub-tasks, or a leaf in its own right.
- Order so that something runnable exists early. Data model and interfaces before
  the code that depends on them; wiring before the feature that uses it.
- Aim for 3 to 6 sub-tasks per parent. A parent with one sub-task should be a leaf.

### The parser contract — exact

Every task line must match:

```
`npx vellum lint` is the authority; it parses by hand rather than with one
expression, and the id it accepts is:

```
/^(\d+)(?:\.(\d+)(?:\.(\d+))?)?\.?(\\?\*)?(\s+)(.*)$/
```

**Do not write a task parser from a regex printed in a document.** Three contracts
for this format have been published across this method and none of them was the
implementation — the one that stood here until now rejected every top-level task,
checkpoints included, because it had no place for the trailing `.` that `1.` carries.
Match the table below by example, or read the script.
```

Which means, concretely:

| Form                                     | Meaning                     |
| ---------------------------------------- | --------------------------- |
| `- [ ] 1. Title`                         | top-level task, not started |
| `  - [ ] 1.1 Title _Requirements: 1.1_`  | sub-task, not started       |
| `  - [ ] 1.3* Title _Requirements: 1.1_` | **optional** sub-task       |
| `  - [ ] 1.4* Title _Requirements: 1.1_ _Properties: 1_` | optional sub-task that tests Property 1 |
| `  - [~] 1.4 Title _Requirements: 1.2_`  | queued                      |
| `  - [-] 1.5 Title _Requirements: 1.3_`  | in progress                 |
| `  - [x] 1.6 Title _Requirements: 1.4_`  | completed                   |

Write new tasks as `[ ]`. Do not invent other markers. Do not use a table, a
heading, or a numbered list for tasks — only `-` list items in this exact shape.

### Optional tasks

A `*` marks the task **optional**: tests, property-based test harnesses, extra
fixtures, nice-to-haves. It may sit **after the closing bracket** (`- [ ]* 1.3`)
or **after the task id** (`- [ ] 1.3*`); `npx vellum lint` accepts both and treats
them identically. Prefer the second — it is what every example here and in the
template uses, and it attaches the marker to the thing that is optional.

This mattered: the parser once accepted only the first form while every worked
example used the second, so optional tasks authored from the template were not
merely mis-flagged — they were not recognised as tasks at all, and the linter
reported such a file clean.

- **A task that cites a Property is NEVER optional.** Property tests verify
  the design's Correctness Properties, and a plan is not complete without the
  properties it promised. Even if a Property test is "extra verification",
  omit the `*` marker on any task that carries `_Properties: N, …_`.
- **Mark every other test sub-task optional with `*`.** Tests that do not cite
  Properties are real work and still carry a traceability trailer, but the plan
  must remain shippable without them.
- **A top-level task is NEVER optional.** Never emit `- [ ]* 3. …`. If an entire
  top-level task is skippable, it does not belong in the plan.

### Traceability trailer

**Every leaf task ends with `_Requirements: <n>.<m>, …_`** on the same line.
Write it that way. A Markdown formatter may later wrap a long task onto indented
continuation lines, trailer included; Vellum reads those lines as part of the
task — as it does a nested `- _Requirements: …_` bullet under a task, the Kiro
IDE's shape — and re-wrapping is not an edit to the approved plan.

- Numeric references only, `<requirementNumber>.<criterionNumber>`. No titles, no
  quoted criterion text, no links, no Property numbers in this trailer.
- Parent tasks carry no trailer. Checkpoint tasks carry no trailer.
- A leaf that implements a Correctness Property lists the criteria that Property
  validates — take them from the Property's `**Validates:**` line.
- **A leaf that tests a Correctness Property cites it** with a second trailer
  after the first: `_Requirements: 2.1, 2.2_ _Properties: 2_` — the Property's
  number from `design.md`, numbers only. **Every Property must be cited by at
  least one task.** `npx vellum verify` fails with `PROPERTY_NOT_CITED` for each
  Property no task cites, and `npx vellum lint` reports `TASK_PROPERTY_UNDEFINED`
  for a citation of a Property `design.md` does not define.
- **Every criterion in `requirements.md` must appear in at least one trailer.**
  After drafting, compute the union of all trailers and diff it against your Step 1
  inventory. Any criterion missing is either a missing task or a deferral already
  documented in the design's Open Questions — and if it is a deferral, say so in
  `## Notes` rather than silently omitting it.

### Checkpoints

Insert a top-level `Checkpoint` task every three to five top-level tasks, and
always immediately before a task that builds on a large batch of prior work:

```
- [ ] 5. Checkpoint: ensure all tests pass
```

Checkpoints have no sub-tasks, no `*`, no trailer, and no entry in the wave graph.
A checkpoint is still a Required Task: `spec-implement` records its
workspace-wide verification through `npx vellum task complete`, and `npx vellum verify`
requires that evidence. A parent task needs no evidence of its own — it is
complete when its required sub-tasks are.

## Step 3 — build the Task Dependency Graph

Emit a single fenced ` ```json ` block under `## Task Dependency Graph`, recording
**wave membership only**:

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1"] }
  ]
}
```

That is the whole schema. No `files`, no `dependsOn`, no `optional` — the `*` on the task
line already carries optionality, and nothing reads the other two. `npx vellum lint` validates
membership, uniqueness, the parent and checkpoint exclusions, and contiguous ids (a `[x]`
task still listed after it completed is not a finding); `spec-run` needs the wave list and
nothing more.
A graph carrying per-task file lists ran to two-thirds of one document and was checked by
no tool at all.

**Rules 1-3 are verified by `npx vellum lint`. Rules 4-6 are yours to apply** — they are how you
*construct* correct waves, and the graph records only the result. Nothing re-checks them
afterwards, so state in your report that you applied each and what you found.

1. **Membership.** Every **incomplete leaf** task appears in **exactly one** wave. No task
   twice; no incomplete leaf omitted.
2. **Exclusions.** Parent tasks, Checkpoint tasks, and already-completed (`[x]`) tasks are
   excluded.
3. **Wave ids.** Integers, contiguous, from `0`. No gaps.
4. **The resolution rule.** A task that changes **what the workspace resolves** —
   `pnpm-workspace.yaml` catalogs, `go.work` members, the uv workspace list, `turbo.jsonc`
   tier tags, or any check `pnpm verify` runs against every member — must sit in a strictly
   lower wave than everything depending on what it resolves.

   The same-file rule does not catch this, and that is the point: two such tasks touch
   entirely different files and still cannot land in either order. A member declaring
   `"@x/y": "catalog:"` and the catalog entry defining `@x/y` live in separate files, but
   until both exist `pnpm install` fails for **the whole workspace** — every session, every
   pre-commit hook, every other member. File overlap is a proxy for independence, and this
   is where the proxy is wrong. A check is the same shape reversed: a validator rule added
   to `pnpm verify` applies immediately to every member, including ones another wave is
   still creating — sequence it after they exist, never beside them.

   The test: *if this task lands and its counterpart does not, does anything outside this
   task's own files break?* If yes, it mutates resolution.
5. **The same-file rule.** Two tasks that write the same file must be in **different
   waves**. A wave is a set of tasks that can run in parallel without touching each other's
   files — that is the whole point of the grouping. When two tasks must edit one file,
   either sequence them or merge them.
6. **Dependency direction.** A task must sit in a strictly higher wave than anything it
   depends on.

Then verify by counting: number of leaf tasks in the document minus completed
minus checkpoints equals the total number of task entries across all waves. State
that count in your report.

## Step 4 — write the file

Copy the `tasks.md` template (`.agents/templates/tasks.md` in the repository when it has one, otherwise `../../templates/tasks.md` relative to this skill's directory) to `<specs-root>/<NNN>-<slug>/tasks.md` and fill it:

- `## Overview` — what the plan builds, the ordering rationale, the counts.
- `## Tasks` — the task tree, in the exact parser shape.
- `## Task Dependency Graph` — the JSON block.
- `## Notes` — keep the convention explanations (checkbox states, optional tasks,
  traceability, checkpoints, the forbidden list). They are how a later agent reads
  the file correctly. Add any documented deferral here.

Delete every template placeholder and HTML comment.

Then record the file's Lifecycle Frontmatter with the CLI — right after writing it, and
after every later rewrite:

```bash
npx vellum stamp <NNN>
```

It adds the frontmatter block without changing your text, records the next version and
checksum of a changed plan, and raises the spec's recorded state to `PLAN_IN_REVIEW`.
Never write frontmatter by hand. If it exits 1, report its message and stop. Approval is
the human's (`npx vellum approve <NNN> tasks`); if `npx vellum approve` refuses because the frontmatter checksum of the document is
stale (the body changed after its last stamp), the human runs `npx vellum stamp <NNN>`
first, reviews the result, then approves.

## Step 5 — self-check, then stop

Verify and state each result:

- [ ] both input documents existed and were read in full
- [ ] no forbidden task type appears anywhere in the plan
- [ ] every task line matches the parser regex
- [ ] nesting is at most two levels; numbering is decimal and contiguous
- [ ] no top-level task is marked optional; every test sub-task is
- [ ] every leaf has a `_Requirements:_` trailer with numeric refs only
- [ ] the union of trailers covers every criterion in `requirements.md`
- [ ] every Property in `design.md` is cited by some task's `_Properties:_` trailer
- [ ] every incomplete leaf is in exactly one wave; parents and checkpoints excluded
- [ ] wave ids are contiguous from 0
- [ ] the graph records wave membership only — no `files`, `dependsOn` or `optional`
- [ ] rules 4-6 applied and stated in the report: resolution, same-file, dependency order
- [ ] pre-existing task states were preserved
- [ ] **nothing outside `tasks.md` was created or modified**

Then report the path, the counts (leaf tasks, optional, waves, criteria covered),
anything you deliberately excluded, and:

> Review `<specs-root>/<NNN>-<slug>/tasks.md`. Implementation is a separate step — this
> skill plans only.

**Then stop.**

## Never

- **Never implement any task.** Not the first one, not the easy one, not "while
  I was there".
- Never run a build, test, formatter, package manager, or migration.
- Never create or edit any file other than this spec's `tasks.md`.
- Never proceed with either prior document missing.
- Never include a forbidden task type, at any nesting level, under any wording.
- Never mark a top-level task optional.
- Never emit a leaf without a `_Requirements:_` trailer.
- Never put two same-file tasks in one wave.
- Never reset or renumber a task that is already in progress or complete.
