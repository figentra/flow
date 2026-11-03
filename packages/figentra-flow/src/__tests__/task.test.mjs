/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow task start|done` to STA-1945 FR-23: a task starts only on a Tasked spec and records its start,
 *   `done` keeps every attempt and sets `[x]` only on exit 0 at a clean HEAD, a secret-looking command never runs, a
 *   changed document resets a started task with the reason, a hand tick is named, and `task wave` queues the next wave
 *   and holds it while one of its tasks failed.
 * Boundary: temporary repositories with a local bare origin; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945 FR-23, AC-22, AC-23, AC-24, P-028, NFR-5.
 */
// @covers sta-1945:FR-23 sta-1945:AC-22 sta-1945:AC-23 sta-1945:AC-24 sta-1945:P-028
// @covers sta-1945:FR-24 sta-1945:AC-25 sta-1945:P-029
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  docsDigest,
  doneTask,
  handTicks,
  queueWave,
  resetChanged,
  setMarker,
  startTask,
  TaskError,
} from "../commands/task.mjs";
import { readRecord } from "../lib/record.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "../../bin/fflow.mjs");

/** `fflow <args>` run in `cwd`. */
const fflow = (/** @type {string} */ cwd, /** @type {string[]} */ ...args) =>
  spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });

const TASKS = `# Tasks

<!-- example: - [ ] T001 Do it in \`a.mjs\` -->

## Phase 1

- [ ] T001 Do it in \`a.mjs\` — covers: FR-001 — route: spec-task
- [ ] T002 Then this in \`b.mjs\` — covers: FR-001 — route: spec-task
- [ ] T003 Checkpoint: \`true\`
`;

/** A repository whose STA-7 spec is at `status`, committed. */
function setup(t, status = "Tasked") {
  const r = repo();
  t.after(r.dispose);
  const dir = join(r.root, ".agents", "specs", "sta-7-x");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.md"), `# x\n\n**Status**: ${status}\n`);
  writeFileSync(join(dir, "plan.md"), "# plan\n");
  writeFileSync(join(dir, "tasks.md"), TASKS);
  sh(r.root, "add", "-A");
  sh(r.root, "commit", "-q", "-m", "spec");
  const tasks = () => readFileSync(join(dir, "tasks.md"), "utf8");
  const marker = (/** @type {string} */ id) =>
    tasks().match(new RegExp(`^- \\[(.)\\] ${id}`, "m"))?.[1];
  return { root: r.root, dir, tasks, marker };
}

test("task start: refuses before Tasked, then sets [-] and records the start", (t) => {
  const draft = setup(t, "Draft");
  assert.match(startTask(draft.root, "STA-7", "T001").join(), /the spec is draft/);
  assert.equal(draft.marker("T001"), " ");
  const s = setup(t);
  assert.throws(() => startTask(s.root, "STA-7", "T009"), TaskError);
  const head = sh(s.root, "rev-parse", "HEAD");
  const at = new Date("2026-11-03T10:00:00Z");
  assert.deepEqual(startTask(s.root, "STA-7", "T001", { session: "s1", now: () => at }), []);
  assert.equal(s.marker("T001"), "-");
  // the commented example line is untouched
  assert.match(s.tasks(), /<!-- example: - \[ \] T001/);
  assert.deepEqual(readRecord(s.root, "sta-7")?.started?.T001, {
    at: at.toISOString(),
    head,
    docs: docsDigest(s.dir),
    session: "s1",
  });
  assert.match(startTask(s.root, "STA-7", "T001").join(), /already in progress/);
});

test("task done: a failing run stays [-] with the attempt; a passing one at a clean HEAD is [x]", (t) => {
  const s = setup(t);
  assert.throws(() => doneTask(s.root, "STA-7", "T001", "true"), /not started/);
  startTask(s.root, "STA-7", "T001");
  const failed = doneTask(s.root, "STA-7", "T001", "echo no; exit 4");
  assert.deepEqual([failed.done, failed.evidence.exit, s.marker("T001")], [false, 4, "-"]);
  // the tasks file and the record are bookkeeping, not a dirty tree
  const passed = doneTask(s.root, "STA-7", "T001", "true");
  assert.deepEqual([passed.done, passed.evidence.clean, s.marker("T001")], [true, true, "x"]);
  const attempts = readRecord(s.root, "sta-7")?.tasks.T001 ?? [];
  assert.deepEqual(
    attempts.map((e) => [e.command, e.exit]),
    [
      ["echo no; exit 4", 4],
      ["true", 0],
    ],
  );
  assert.match(attempts[0].digest, /^sha256:[0-9a-f]{64}$/);
  assert.throws(() => doneTask(s.root, "STA-7", "T001", "true"), /T001 is done/);
});

test("task done: a dirty tree keeps the marker; a secret-looking command never runs", (t) => {
  const s = setup(t);
  startTask(s.root, "STA-7", "T002");
  writeFileSync(join(s.root, "stray.txt"), "x\n");
  const dirty = doneTask(s.root, "STA-7", "T002", "true");
  assert.deepEqual([dirty.done, dirty.evidence.clean, s.marker("T002")], [false, false, "-"]);
  assert.throws(() => doneTask(s.root, "STA-7", "T002", "env > leak.txt"), /secret/);
  assert.equal(existsSync(join(s.root, "leak.txt")), false);
  assert.equal(readRecord(s.root, "sta-7")?.tasks.T002.length, 1);
});

