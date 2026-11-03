/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow next` to its contract: the key comes from the branch or the argument; with no record the task
 *   is at the stage its spec proves (else `start`); a record names its stage and command, read from the key's worktree
 *   or branch rather than this checkout; an unpushed record is flagged; a record that fails its schema is refused by
 *   its field; with no key and none on the branch, it asks for one.
 * Boundary: temporary repositories with a local bare origin; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-13 sta-1945:AC-13 sta-1945:P-017
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { next } from "../commands/next.mjs";
import { commitRecord, updateRecord } from "../lib/record.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

test("next: no record names start, or the stage the spec proves", (t) => {
  const r = repo();
  t.after(r.dispose);
  assert.deepEqual(next({ cwd: r.root, key: "STA-7" }), {
    ok: true,
    key: "sta-7",
    recorded: false,
    state: "active",
    stage: "start",
    command: "fflow start STA-7",
    unpushed: false,
  });
  const dir = join(r.root, ".agents", "specs", "sta-7-x");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.md"), "# x\n\n**Status**: Draft\n");
  const step = next({ cwd: r.root, key: "sta-7" });
  assert.equal(step.ok && step.command, "fflow gate check .agents/specs/sta-7-x");
});

test("next: the branch's record names its stage, and an unpushed one is flagged", (t) => {
  const r = repo();
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", "figentra/sta-7-next");
  updateRecord(r.root, "sta-7", (rec) => ({ ...rec, stage: "gate", state: "failed" }));
  commitRecord(r.root, "sta-7", { message: "chore(flow): record", push: false });
  const step = next({ cwd: r.root });
  assert.ok(step.ok);
  assert.equal(step.recorded, true);
  assert.equal(step.stage, "gate");
  assert.equal(step.command, "fflow gate run");
  assert.equal(step.unpushed, true);
  commitRecord(r.root, "sta-7", { message: "chore(flow): record" });
  const pushed = next({ cwd: r.root });
  assert.equal(pushed.ok && pushed.unpushed, false);
});

test("next: a record that fails its schema is refused by its field", (t) => {
  const r = repo();
  t.after(r.dispose);
  mkdirSync(join(r.root, ".flow", "record"), { recursive: true });
  writeFileSync(
    join(r.root, ".flow", "record", "sta-8.json"),
    JSON.stringify({ recordVersion: 1, key: "sta-8" }),
  );
  const step = next({ cwd: r.root, key: "STA-8" });
  assert.equal(step.ok, false);
  assert.match(!step.ok ? step.problem : "", /stage: is required/);
});

test("next <key> reads the record on the key's worktree or branch, not this checkout", (t) => {
  const r = repo();
  t.after(r.dispose);
  const path = join(r.root, ".claude", "worktrees", "sta-9-elsewhere");
  sh(r.root, "worktree", "add", "-q", "-b", "figentra/sta-9-elsewhere", path, "origin/main");
  updateRecord(path, "sta-9", (rec) => ({ ...rec, stage: "review", state: "active" }));
  const open = next({ cwd: r.root, key: "STA-9" });
  assert.equal(open.ok && open.stage, "review", JSON.stringify(open));
  assert.equal(open.ok && open.recorded, true);

  // The worktree is gone; only the branch, local or pushed, holds the record.
  commitRecord(path, "sta-9", { message: "chore(flow): record" });
  sh(r.root, "worktree", "remove", "--force", path);
  const local = next({ cwd: r.root, key: "STA-9" });
  assert.equal(local.ok && local.stage, "review", JSON.stringify(local));
  assert.equal(local.ok && local.unpushed, false);
  sh(r.root, "branch", "-D", "figentra/sta-9-elsewhere");
  const pushed = next({ cwd: r.root, key: "STA-9" });
  assert.equal(pushed.ok && pushed.stage, "review", JSON.stringify(pushed));
});

test("next: with no key on a branch that names none, it asks for one", (t) => {
  const r = repo();
  t.after(r.dispose);
  const step = next({ cwd: r.root });
  assert.equal(step.ok, false);
  assert.match(!step.ok ? step.problem : "", /no issue key: pass one/);
});
