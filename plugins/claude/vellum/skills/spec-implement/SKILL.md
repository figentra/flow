---
name: spec-implement
description: Execute exactly ONE task from a spec's tasks.md — read requirements.md, design.md and tasks.md, mark the task in-progress, implement it, verify it against its named acceptance criteria, then mark it done or report why it failed. Use when the user says "implement task", "do task 3.2", "work on the next task", or when spec-run dispatches a single task to a subagent. Never continues to a second task.
---

# spec-implement — execute one task, verify it, stop

You execute the third of three documents in a spec: you consume
`requirements.md` -> `design.md` -> `tasks.md` and change code plus exactly one
checkbox. You do not write requirements. You do not write design. You do not
rewrite the task plan or the dependency graph — only the one checkbox for the
task you were asked to do.

**Input:** a spec identifier and a task id (`3`, `3.2`). Optionally
`--include-optional` (see Step 2).

**Persona:** this contract is run by the `spec-executor` agent (`agents/spec-executor.md` in the method), on the **standard** tier. Dispatch it as that agent rather than inline when the work is delegated — the pin is what makes the model choice deliberate instead of whatever the session happens to be running.

## Step 0 — locate the spec directory

Specs are produced by `spec-new` / `spec-design` / `spec-tasks`. This system
mirrors Kiro's `.kiro/` layout onto whichever directory the repository already
uses, so the location is resolved rather than assumed. **Check these roots, in
this order,** and use whichever actually contains the named spec:

```bash
ls .agents/specs/ 2>/dev/null   # assistant-neutral source of truth — preferred
ls .claude/specs/ 2>/dev/null   # a Claude-only repo, or a projection of the above
ls specs/         2>/dev/null   # a bare root directory
```

Where `.claude/specs/` holds symlinks into `.agents/specs/`, it is a
projection, not a second root: write to `.agents/` and let the repository's
sync tool update the projection.

Resolve the caller's spec identifier (a full `NNN-slug`, just `NNN`, or just
enough of the slug to be unique) against whichever root has a matching
directory. If two distinct roots have a directory that could match, or none
does, stop and ask which one — do not guess between two candidate specs.

Call the resolved directory `<spec-dir>` for the rest of this skill.

Then, before changing anything, record the working tree's current state:

```bash
git status --porcelain
```

Keep that output. Once Step 2 has resolved the task line and Step 4 has named
the files the task and the design touch, list every entry from it that touches
one of those files in your final report, under **"uncommitted work already
present"**. A task re-dispatched after an interrupted or failed run starts from
a fresh checkbox but not a fresh tree: the previous attempt's half-finished
edits are still on disk, and nothing in this contract reverts them. Reporting
them is what lets a human decide whether to keep or discard them. Do not
`git checkout`, `git stash`, or otherwise undo anything yourself — you cannot
tell that work apart from a change the user made deliberately.

## Step 1 — read all three documents, or refuse

```bash
ls <spec-dir>/requirements.md <spec-dir>/design.md <spec-dir>/tasks.md
```

**If any of the three is missing, refuse and stop.** Say exactly this shape:

> `<spec-dir>` is missing `<file>.md`. Implementing task <id> without it would
> build against guesswork instead of the spec, which produces the wrong thing
> with false confidence. Run `spec-new` / `spec-design` / `spec-tasks` to
> produce it first.

Do not proceed from a verbal description of what the task "probably" means.
The three documents are the input; without all three there is nothing correct
to implement against.

Then **read all three documents in full** — not just the one task line. You
need:

- from `tasks.md`: the exact task line, its indentation level (top-level or
  sub-task), its checkbox state, its `*` optional marker if any, and its
  `_Requirements: n.m, …_` trailer
- from `requirements.md`: the full text of every acceptance criterion named in
  that trailer, and its Glossary (terms you must use exactly as defined)
- from `design.md`: the component(s), interface(s), data model, and any
  Correctness Property whose `**Validates:**` line references the same
  criteria — that Property is your real spec for a universal behaviour; the
  criterion text alone is not enough

## Step 2 — locate the task line and gate it

Find the line in `tasks.md` whose task id matches exactly (`3` matches only
the top-level task numbered `3.`, never `3.1`; `3.2` matches only that
sub-task). If no line matches, stop and report: "Task <id> does not exist in
`<spec-dir>/tasks.md`."

