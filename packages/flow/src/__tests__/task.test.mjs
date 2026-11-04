/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow task start|done` to STA-1945 FR-23: a task starts only on a Tasked spec and records its start,
 *   `task start` first resets a task whose documents changed with the reason and restarts a hand-ticked one (T024),
 *   binds the spec's approvals to its content and refuses once an approved document changed, which `next` sends back
 *   to approval (A-3, T048),
 *   `done` keeps every attempt and sets `[x]` only on exit 0 at a clean HEAD, a secret-looking command never runs, a
 *   changed document resets a started task with the reason, a hand tick is named, and `task wave` queues the next wave
 *   and holds it while one of its tasks failed.
 * Boundary: temporary repositories with a local bare origin; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945 FR-23, AC-22, AC-23, AC-24, P-028, NFR-5.
 */
// @covers sta-1945:FR-23 sta-1945:AC-22 sta-1945:AC-23 sta-1945:AC-24 sta-1945:P-028
// @covers sta-1945:FR-24 sta-1945:AC-25 sta-1945:P-029
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runCommandForTest } from "@stackra/console/testing";

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
import { next } from "../commands/next.mjs";
import { CONSOLE } from "../lib/console.mjs";
import { readRecord, recordPath } from "../lib/record.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

/** `fflow <argv>` through the console, in `cwd`; `out` is what it printed, both streams. */
const fflow = async (/** @type {string} */ cwd, /** @type {string[]} */ ...argv) => {
  const r = await runCommandForTest(CONSOLE, argv, { cwd, columns: 400 });
  return { ...r, out: r.stdout + r.stderr };
};

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

test("task through the console: a refusal exits 2 and runs nothing; a broken record exits 1", async (t) => {
  const s = setup(t);
  const run = (/** @type {string[]} */ argv) =>
    runCommandForTest(CONSOLE, argv, { cwd: s.root, columns: 400 });
  const missing = await run(["task", "start", "STA-7", "T009"]);
  assert.equal(missing.exitCode, 2, missing.stdout + missing.stderr);
  assert.match(missing.stdout + missing.stderr, /no live T009/);
  assert.equal((await run(["task", "start", "STA-7", "T001"])).exitCode, 0);
  const secret = await run(["task", "done", "STA-7", "T001", "--command", "env > leak.txt"]);
  assert.equal(secret.exitCode, 2, secret.stdout + secret.stderr);
  assert.equal(existsSync(join(s.root, "leak.txt")), false);
  writeFileSync(recordPath(s.root, "sta-7"), JSON.stringify({ recordVersion: 1, key: "sta-7" }));
  const broken = await run(["task", "start", "STA-7", "T002"]);
  assert.equal(broken.exitCode, 1, broken.stdout + broken.stderr);
  assert.match(broken.stdout + broken.stderr, /stage: is required/);
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

test("task start: resets each task whose documents changed, with the reason, then restarts it (AC-24)", async (t) => {
  const s = setup(t);
  startTask(s.root, "STA-7", "T001");
  startTask(s.root, "STA-7", "T002");
  writeFileSync(join(s.dir, "plan.md"), "# plan, amended\n");
  sh(s.root, "commit", "-q", "-am", "amend the plan");
  const r = await fflow(s.root, "task", "start", "STA-7", "T001");
  assert.equal(r.exitCode, 0, r.out);
  assert.match(r.out, /T001 is back to \[ \]: the spec, plan or tasks changed since T001 started/);
  assert.match(r.out, /T002 is back to \[ \]/);
  assert.deepEqual([s.marker("T001"), s.marker("T002")], ["-", " "]);
  assert.equal(readRecord(s.root, "sta-7")?.started?.T001?.docs, docsDigest(s.dir));
  assert.equal(doneTask(s.root, "STA-7", "T001", "true").done, true);
});

test("task start: a hand tick starts again; a task with passing evidence stays done (AC-22)", (t) => {
  const s = setup(t);
  startTask(s.root, "STA-7", "T001");
  doneTask(s.root, "STA-7", "T001", "true");
  writeFileSync(join(s.dir, "tasks.md"), setMarker(s.tasks(), "T002", "x"));
  assert.match(startTask(s.root, "STA-7", "T001").join(), /T001 is done/);
  assert.deepEqual(startTask(s.root, "STA-7", "T002"), []);
  assert.equal(s.marker("T002"), "-");
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

test("task wave: refuses a spec before Tasked and a deps cycle, moving no marker (FR-23, P-029)", async (t) => {
  const draft = setup(t, "Draft");
  assert.throws(() => queueWave(draft.root, "STA-7"), /the spec is draft/);
  assert.equal(draft.marker("T001"), " ");
  const s = setup(t, "Implementing");
  writeFileSync(
    join(s.dir, "tasks.md"),
    "- [ ] T001 A in `a.mjs` — deps: T002\n- [ ] T002 B in `b.mjs` — deps: T001\n",
  );
  assert.throws(() => queueWave(s.root, "STA-7"), TaskError);
  // the console prints the refusal and exits 2, never a stack trace
  const cli = await fflow(s.root, "task", "wave", "STA-7");
  assert.equal(cli.exitCode, 2, cli.out);
  assert.match(cli.out, /tasks\.md: dependency cycle through T00\d/);
  assert.equal(s.marker("T001"), " ");
  // `next` still names the build's command while the cycle stands
  const next = await fflow(s.root, "next", "STA-7", "--json");
  assert.equal(next.exitCode, 0, next.out);
  const step = /** @type {{ data: { stage: string, command: string, wave?: unknown } }} */ (
    next.json
  ).data;
  assert.deepEqual(
    [step.stage, step.command, step.wave],
    ["build", "fflow task wave STA-7", undefined],
  );
});

test("task wave: the console refuses a missing key, prints the wave, and the empty wave as JSON once all is done", async (t) => {
  const s = setup(t, "Implementing");
  assert.equal((await fflow(s.root, "task", "wave")).exitCode, 2);
  assert.match((await fflow(s.root, "next", "STA-7")).out, /wave 1 starts at T001: T001, T002/);
  const wave = await fflow(s.root, "task", "wave", "STA-7");
  assert.equal(wave.exitCode, 0, wave.out);
  assert.match(wave.out, /STA-7: wave 1 of 2, 2 to run/);
  assert.match(wave.out, /T001 \[~\] a\.mjs\n.*T002 \[~\] b\.mjs/s);
  assert.match((await fflow(s.root, "next", "STA-7")).out, /wave 1 restarts at T001: T001, T002/);
  writeFileSync(join(s.dir, "tasks.md"), TASKS.replaceAll("- [ ] T", "- [x] T"));
  const done = await fflow(s.root, "task", "wave", "STA-7", "--json");
  assert.equal(done.exitCode, 0, done.out);
  assert.deepEqual(/** @type {{ data: unknown }} */ (done.json).data, {
    schema: "fflow.wave/1",
    key: "STA-7",
    tasks: [],
  });
  assert.match((await fflow(s.root, "task", "wave", "STA-7")).out, /every wave of STA-7 is done/);
});

// @covers sta-1945:FR-30 sta-1945:AC-34 sta-1945:P-034
test("task start: binds the approvals, then refuses once an approved document changed; next goes back to approval", (t) => {
  const s = setup(t);
  const spec = (/** @type {string} */ body) =>
    `# x\n\n**Status**: Tasked\n\n${body}\n\n## Status history\n\n- 2026-11-03: Draft → Clarified — Approved by owner 2026-11-03\n`;
  writeFileSync(join(s.dir, "spec.md"), spec("Body."));
  assert.deepEqual(startTask(s.root, "STA-7", "T001"), []);
  assert.deepEqual(
    readRecord(s.root, "sta-7")?.approvals.map((a) => [a.stage, a.who, a.when]),
    [["clarified", "owner", "2026-11-03"]],
  );
  writeFileSync(join(s.dir, "spec.md"), spec("Body, edited."));
  assert.match(
    startTask(s.root, "STA-7", "T002").join(),
    /spec\.md changed since the clarified approval \(owner 2026-11-03\): approve it again/,
  );
  assert.equal(s.marker("T002"), " ");
  const step = next({ cwd: s.root, key: "STA-7" });
  assert.deepEqual(step.ok && [step.stage, step.reapprove], ["approval", "clarified"]);
});
