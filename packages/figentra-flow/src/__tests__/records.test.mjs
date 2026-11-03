/**
 * Figentra Flow file contract:
 * Purpose: hold `allRecords` to FR-21: it finds each key's record on the default branch, on a branch with no checkout,
 *   on origin only, and in a worktree's uncommitted file (newer than its branch's commit, so it wins), across every
 *   repository it is given; an unreadable record is returned as its problem, never dropped.
 * Boundary: temporary repositories with a local bare origin; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-21 sta-1945:AC-20 sta-1945:AC-42 sta-1945:P-026
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { commitRecord, updateRecord } from "../lib/record.mjs";
import { allRecords } from "../lib/records.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

test("records: each key's newest record from the default branch, branches, origin and worktrees", (t) => {
  const r = repo();
  t.after(r.dispose);
  const other = repo();
  t.after(other.dispose);
  /**
   * @param {string} branch
   * @param {string} key
   * @param {import("../lib/stages.mjs").Stage} stage
   */
  const onBranch = (branch, key, stage) => {
    sh(r.root, "switch", "-q", "-c", branch);
    updateRecord(r.root, key, (rec) => ({ ...rec, stage }));
    commitRecord(r.root, key, { message: `chore(flow): ${key}`, push: false });
    sh(r.root, "switch", "-q", "main");
  };
  onBranch("figentra/sta-2-local", "sta-2", "plan");
  onBranch("figentra/sta-3-pushed", "sta-3", "review");
  sh(r.root, "push", "-q", "origin", "figentra/sta-3-pushed");
  sh(r.root, "branch", "-q", "-D", "figentra/sta-3-pushed");

  const path = join(r.root, ".claude", "worktrees", "sta-4-tree");
  sh(r.root, "worktree", "add", "-q", "-b", "figentra/sta-4-tree", path, "main");
  updateRecord(path, "sta-4", (rec) => ({ ...rec, stage: "plan" }));
  commitRecord(path, "sta-4", { message: "chore(flow): sta-4", push: false });
  // The Stop hook saves the record in the worktree; it is not committed yet.
  updateRecord(path, "sta-4", (rec) => ({ ...rec, stage: "build" }));

  updateRecord(other.root, "sta-9", (rec) => ({ ...rec, stage: "land", state: "done" }));
  sh(other.root, "add", "-A");
  sh(other.root, "commit", "-q", "-m", "landed");

  const found = allRecords([r.root, other.root]);
  const of = (/** @type {string} */ key) => found.find((e) => e.key === key);
  assert.deepEqual(
    [of("sta-2"), of("sta-3"), of("sta-4")].map((e) => [e?.repo, e?.from, e?.record?.stage]),
    [
      [r.root, "figentra/sta-2-local", "plan"],
      [r.root, "origin/figentra/sta-3-pushed", "review"],
      [r.root, path, "build"],
    ],
  );
  assert.equal(of("sta-9")?.repo, other.root);
  assert.equal(of("sta-9")?.record?.stage, "land");
  assert.equal(found.filter((e) => e.key === "sta-4").length, 1);
  assert.ok(found.every((e) => !e.problem));
});

test("records: an unreadable record is a problem, never dropped", (t) => {
  const r = repo();
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", "figentra/sta-6-broken");
  mkdirSync(join(r.root, ".flow", "record"), { recursive: true });
  writeFileSync(join(r.root, ".flow", "record", "sta-6.json"), "{");
  sh(r.root, "add", "-A");
  sh(r.root, "commit", "-q", "-m", "broken");
  sh(r.root, "switch", "-q", "main");
  const [only] = allRecords([r.root]);
  assert.equal(only.key, "sta-6");
  assert.equal(only.from, "figentra/sta-6-broken");
  assert.equal(only.record, undefined);
  assert.match(only.problem ?? "", /not valid JSON/);
});