**Parent task.** If the matched line has sub-tasks beneath it in the file,
refuse: parent tasks are containers, never units of work. Report which
sub-tasks exist — one of those is the actual unit to implement. `npx vellum task
start` refuses a parent the same way, and `npx vellum verify` requires no evidence
for one: a parent is complete when its required sub-tasks are, or, when all its
sub-tasks are optional, when every one of them is. Vellum sets the parent's marker
(`[-]` on the first sub-task's start, `[x]` on completion); never edit it yourself.

**Checkpoint.** If the matched line reads `Checkpoint: …`, refuse as a unit of
implementation. Instead record the workspace-wide verification through Vellum,
exactly as Steps 3 and 6 do for a task — `npx vellum task start <NNN> <id>`, then
`npx vellum task complete <NNN> <id> --command="pnpm verify"` (or the narrowest
`turbo run` that covers everything built so far) — and report the result.
Vellum runs the command, records the Evidence Entry and sets `[x]` only if the
run is green; do not set it yourself. A checkpoint is a Required Task:
`npx vellum verify` fails with `TASK_NOT_VERIFIED` for one with no passing
evidence. It is the only verification in the run that crosses package
boundaries, so a green one is the claim that the tasks before it work
together; do not narrow the command to make it pass. If the run is red, that
is a failure: go to Step 7 and log it like any other.

**Optional (`*`) gate.** The `*` may sit **after the closing bracket**
(`- [ ]* 3.2 …`) or **after the task id** (`- [ ] 3.2* …`). `spec-tasks`
accepts both and treats them identically, and the id-suffix form is the
preferred one — it is what every example and the template use, so it is the
form you will actually meet. Check both positions. Matching only the first is
how a template-authored optional task looks unmarked and gets built with no
opt-in, which defeats "optional tasks are skipped by default" without erroring.

If the task line carries `*` in either position, **you must not implement it**
unless the caller explicitly passed `--include-optional` (or the equivalent
instruction from `spec-run`, which documents the same opt-in). Without that
flag, stop and report:

> Task <id> is marked optional (`*`) and is skipped by default. Re-invoke with
> `--include-optional` to implement it anyway.

This is a hard gate regardless of how quick or valuable the task looks — `*`
is the plan author's signal that the spec ships without it.

## Step 3 — mark the task in progress

Start the task through Vellum first. The marker is not the record; the task binding is:

```bash
npx vellum task start <NNN> <task-id>
```

If it refuses (a failed pre-execution check, an unapproved plan), stop and report its
output verbatim; do not implement a task Vellum has refused to start. When it succeeds it
moves the task's marker to `[-]`. Re-read the line; if it does not show `[-]`, set it
yourself under the rules below.

**Re-read the task's line from `tasks.md` immediately before this edit**, not
from the copy you read in Step 1. Up to five executors edit this one file at
once with no lock between them, so the copy you read in Step 1 may already be
several writes stale; editing against a stale copy is how one executor's `[x]`
silently reverts another's. This re-read applies to every checkbox edit in this
contract — Step 3, Step 6 and Step 7 alike.

Rewrite the checkbox from whatever it is (`[ ]`, `[~]`) to `[-]`, changing
**only that one line** — the task's first line, the one carrying the checkbox,
when a formatter has wrapped the task onto more — preserving indentation,
numbering, optional marker, and trailer exactly. Use a targeted edit, not a rewrite of the file.

If the edit is rejected because the file changed since you read it, re-read and
retry the edit **once**. If the retry is also rejected, stop and report a write
conflict on `tasks.md` — name the task id and both rejections. Do not force the
write past a conflict: forcing it is the lost update this rule exists to
prevent, and the sibling checkbox it would revert belongs to work that really
was verified.

Do not touch any other task's checkbox. Do not touch the
`## Task Dependency Graph` JSON block.

## Step 4 — implement the one task

Make the change the task describes, in the files the task and the design's
Components section name. Rules while doing this:

- **One task only.** Do not fold in adjacent tasks because they're related or
  because it would be more efficient. A task is the unit of review and of
  resumability; merging tasks breaks both.
- **Match the design, not your own judgment of a better approach.** If the
  design is wrong, implement what it says, then say so in your final report —
  do not silently deviate. A silent deviation makes `spec-verify`'s
  traceability audit lie.
- **Use the Glossary's terms** for names in code comments and identifiers
  where reasonable; do not introduce a new synonym for a concept the spec
  already named.
- Follow this repository's own conventions before anything else: read
  `AGENTS.md` / `CLAUDE.md` / rules directories for the module you're touching,
  and match the boundary and placement rules already in force there.

## Step 5 — verify against the task's own acceptance criteria

The task's `_Requirements: n.m, …_` trailer is the acceptance test, not
`pnpm verify` in the abstract. Verify in this order:

1. Write or extend the automated test(s) that exercise the named criteria —
   vitest for TypeScript, `go test` for Go, pytest (via `uv run pytest`) for
   Python — placed exactly where this repository's existing tests for that
   package live.
2. Run the narrowest command that proves the task, for speed:
   `pnpm turbo run test --filter=<package>` (and `lint` / `typecheck` the same
   way) before falling back to the full `pnpm verify`.
3. If the task also names a design Property (via the design's
   `**Validates:**` back-reference), the test must actually exercise the
   universal claim — a single example that happens to pass is not proof of a
   property.

**Forbidden, without exception: mocks or fake data standing in for the real
behaviour in order to make a test pass.** A test that asserts against a
stubbed return value instead of exercising the real code path is not
verification — it is a false `[x]` waiting to happen. If the task genuinely
cannot be verified without a mock (e.g. a real external third-party API), say
so in your report as a design gap; do not paper over it with a fake and
continue.

**Verification attempts are capped at 2.** Attempt 1: implement, test, run the
verification command. If it fails, read the failure, form one concrete
hypothesis about the cause, and make one corrected attempt (Attempt 2).

- If Attempt 2 passes: proceed to Step 6.
- If Attempt 2 still fails: **stop. Do not attempt a third time.** A second
  failure after a targeted fix means the task, the design, or your
  understanding of one of them is wrong — more thrashing burns effort without
  new information. Go to Step 7.

## Step 6 — success: mark the task done

Record the completion by handing Vellum the verification command. Vellum runs it itself,
records its real exit status, timestamps, duration and HEAD commit as evidence, and only then
decides the marker — you never report an exit status:

```bash
npx vellum task complete <NNN> <task-id> --command="<the verification command>"
```

It sets the task's marker to `[x]` only when the command exits 0 and the working tree matches
HEAD outside the spec directory (commit your work first). Exit 1 means the command failed,
the evidence was recorded as uncommitted, or completion was refused; the marker is left as it
was, and a failed run is recorded as a failed attempt. Do not set `[x]` yourself — a task whose
recorded verification failed goes to Step 7, not here. Then run the linter against this spec's
`tasks.md`:

```bash
npx vellum lint <NNN> --type=tasks --json
```

This is the same validator the repository's CI runs through `npx vellum lint`, so the skill and the gate cannot disagree about a spec.

If it reports a diagnostic on the line you just edited, fix your edit (not the
rest of the file) before finishing — a state store that fails its own linter
is not actually done.

**Then append your row to the `## Execution Log` section of `tasks.md`**,
creating the section at the end of the file if it does not exist. `[x]` on its
own is unfalsifiable — the executor writes the character and the orchestrator
"confirms" the work by reading the character the executor just wrote. The log
is the row a reader can check it against. `npx vellum lint` does not check Execution Log rows in this version (the
`EXECUTION_LOG_*` rule identifiers have no implementation). The check that can
contradict a `[x]` is `npx vellum verify`: it requires, for every required task, an
Evidence Entry the engine itself recorded when `npx vellum task complete` ran the
verification command:

```
## Execution Log

| Task | Criteria | Command                                         | Exit | Evidence |
| ---- | -------- | ----------------------------------------------- | ---- | -------- |
| 1.1  | 6.1, 6.5 | pnpm turbo run test --filter=@acme/contracts | 0    | a3f9c21 |
```

Five cells exactly, in that order. `Criteria` may name **only** criteria the
task's own `_Requirements:_` trailer carries — claiming one it does not is what
a fabricated entry looks like. `Command` is the
verification command as you actually ran it, with any `|` escaped as `\|`.
`Exit` is its real exit status, an integer. Rows are appended, never rewritten.

Log **leaf tasks only.** A checkpoint is not a leaf and carries no trailer; an
entry for one is rejected as an unknown task, and a `[x]` checkpoint needs no
row.

The row is text, not a marker, so it changes the plan: record the new version and
checksum, then re-run the linter, for the same reason you ran it after the checkbox edit:

```bash
npx vellum stamp <NNN>
npx vellum lint <NNN> --type=tasks --json
```

`npx vellum task complete` changing a marker is not an edit and needs no stamp; any other
change you make to `tasks.md` does.

Report:

1. The task id and its one-line description.
2. The files changed.
3. The exact verification command(s) run and that they passed.
4. Which acceptance criteria (by number) were verified and how.
5. Any deviation from `design.md`, named explicitly.
6. When this was the last incomplete required task in `tasks.md`, say so, and name
   `spec-verify` and then `spec-converge` as the next steps — the second is what checks
   the code against the documents and every `[x]` against its recorded evidence.

**Then stop.** Do not start the next task, even if it looks trivial and even
if you can see exactly what it needs. `spec-run` decides sequencing; a
standalone invocation of this skill ends after one task every time.

## Step 7 — failure: leave it unstarted, report why

**Never write `[x]` for a task that did not verify.** A false-positive
completion is worse than an honest failure — it hides broken work behind a
checkmark that `spec-run` and `spec-verify` will both trust.

Re-read the task's line, then rewrite the checkbox back to `[ ]` (not `[-]` —
a left-behind `[-]` looks like someone is still actively working on it), with
the same retry-once-on-a-stale-read rejection as Step 3.

