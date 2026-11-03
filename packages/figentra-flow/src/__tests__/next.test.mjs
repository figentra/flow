/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow next` to its contract: the key comes from the branch or the argument; with no record the task
 *   is at the stage its spec proves (else `start`); a record names its stage and command; an unpushed record is
 *   flagged; a record that fails its schema is refused by its field.
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
