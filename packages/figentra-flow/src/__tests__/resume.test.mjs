/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow resume` to its contract (AC-13, P-017): after a session stopped mid-stage and its checkout is
 *   gone, resume rebuilds the worktree from the pushed branch with no work lost, re-runs a repeatable stage's command
 *   to its end state, records and pushes the outcome; a failing command leaves the stage failed; a stage that is not
 *   repeatable unattended, or a finished one, is only named.
 * Boundary: temporary repositories with a local bare origin; the stage command injected; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-13 sta-1945:AC-13 sta-1945:P-017
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resume } from "../commands/resume.mjs";
import { stopSession } from "../commands/session.mjs";
import { readRecord, updateRecord } from "../lib/record.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

const BRANCH = "figentra/sta-3-resume";

/**
 * A repository where a session left `sta-3` at `stage` in `state` with uncommitted work, stopped (pushing it), and
 * then lost its checkout: the worktree and the local branch are gone.
 */
function stopped(
  /** @type {import("node:test").TestContext} */ t,
  /** @type {import("../lib/stages.mjs").Stage} */ stage,
  /** @type {"active" | "done" | "failed"} */ state,
) {
  const r = repo();
  t.after(r.dispose);
  const path = join(r.root, ".claude", "worktrees", "sta-3-resume");
  sh(r.root, "worktree", "add", "-q", "-b", BRANCH, path, "origin/main");
  updateRecord(path, "sta-3", (rec) => ({ ...rec, stage, state }));
  writeFileSync(join(path, "work.txt"), "half done\n");
  const stop = stopSession({ cwd: path, name: "FLOW · resume (STA-3)" });
  assert.ok("pushed" in stop && stop.pushed, JSON.stringify(stop));
  sh(r.root, "worktree", "remove", "--force", path);
  sh(r.root, "branch", "-D", BRANCH);
  return { r, path };
}

test("resume: a dead session's stage is rebuilt from the remote, re-run to its end and pushed (AC-13)", (t) => {
  const { r, path } = stopped(t, "gate", "active");
  /** @type {string[]} */
  const ran = [];
  const result = resume({
    cwd: r.root,
    key: "STA-3",
    run: (command, cwd) => {
      ran.push(`${command} @ ${cwd}`);
      return 0;
    },
  });
  assert.ok(result.ok, !result.ok ? result.problem : "");
  assert.equal(result.made, true);
  assert.equal(result.path, path);
  assert.deepEqual(ran, [`fflow gate run @ ${path}`]);
  assert.equal(result.ran && result.exit, 0);
  assert.ok(existsSync(join(path, "work.txt")), "the stopped session's work is back");
  assert.equal(readRecord(path, "sta-3")?.state, "done");
  assert.equal(result.pushed, true, result.problem);
  assert.equal(JSON.parse(sh(r.origin, "show", `${BRANCH}:.flow/record/sta-3.json`)).state, "done");
});

test("resume: a failing command leaves the stage failed", (t) => {
  const { r, path } = stopped(t, "land", "failed");
  const result = resume({ cwd: r.root, key: "sta-3", run: () => 1 });
  assert.ok(result.ok && result.ran);
  assert.equal(result.exit, 1);
  assert.equal(readRecord(path, "sta-3")?.state, "failed");
});

test("resume: a stage only a session or the owner can finish, or a finished one, is named, not run", (t) => {
  const { r } = stopped(t, "build", "active");
  const never = () => assert.fail("must not run");
  const build = resume({ cwd: r.root, key: "STA-3", run: never });
  assert.ok(build.ok);
  assert.equal(build.ran, false);
  assert.equal(build.command, "fflow task wave STA-3");
  if (build.ok) updateRecord(build.path, "sta-3", (rec) => ({ ...rec, state: "done" }));
  const after = resume({ cwd: r.root, key: "STA-3", run: never });
  assert.ok(after.ok && !after.ran);
  assert.equal(after.stage, "gate");
});

test("resume: a key with no branch is refused", (t) => {
  const r = repo();
  t.after(r.dispose);
  const result = resume({ cwd: r.root, key: "STA-404" });
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.problem : "", /no branch for STA-404/);
});