`[ ]` is byte-identical to never-attempted. On its own it loses the one fact
worth keeping — that this task was tried and why it failed — because the
diagnosis lives only in this transcript, which the next run does not have. A
resume then dispatches a fresh executor with no memory and reproduces the
identical failure. **So append a row to the `## Execution Log` section of
`tasks.md`** (Step 6 describes the section and its exact columns; create it at
the end of the file if it does not exist):

```
| 3.2  | 6.1, 6.5 | pnpm turbo run test --filter=@acme/pricing | 1 | no commit — vitest cannot resolve `@acme/pricing`, not exported from its barrel |
```

A failed attempt records the command's real non-zero `Exit`. It has no commit,
so the `Evidence` cell carries the one-line diagnosis instead, after `no commit —`.
The schema has five columns and no diagnosis column of its own; this is where
the diagnosis fits without breaking the linter, and it is the cell a reader
looks at to see why nothing landed. Keep the diagnosis concrete and name the
cause rather than the symptom — "tests failed" tells the next run nothing it
did not already know.

`spec-run` Step 1 reads this log and will not re-dispatch a task whose logged
failure was diagnosed against a design nothing has changed since. That is the
whole return on writing the row: one avoided repeat of a failure already
understood.

Then report:

1. The task id.
2. Both attempts: what you tried, the exact command run, and the exact failure
   (error message / failing assertion), not a paraphrase.
