/**
 * Figentra Flow file contract:
 * Purpose: hold the stage commands to STA-1945 FR-14 (T015): a stage that ends writes Flow's record on the task's
 *   branch and commits and pushes it (`endStage`), so `fflow next` names the stage that follows: `start` (`worktree`
 *   for a Tasked spec), `spec setup-plan`, `gate run` (written, never committed, so the gated head stays the tip, and a
 *   tree dirty only with the record still gates), and `ship` (only in a landed task's checkout). Nothing is written on
 *   the default branch, and a refused commit is the problem the caller warns with. `land`'s record is held in
 *   land.test.mjs.
 * Boundary: temporary repositories with a local bare origin; the tracker and the gate's runner injected; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945 FR-13, FR-14, AC-13, AC-18, P-019.
 */
// @covers sta-1945:FR-13 sta-1945:FR-14 sta-1945:AC-13 sta-1945:AC-18 sta-1945:P-019
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { gateRun, recordGate } from "../commands/gate-run.mjs";
import { next } from "../commands/next.mjs";
import { recordShip } from "../commands/ship.mjs";
import { locate, setupPlan } from "../commands/spec.mjs";
import { start } from "../commands/start.mjs";
import { endStage, readRecord, recordPath, updateRecord } from "../lib/record.mjs";
import { refuseCommits, repo, sh } from "./__fixtures__/repo.mjs";

const quiet = { log: () => {}, warn: () => {} };
const issues = { title: async () => "x", inProgress: async () => {} };

/** A repository on the task branch of `key`. */
function onBranch(/** @type {import("node:test").TestContext} */ t, key = "sta-3") {
  const r = repo();
  t.after(r.dispose);
  const branch = `figentra/${key}-x`;
  sh(r.root, "switch", "-q", "-c", branch);
  return { ...r, branch };
}

/** The files the commit at HEAD changed. */
const changed = (/** @type {string} */ root) =>
  sh(root, "show", "--name-only", "--format=", "HEAD").split("\n");

test("endStage: the stage written, committed alone and pushed; nothing on the default branch", (t) => {
  const r = repo();
  t.after(r.dispose);
  assert.equal(endStage(r.root, "sta-3", "spec"), undefined);
  assert.equal(existsSync(recordPath(r.root, "sta-3")), false, "main holds no record");
  const b = onBranch(t);
  writeFileSync(join(b.root, "work.txt"), "x\n");
  assert.equal(endStage(b.root, "sta-3", "spec"), undefined);
  assert.deepEqual(
    [readRecord(b.root, "sta-3")?.stage, readRecord(b.root, "sta-3")?.state],
    ["spec", "done"],
  );
  assert.deepEqual(changed(b.root), [".flow/record/sta-3.json"]);
  assert.match(
    sh(b.root, "log", "-1", "--format=%B"),
    /^chore\(flow\): STA-3 spec done\n\nRefs: STA-3/,
  );
  assert.equal(
    sh(b.origin, "rev-parse", `refs/heads/${b.branch}`),
    sh(b.root, "rev-parse", "HEAD"),
  );
  // A refused commit is the caller's warning; the record stays written for the next commit.
  refuseCommits(b.root, "no");
  const head = sh(b.root, "rev-parse", "HEAD");
  assert.match(endStage(b.root, "sta-3", "plan") ?? "", /hooks refused/);
  assert.equal(sh(b.root, "rev-parse", "HEAD"), head);
  assert.equal(readRecord(b.root, "sta-3")?.stage, "plan");
});

