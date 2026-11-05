---
description: Build tasks.md wave by wave, each wave's tasks as parallel subagents, stopping at a failed wave.
---

## Stackra: feature directory (runs first)

Specs live in `.agents/specs/sta-<n>-<slug>/` (ADR 0120 D1), never in `specs/`. Before anything else run
`pnpm spec:gate dir` (add `--key STA-n` when the branch name carries no key). It prints the spec folder for the
branch's Linear key and writes `.flow/current.json`, which every `fflow spec` call reads. If it fails, STOP and report
it; never fall back to a numbered folder.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

The build stage (STA-1945 FR-24). `fflow task wave` hands you the next wave; `fflow task start` and `fflow task done`
are the only way a task's marker moves. Never edit a marker in tasks.md by hand: `fflow check` refuses a hand tick.

1. Refuse to start unless the spec's `**Status**` is Tasked or Implementing and the branch is Linear-named
   (`pnpm spec:gate branch`). At Tasked, set `**Status**: Implementing` (Status history line) and commit it now:
   a change to spec.md, plan.md or tasks.md after a task started resets that task. Read the three once; they are the
   subagents' brief.

2. Run `fflow task wave STA-n --json`. Its `data` holds the wave's number (`wave`), how many waves there are (`of`), and
   its tasks still to run (`tasks`), each with its `id`, `marker`, `paths`, `deps` and `checkpoint`; their `[ ]` markers
   are now `[~]` (queued). Empty `data.tasks` means every wave is done: go to step 7. An optional task (`T###*`)
   left `[ ]` is never in a wave and holds nothing; it runs only once someone starts it with `fflow task start`.

3. For each task of the wave, in order, run `fflow task start STA-n <T###>`, except a task already `[-]`: a dead
   session started it, and it restarts here at its first unfinished task without a new start. Run these one at a
   time (each writes tasks.md). A refused start is a failed task: it gets no subagent.

4. Run the wave's tasks as parallel subagents, all launched in one message (a wave holds at most 5 tasks, and no two
   of them share a path). Each subagent gets its task line, the spec, plan and tasks paths, and these rules: change
   only what its task names (its paths, and the tests its `covers:` ask for, each with a `// @covers sta-n:<id>`
   line); do not commit, push, run `fflow task` or edit tasks.md; report the files it changed and the command that
   proves the task (the test file it wrote, else the package's test script). A checkpoint task gets no subagent: its
   command is its proof.

5. When every subagent has returned, commit each task's files, one commit per task in order (`git add <files>`,
   `git commit -m "<type>(<scope>): <T###> <what>"` with `Refs: STA-n`). Then, with the tree clean, for each task in order run
   `fflow task done STA-n <T###> --command "<its proving command>"` (a checkpoint's own command). `task done` runs
   the command at a clean HEAD, records the attempt and sets `[x]` only on exit 0. Run it for every task of the wave,
   even after one fails, so each attempt is recorded. Then commit tasks.md and `.flow/record/` (`chore(flow): STA-n
   wave <n>`).

6. If any task of the wave is not `[x]`, STOP at the wave boundary: do not ask for the next wave. Report each failed
   task, its command and exit code, and what it needs. Otherwise go back to step 2.

7. Run `fflow next STA-n` and report what the build did (waves, tasks done, optional tasks left `[ ]`) and the command
   it names.

## Done When

- [ ] Every required task is `[x]` with passing evidence, or the build stopped at a failed wave and said why
- [ ] No marker was moved by hand, and no later wave started while one of the wave's tasks failed
- [ ] The commits carry `Refs: STA-n`, and tasks.md and the record are committed

## Stackra: status

When every task is `[x]` (or optional, or struck by an amendment), `pnpm spec:trace ci` passes and the Impact docs are
touched, set `**Status**: Done`.
