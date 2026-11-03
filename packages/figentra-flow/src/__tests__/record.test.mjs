/**
 * Figentra Flow file contract:
 * Purpose: hold Flow's record to its contract: the shipped schema is `RECORD_SCHEMA`; `updateRecord` starts a new
 *   record, applies a change and refuses one that fails the schema (naming the field, writing nothing); a key never
 *   leaves the record folder; `commitRecord` commits and pushes the task's branch, merges once on a rejected push,
 *   and never commits on the default branch.
 * Boundary: temporary repositories with a local bare origin; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-14 sta-1945:AC-13 sta-1945:AC-18 sta-1945:P-019
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  commitRecord,
  emptyRecord,
  readRecord,
  RECORD_SCHEMA,
  RecordError,
  recordPath,
  recordProblems,
  updateRecord,
} from "../lib/record.mjs";
import { STAGES } from "../lib/stages.mjs";
import { commit, repo, sh } from "./__fixtures__/repo.mjs";

const PACKAGE_DIR = fileURLToPath(new URL("../..", import.meta.url));
const BRANCH = "figentra/sta-1-record";

test("record: the shipped schema is RECORD_SCHEMA, and its stages are the stage table's", () => {
  assert.deepEqual(
    JSON.parse(readFileSync(join(PACKAGE_DIR, "schema", "record.schema.json"), "utf8")),
    RECORD_SCHEMA,
  );
  assert.deepEqual(RECORD_SCHEMA.properties.stage.enum, STAGES);
  assert.deepEqual(recordProblems(emptyRecord("STA-1")), []);
});

test("record: update starts a new record, applies the change and reads back", (t) => {
  const r = repo();
  t.after(r.dispose);
  assert.equal(readRecord(r.root, "sta-1"), undefined);
  const written = updateRecord(r.root, "STA-1", (rec) => ({
    ...rec,
    stage: "gate",
    prs: [74],
    asks: [{ what: "approve the release Environment", command: "https://example.test/approve" }],
  }));
  assert.equal(written.key, "sta-1");
  assert.deepEqual(readRecord(r.root, "sta-1"), written);
  assert.ok(existsSync(join(r.root, ".flow", "record", "sta-1.json")));
});

test("record: a change that fails the schema is refused by its field, and nothing is written", (t) => {
  const r = repo();
  t.after(r.dispose);
  assert.throws(
    () => updateRecord(r.root, "sta-1", (rec) => ({ ...rec, stage: /** @type {any} */ ("later") })),
    (error) => error instanceof RecordError && /stage: must be one of/.test(error.message),
  );
  assert.equal(readRecord(r.root, "sta-1"), undefined);
  assert.throws(
    () => updateRecord(r.root, "sta-1", (rec) => ({ ...rec, prs: [0] })),
    /prs\[0\]: must be at least 1/,
  );
});

test("record: a broken file is refused, and a key is never a path", (t) => {
  const r = repo();
  t.after(r.dispose);
  mkdirSync(join(r.root, ".flow", "record"), { recursive: true });
  writeFileSync(join(r.root, ".flow", "record", "sta-2.json"), "{");
  assert.throws(() => readRecord(r.root, "sta-2"), /not valid JSON/);
  writeFileSync(join(r.root, ".flow", "record", "sta-2.json"), "{}");
  assert.throws(() => readRecord(r.root, "sta-2"), /recordVersion: is required/);
  assert.throws(() => recordPath(r.root, "../../etc/x-1"), RecordError);
});

test("record: commit pushes the task's branch with the record (P-019)", (t) => {
  const r = repo();
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", BRANCH);
  updateRecord(r.root, "sta-1", (rec) => rec);
  const saved = commitRecord(r.root, "sta-1", { message: "chore(flow): record\n\nRefs: STA-1" });
  assert.equal(saved.pushed, true, saved.problem);
  assert.equal(sh(r.origin, "rev-parse", BRANCH), saved.sha);
  assert.equal(JSON.parse(sh(r.origin, "show", `${BRANCH}:.flow/record/sta-1.json`)).key, "sta-1");
});

test("record: a rejected push is merged once and retried, never forced", (t) => {
  const r = repo();
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", BRANCH);
  sh(r.root, "push", "-q", "-u", "origin", BRANCH);
  const other = join(dirname(r.root), "other");
  sh(dirname(r.root), "clone", "-q", "-b", BRANCH, r.origin, other);
  commit(other, "theirs.txt");
  sh(other, "push", "-q", "origin", BRANCH);
  updateRecord(r.root, "sta-1", (rec) => rec);
  const saved = commitRecord(r.root, "sta-1", { message: "chore(flow): record" });
  assert.equal(saved.pushed, true, saved.problem);
  assert.equal(sh(r.origin, "rev-parse", BRANCH), saved.sha);
  sh(r.root, "merge-base", "--is-ancestor", sh(other, "rev-parse", "HEAD"), saved.sha);
});

test("record: nothing is committed on the default branch", (t) => {
  const r = repo();
  t.after(r.dispose);
  const before = sh(r.root, "rev-parse", "HEAD");
  updateRecord(r.root, "sta-1", (rec) => rec);
  const saved = commitRecord(r.root, "sta-1", { message: "chore(flow): record" });
  assert.equal(saved.pushed, false);
  assert.match(saved.problem ?? "", /default branch/);
  assert.equal(sh(r.root, "rev-parse", "HEAD"), before);
});