3. Your best diagnosis of the root cause — the design's gap, a wrong
   assumption in the task, a missing dependency, an environment issue.
4. What would need to change (in the code, the design, or the task) before a
   third attempt would have a real chance.

## Never

- Never implement without having read all three documents in full.
- Never implement a parent task or a checkpoint as if it were a leaf task.
- Never implement a task marked `*` without an explicit opt-in — and check
  both marker positions (`- [ ]* 3.2`, `- [ ] 3.2*`) before concluding a task
  is not optional.
- Never touch a checkbox other than the one for the task you were given.
- Never edit a checkbox from a copy of `tasks.md` read earlier in the run —
  re-read the line immediately before every edit, and retry once on a
  stale-read rejection rather than forcing the write.
- Never edit `requirements.md`, `design.md`, the task text, or the dependency
  graph JSON. The `## Execution Log` is the one exception, append-only — a row
  on success (Step 6) and a row on failure (Step 7).
- Never leave a twice-failed task without an `## Execution Log` row — a bare
  `[ ]` tells the next run nothing and buys the same failure again.
- Never write `[x]` without its Execution Log row, and never claim a criterion
  in that row that the task's own trailer does not carry.
- Never continue to a second task in the same invocation.
- Never write `[x]` for a task whose verification did not actually pass.
- Never use a mock, stub, or fake data to make a verification step pass.
- Never make a third verification attempt — cap is 2, then report.
