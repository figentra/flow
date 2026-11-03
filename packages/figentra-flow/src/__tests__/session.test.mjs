/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow session stop` to its contract (FR-19, AC-18, P-019): on a task's branch the session's work and
 *   its end in the record are committed as `wip(<name>)` and pushed; a second stop updates the same session; the
 *   default branch is left alone; a push that fails is recorded as `pushed: false` and committed locally.
 * Boundary: temporary repositories with a local bare origin; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-19 sta-1945:FR-14 sta-1945:AC-18 sta-1945:P-019
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { stopSession } from "../commands/session.mjs";
import { readRecord } from "../lib/record.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

const BRANCH = "figentra/sta-5-session";
const NAME = "FLOW · stop (STA-5)";

test("session stop: the work and the record are on the remote (AC-18)", (t) => {
  const r = repo();
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", BRANCH);
  writeFileSync(join(r.root, "work.txt"), "unsaved\n");
  const first = stopSession({ cwd: r.root, name: NAME, now: "2026-11-03T10:00:00Z" });
  assert.ok("pushed" in first && first.pushed, JSON.stringify(first));
  assert.equal(sh(r.origin, "rev-parse", BRANCH), first.sha);
  assert.equal(sh(r.origin, "show", `${BRANCH}:work.txt`), "unsaved");
  assert.match(sh(r.root, "log", "-1", "--format=%s"), /^wip\(FLOW · stop \(STA-5\)\): /);
  assert.equal(sh(r.root, "status", "--porcelain"), "");

  writeFileSync(join(r.root, "work.txt"), "more\n");
  stopSession({ cwd: r.root, name: NAME, now: "2026-11-03T11:00:00Z" });
  assert.deepEqual(readRecord(r.root, "sta-5")?.sessions, [
    { name: NAME, kind: "claude-code", start: "2026-11-03T10:00:00Z", end: "2026-11-03T11:00:00Z" },
  ]);
  assert.equal(sh(r.origin, "show", `${BRANCH}:work.txt`), "more");
});

test("session stop: the default branch and a branch with no key are left alone", (t) => {
  const r = repo();
  t.after(r.dispose);
  const skipped = () => {
    const result = stopSession({ cwd: r.root, name: NAME });
    return "skipped" in result ? result.skipped : "";
  };
  writeFileSync(join(r.root, "work.txt"), "x\n");
  assert.match(skipped(), /default branch/);
  sh(r.root, "switch", "-q", "-c", "scratch");
  assert.match(skipped(), /no issue key/);
  assert.equal(sh(r.root, "rev-list", "--count", "HEAD"), "1");
});

test("session stop: a failed push is recorded as pushed false and committed locally", (t) => {
  const r = repo();
  t.after(r.dispose);
  sh(r.root, "switch", "-q", "-c", BRANCH);
  sh(r.root, "remote", "set-url", "origin", join(r.root, "..", "gone.git"));
  writeFileSync(join(r.root, "work.txt"), "unsaved\n");
  const result = stopSession({ cwd: r.root, name: NAME });
  assert.ok("pushed" in result);
  assert.equal(result.pushed, false);
  assert.ok(result.problem);
  assert.equal(readRecord(r.root, "sta-5")?.sessions[0].pushed, false);
  assert.equal(sh(r.root, "status", "--porcelain"), "");
});