test("a changed document resets a started task with the reason; a marker move changes nothing", (t) => {
  const s = setup(t);
  startTask(s.root, "STA-7", "T001");
  startTask(s.root, "STA-7", "T002");
  // moving markers is not a change of the documents
  assert.deepEqual(resetChanged(s.root, "STA-7"), []);
  writeFileSync(join(s.dir, "plan.md"), "# plan, amended\n");
  assert.throws(() => doneTask(s.root, "STA-7", "T001", "true"), /changed since T001 started/);
  const reset = resetChanged(s.root, "STA-7");
  assert.deepEqual(
    reset.map((x) => x.id),
    ["T001", "T002"],
  );
  assert.match(reset[0].reason, /the spec, plan or tasks changed since T001 started/);
  assert.deepEqual([s.marker("T001"), s.marker("T002")], [" ", " "]);
  assert.deepEqual(readRecord(s.root, "sta-7")?.started, {});
});

test("a hand tick is named once the spec has a record", (t) => {
  const s = setup(t);
  const ticked = setMarker(setMarker(s.tasks(), "T001", "x"), "T002", "x");
  assert.deepEqual(handTicks(ticked, undefined), []);
  startTask(s.root, "STA-7", "T001");
  doneTask(s.root, "STA-7", "T001", "true");
  const record = readRecord(s.root, "sta-7");
  assert.deepEqual(handTicks(ticked, record), ["T002"]);
});

test("task wave: queues the next wave, holds it while a task failed, then moves on (AC-25)", (t) => {
  const s = setup(t);
  const ids = (/** @type {ReturnType<typeof queueWave>} */ w) =>
    w && [w.wave, w.of, w.tasks.map((x) => `${x.id}${x.marker}`)];
  assert.deepEqual(ids(queueWave(s.root, "STA-7")), [1, 2, ["T001~", "T002~"]]);
  assert.deepEqual([s.marker("T001"), s.marker("T002"), s.marker("T003")], ["~", "~", " "]);
  assert.deepEqual(startTask(s.root, "STA-7", "T001"), []);
  assert.equal(doneTask(s.root, "STA-7", "T001", "true").done, true);
  startTask(s.root, "STA-7", "T002");
  assert.equal(doneTask(s.root, "STA-7", "T002", "exit 1").done, false);
  // the failed task holds its wave: the checkpoint is not queued
  assert.deepEqual(ids(queueWave(s.root, "STA-7")), [1, 2, ["T002-"]]);
  assert.equal(s.marker("T003"), " ");
  assert.equal(doneTask(s.root, "STA-7", "T002", "true").done, true);
  assert.deepEqual(ids(queueWave(s.root, "STA-7")), [2, 2, ["T003~"]]);
  startTask(s.root, "STA-7", "T003");
  doneTask(s.root, "STA-7", "T003", "true");
  assert.equal(queueWave(s.root, "STA-7"), undefined);
});

test("task wave: refuses a spec before Tasked and a deps cycle, moving no marker (FR-23, P-029)", (t) => {
  const draft = setup(t, "Draft");
  assert.throws(() => queueWave(draft.root, "STA-7"), /the spec is draft/);
  assert.equal(draft.marker("T001"), " ");
  const s = setup(t, "Implementing");
  writeFileSync(
    join(s.dir, "tasks.md"),
    "- [ ] T001 A in `a.mjs` — deps: T002\n- [ ] T002 B in `b.mjs` — deps: T001\n",
  );
  assert.throws(() => queueWave(s.root, "STA-7"), TaskError);
  // the command layer prints the refusal and exits 2, never a stack trace
  const cli = fflow(s.root, "task", "wave", "STA-7");
  assert.equal(cli.status, 2, cli.stderr);
  assert.match(cli.stderr, /fflow task wave: tasks\.md: dependency cycle through T00\d/);
  assert.equal(s.marker("T001"), " ");
  // `next` still names the build's command while the cycle stands
  const next = fflow(s.root, "next", "STA-7", "--json");
  assert.equal(next.status, 0, next.stderr);
  const step = JSON.parse(next.stdout);
  assert.deepEqual(
    [step.stage, step.command, step.wave],
    ["build", "fflow task wave STA-7", undefined],
  );
});

test("task wave: the command prints usage, the wave, and the empty wave as JSON once all is done", (t) => {
  const s = setup(t, "Implementing");
  const usage = fflow(s.root, "task", "wave");
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage: fflow task .*wave <key> \[--json\]/);
  assert.match(fflow(s.root, "next", "STA-7").stderr, /wave 1 starts at T001: T001, T002/);
  const wave = fflow(s.root, "task", "wave", "STA-7");
  assert.equal(wave.status, 0, wave.stderr);
  assert.match(wave.stderr, /STA-7: wave 1 of 2, 2 to run/);
  assert.equal(wave.stdout, "T001 [~] a.mjs\nT002 [~] b.mjs\n");
  assert.match(fflow(s.root, "next", "STA-7").stderr, /wave 1 restarts at T001: T001, T002/);
  writeFileSync(join(s.dir, "tasks.md"), TASKS.replaceAll("- [ ] T", "- [x] T"));
  const done = fflow(s.root, "task", "wave", "STA-7", "--json");
  assert.equal(done.status, 0, done.stderr);
  assert.deepEqual(JSON.parse(done.stdout), { schema: "fflow.wave/1", key: "STA-7", tasks: [] });
  assert.match(fflow(s.root, "task", "wave", "STA-7").stderr, /every wave of STA-7 is done/);
});
