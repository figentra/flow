/**
 * Figentra Flow file contract:
 * Purpose: hold Flow's record to its contract: the shipped schema is `RECORD_SCHEMA`; `updateRecord` starts a new
 *   record, applies a change and refuses one that fails the schema (naming the field, writing nothing); a key never
 *   leaves the record folder; `commitRecord` commits and pushes the task's branch, merges once on a rejected push (and
 *   aborts a merge that does not apply clean, and never merges into a worktree holding work left out), never commits
 *   on the default branch or a detached HEAD, commits only the record unless it is a stop, never stages an untracked
 *   or secret-named file, runs the hooks whatever `LEFTHOOK` says, reports hooks that refuse apart from git's own
 *   failures, and undoes its staging when nothing is committed.
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
import { commit, refuseCommits, repo, sh } from "./__fixtures__/repo.mjs";

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

test("record: a rejected push that does not merge clean is aborted and reported, never forced", (t) => {
  const r = repo();
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", BRANCH);
  sh(r.root, "push", "-q", "-u", "origin", BRANCH);
  const other = join(dirname(r.root), "other");
  sh(dirname(r.root), "clone", "-q", "-b", BRANCH, r.origin, other);
  commit(other, "README.md", "theirs\n");
  sh(other, "push", "-q", "origin", BRANCH);
  writeFileSync(join(r.root, "README.md"), "mine\n");
  updateRecord(r.root, "sta-1", (rec) => rec);
  const saved = commitRecord(r.root, "sta-1", { message: "wip(s): stop", wip: true });
  assert.equal(saved.pushed, false);
  assert.match(saved.problem ?? "", /does not merge cleanly/);
  assert.equal(sh(r.root, "rev-parse", "HEAD"), saved.sha);
  assert.equal(sh(r.root, "status", "--porcelain"), "", "the merge was aborted");
  assert.notEqual(sh(r.origin, "rev-parse", BRANCH), saved.sha);
});

test("record: a detached HEAD commits nothing", (t) => {
  const r = repo();
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "--detach");
  updateRecord(r.root, "sta-1", (rec) => rec);
  const saved = commitRecord(r.root, "sta-1", { message: "chore(flow): record" });
  assert.equal(saved.pushed, false);
  assert.match(saved.problem ?? "", /detached/);
  assert.equal(sh(r.root, "rev-list", "--count", "HEAD"), "1");
});

test("record: a record commit takes only the record; a stop takes tracked changes, never untracked or secret files", (t) => {
  const r = repo({ "work.txt": "a\n", "deploy.key": "a\n" });
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", BRANCH);
  writeFileSync(join(r.root, "work.txt"), "b\n");
  sh(r.root, "add", "work.txt");
  updateRecord(r.root, "sta-1", (rec) => rec);
  commitRecord(r.root, "sta-1", { message: "chore(flow): record", push: false });
  assert.equal(sh(r.root, "show", "--name-only", "--format=", "HEAD"), ".flow/record/sta-1.json");
  assert.equal(sh(r.root, "diff", "--cached", "--name-only"), "work.txt", "the rest stays staged");

  writeFileSync(join(r.root, "deploy.key"), "b\n");
  writeFileSync(join(r.root, ".env.local"), "x\n");
  writeFileSync(join(r.root, "id_rsa"), "x\n");
  writeFileSync(join(r.root, "notes.txt"), "x\n");
  updateRecord(r.root, "sta-1", (rec) => ({ ...rec, stage: "build" }));
  const saved = commitRecord(r.root, "sta-1", { message: "wip(s): stop", wip: true });
  assert.equal(saved.pushed, true, saved.problem);
  assert.deepEqual(sh(r.root, "show", "--name-only", "--format=", "HEAD").split("\n").sort(), [
    ".flow/record/sta-1.json",
    "work.txt",
  ]);
  assert.deepEqual(saved.secrets?.sort(), [".env.local", "deploy.key", "id_rsa"]);
  assert.deepEqual(saved.untracked, ["notes.txt"]);
  assert.equal(
    sh(r.root, "diff", "--name-only"),
    "deploy.key",
    "the secret stays in the worktree, unstaged",
  );
});

test("record: hooks that refuse the commit leave the work uncommitted and unstaged, with their output", (t) => {
  const r = repo();
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", BRANCH);
  refuseCommits(r.root, "lint: 2 problems");
  writeFileSync(join(r.root, "README.md"), "changed\n");
  updateRecord(r.root, "sta-1", (rec) => rec);
  const saved = commitRecord(r.root, "sta-1", { message: "wip(s): stop", wip: true });
  assert.equal(saved.pushed, false);
  assert.equal(saved.uncommitted, true);
  assert.match(saved.hooks ?? "", /lint: 2 problems/);
  assert.equal(sh(r.root, "rev-list", "--count", "HEAD"), "1");
  assert.ok(existsSync(join(r.root, ".flow", "record", "sta-1.json")));
  assert.equal(sh(r.root, "diff", "--cached", "--name-only"), "", "the staging is undone");
  assert.equal(sh(r.root, "diff", "--name-only"), "README.md", "the working tree keeps the change");
});

test("record: a commit git itself refuses is reported as git's failure, never as the hooks'", (t) => {
  const r = repo();
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", BRANCH);
  // Signing with a program that does not exist: git fails with its own `fatal:`, no hook involved.
  sh(r.root, "config", "commit.gpgsign", "true");
  sh(r.root, "config", "gpg.program", join(dirname(r.root), "no-such-gpg"));
  updateRecord(r.root, "sta-1", (rec) => rec);
  const saved = commitRecord(r.root, "sta-1", { message: "wip(s): stop", wip: true });
  assert.equal(saved.pushed, false);
  assert.equal(saved.uncommitted, true);
  assert.equal(saved.hooks, undefined);
  assert.match(saved.problem ?? "", /^git commit failed: [\s\S]*fatal: /);
  assert.equal(sh(r.root, "rev-list", "--count", "HEAD"), "1");
  assert.equal(sh(r.root, "diff", "--cached", "--name-only"), "");
});

test("record: the commit runs the hooks even when LEFTHOOK or LEFTHOOK_EXCLUDE is set (FR-18)", (t) => {
  const r = repo();
  t.after(r.dispose);
  const was = { LEFTHOOK: process.env.LEFTHOOK, LEFTHOOK_EXCLUDE: process.env.LEFTHOOK_EXCLUDE };
  t.after(() => {
    for (const [name, value] of Object.entries(was))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  });
  process.env.LEFTHOOK = "0";
  process.env.LEFTHOOK_EXCLUDE = "oxlint";
  sh(r.root, "switch", "-q", "-c", BRANCH);
  const hooks = join(dirname(r.root), "hooks");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(
    join(hooks, "pre-commit"),
    `#!/bin/sh\n[ -z "\${LEFTHOOK+x}\${LEFTHOOK_EXCLUDE+x}" ] || { echo 'LEFTHOOK reached the hook' >&2; exit 1; }\n`,
    { mode: 0o755 },
  );
  sh(r.root, "config", "core.hooksPath", hooks);
  updateRecord(r.root, "sta-1", (rec) => rec);
  const saved = commitRecord(r.root, "sta-1", { message: "wip(s): stop", wip: true });
  assert.equal(saved.hooks, undefined, saved.problem);
  assert.equal(saved.pushed, true, saved.problem);
  assert.equal(sh(r.root, "rev-list", "--count", "HEAD"), "2");
});

test("record: a rejected push never merges into a worktree holding work left out of the commit", (t) => {
  const r = repo();
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", BRANCH);
  sh(r.root, "push", "-q", "-u", "origin", BRANCH);
  const other = join(dirname(r.root), "other");
  sh(dirname(r.root), "clone", "-q", "-b", BRANCH, r.origin, other);
  commit(other, "theirs.txt");
  sh(other, "push", "-q", "origin", BRANCH);
  writeFileSync(join(r.root, "notes.txt"), "mine\n");
  updateRecord(r.root, "sta-1", (rec) => rec);
  const saved = commitRecord(r.root, "sta-1", { message: "wip(s): stop", wip: true });
  assert.equal(saved.pushed, false);
  assert.equal(saved.uncommitted, undefined);
  assert.match(saved.problem ?? "", /origin moved; resume first/);
  assert.doesNotMatch(saved.problem ?? "", /does not merge cleanly/);
  assert.equal(sh(r.root, "rev-list", "--count", "HEAD"), "2", "the stop's commit, no merge");
  assert.equal(sh(r.root, "status", "--porcelain"), "?? notes.txt");
  assert.notEqual(sh(r.origin, "rev-parse", BRANCH), saved.sha);
});