test("start: the record's start pushed on the new branch, so next names the spec; a Tasked spec skips to the build", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const one = await start({ cwd: r.root, key: "STA-12", slug: "one", issues, ...quiet });
  const path = one.path ?? "";
  assert.equal(readRecord(path, "sta-12")?.stage, "start");
  assert.equal(sh(path, "rev-parse", "HEAD^"), sh(r.root, "rev-parse", "origin/main"));
  assert.equal(
    sh(r.origin, "rev-parse", `refs/heads/${one.branch}`),
    sh(path, "rev-parse", "HEAD"),
  );
  const step = next({ cwd: path });
  assert.deepEqual(step.ok && [step.stage, step.recorded], ["spec", true]);
  // A spec already Tasked on the default branch: the worktree stage is done, the build is next.
  const dir = join(r.root, ".agents", "specs", "sta-13-two");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.md"), "# x\n\n**Status**: Tasked\n");
  sh(r.root, "add", "-A");
  sh(r.root, "commit", "-q", "-m", "spec");
  sh(r.root, "push", "-q", "origin", "main");
  const two = await start({ cwd: r.root, key: "STA-13", slug: "two", issues, ...quiet });
  assert.equal(readRecord(two.path ?? "", "sta-13")?.stage, "worktree");
  const built = next({ cwd: two.path ?? "" });
  assert.equal(built.ok && built.stage, "build");
});

test("spec setup-plan: the spec stage ends in the record, committed and pushed", (t) => {
  const b = onBranch(t, "sta-5");
  const dir = join(b.root, ".agents", "specs", "sta-5-x");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.md"), "# x\n\n**Status**: Clarified\n");
  writeFileSync(join(dir, "plan.md"), "mine\n");
  setupPlan(locate(b.root), { planGate: () => 0, log: () => {} });
  assert.deepEqual(
    [readRecord(b.root, "sta-5")?.stage, readRecord(b.root, "sta-5")?.state],
    ["spec", "done"],
  );
  assert.deepEqual(changed(b.root), [".flow/record/sta-5.json"]);
  assert.equal(
    sh(b.origin, "rev-parse", `refs/heads/${b.branch}`),
    sh(b.root, "rev-parse", "HEAD"),
  );
});

test("gate run: the verdict is written, never committed; a tree dirty only with the record still gates", async (t) => {
  const b = onBranch(t, "sta-6");
  const head = sh(b.root, "rev-parse", "HEAD");
  assert.equal(recordGate(b.root, "a".repeat(40), 1), undefined);
  assert.deepEqual(
    [readRecord(b.root, "sta-6")?.stage, readRecord(b.root, "sta-6")?.state],
    ["gate", "failed"],
  );
  recordGate(b.root, "b".repeat(40), 0);
  const record = readRecord(b.root, "sta-6");
  assert.deepEqual(
    [record?.state, record?.gate],
    [
      "done",
      [
        { sha: "a".repeat(40), state: "failure" },
        { sha: "b".repeat(40), state: "success" },
      ],
    ],
  );
  assert.equal(sh(b.root, "rev-parse", "HEAD"), head, "nothing committed");
  // The record is the only change: the gate still runs, on the pushed head.
  sh(b.root, "push", "-q", "origin", b.branch);
  sh(b.root, "remote", "set-url", "origin", "git@github.com:figentra/flow.git");
  sh(b.root, "remote", "set-url", "--push", "origin", b.origin);
  let ran = 0;
  const result = await gateRun({
    cwd: b.root,
    tip: () => head,
    runner: { kind: "command", wraps: false, program: "stackra", run: () => (ran++, 0) },
  });
  assert.deepEqual([result.code, result.problem, ran], [0, undefined, 1]);
  writeFileSync(join(b.root, "wip.txt"), "x\n");
  assert.match((await gateRun({ cwd: b.root, tip: () => head })).problem ?? "", /uncommitted/);
});

test("ship: recorded only in a landed task's checkout", (t) => {
  const b = onBranch(t, "sta-8");
  assert.equal(recordShip(b.root), undefined);
  assert.equal(existsSync(recordPath(b.root, "sta-8")), false, "no record: nothing landed here");
  updateRecord(b.root, "sta-8", (r) => ({ ...r, stage: "land", state: "done" }));
  assert.equal(recordShip(b.root), undefined);
  assert.equal(readRecord(b.root, "sta-8")?.stage, "ship");
  assert.deepEqual(changed(b.root), [".flow/record/sta-8.json"]);
  assert.equal(
    sh(b.origin, "rev-parse", `refs/heads/${b.branch}`),
    sh(b.root, "rev-parse", "HEAD"),
  );
});
