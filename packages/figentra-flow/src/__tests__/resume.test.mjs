/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow resume` to its contract (AC-13, P-017): after a session stopped mid-stage and its checkout is
 *   gone, resume rebuilds the worktree from the pushed branch with no work lost, re-runs a repeatable stage's command
 *   to its end state, records and pushes the outcome; a failing command leaves the stage failed; a stage that is not
 *   repeatable unattended, or a finished one, is only named; a stale local branch is fast-forwarded first, a diverged
 *   one refused; every refusal names its reason and runs nothing.
 * Boundary: temporary repositories with a local bare origin; the stage command injected; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-13 sta-1945:AC-13 sta-1945:P-017
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { resume } from "../commands/resume.mjs";
import { stopSession } from "../commands/session.mjs";
import { readRecord, updateRecord } from "../lib/record.mjs";
import { commit, repo, sh } from "./__fixtures__/repo.mjs";

const BRANCH = "figentra/sta-3-resume";

/**
 * A repository where a session left `sta-3` at `stage` in `state` with uncommitted work, stopped (pushing it), and
 * then lost its checkout: the worktree and the local branch are gone.
 */
function stopped(
  /** @type {import("node:test").TestContext} */ t,
  /** @type {import("../lib/stages.mjs").Stage} */ stage,
  /** @type {"active" | "done" | "failed"} */ state,
  /** `keep` keeps the worktree, `keepBranch` only the local branch */
  { keep = false, keepBranch = false } = {},
) {
  const r = repo({ "work.txt": "not started\n" });
  t.after(r.dispose);
  const path = join(r.root, ".claude", "worktrees", "sta-3-resume");
  sh(r.root, "worktree", "add", "-q", "-b", BRANCH, path, "origin/main");
  updateRecord(path, "sta-3", (rec) => ({ ...rec, stage, state }));
  writeFileSync(join(path, "work.txt"), "half done\n");
  const stop = stopSession({ cwd: path, name: "FLOW · resume (STA-3)" });
  assert.ok("pushed" in stop && stop.pushed, JSON.stringify(stop));
  if (keep) return { r, path };
  sh(r.root, "worktree", "remove", "--force", path);
  if (!keepBranch) sh(r.root, "branch", "-D", BRANCH);
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
  assert.equal(readFileSync(join(path, "work.txt"), "utf8"), "half done\n", "the work is back");
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

/** The problem a refused resume names, or "" when it was not refused. */
const refused = (/** @type {ReturnType<typeof resume>} */ result) =>
  result.ok ? "" : result.problem;
const never = () => assert.fail("must not run");

/** Pushes a commit to `branch` from another clone, so origin is ahead of this checkout. */
function pushTheirs(
  /** @type {{ root: string, origin: string }} */ r,
  /** @type {string} */ branch,
) {
  const other = join(dirname(r.root), "other");
  sh(dirname(r.root), "clone", "-q", "-b", branch, r.origin, other);
  commit(other, "theirs.txt");
  sh(other, "push", "-q", "origin", branch);
}

test("resume: a stale local branch is fast-forwarded to the pushed one before the stage re-runs", (t) => {
  const { r, path } = stopped(t, "gate", "active", { keepBranch: true });
  pushTheirs(r, BRANCH);
  /** @type {string[]} */
  const seen = [];
  const result = resume({
    cwd: r.root,
    key: "STA-3",
    run: (_, cwd) => {
      seen.push(readFileSync(join(cwd, "theirs.txt"), "utf8"));
      return 0;
    },
  });
  assert.ok(result.ok && result.ran, refused(result));
  assert.equal(result.path, path);
  assert.deepEqual(seen, ["theirs.txt\n"], "the stage ran on the pushed branch's tip");
  assert.equal(result.pushed, true, result.problem);
});

test("resume: a local branch that diverged from the pushed one is refused, not run", (t) => {
  const { r, path } = stopped(t, "gate", "active", { keep: true });
  commit(path, "mine.txt");
  pushTheirs(r, BRANCH);
  const result = resume({ cwd: r.root, key: "STA-3", run: never });
  assert.match(refused(result), /have diverged \(1 local and 1 pushed commits\)/);
});

test("resume: every refusal names its reason and runs nothing", (t) => {
  const r = repo();
  t.after(r.dispose);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "flow-resume-")));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  assert.match(refused(resume({ cwd: outside, key: "STA-3" })), /is not in a git repository/);
  assert.match(refused(resume({ cwd: r.root, key: "nope" })), /nope is not an issue key/);
  assert.match(refused(resume({ cwd: r.root, key: "STA-404" })), /no branch for STA-404/);

  sh(r.root, "branch", "figentra/sta-3-a");
  sh(r.root, "push", "-q", "origin", "figentra/sta-3-a");
  assert.match(refused(resume({ cwd: r.root, key: "STA-3", run: never })), /has no record in/);

  const worktreesDir = join(r.root, ".claude", "worktrees");
  const made = join(worktreesDir, "sta-3-a");
  mkdirSync(join(made, ".flow", "record"), { recursive: true });
  writeFileSync(join(made, ".flow", "record", "sta-3.json"), "{}");
  assert.match(
    refused(resume({ cwd: r.root, key: "STA-3", run: never })),
    /recordVersion: is required/,
  );
  sh(r.root, "worktree", "remove", "--force", made);

  mkdirSync(made, { recursive: true });
  assert.match(
    refused(resume({ cwd: r.root, key: "STA-3", run: never })),
    /sta-3-a exists but is not on figentra\/sta-3-a/,
  );
  rmSync(worktreesDir, { recursive: true });
  writeFileSync(worktreesDir, "not a folder\n");
  assert.match(
    refused(resume({ cwd: r.root, key: "STA-3", run: never })),
    /git worktree add failed/,
  );
  rmSync(worktreesDir);

  sh(r.root, "push", "-q", "origin", "main:figentra/sta-3-b");
  assert.match(
    refused(resume({ cwd: r.root, key: "STA-3", run: never })),
    /several branches for STA-3: figentra\/sta-3-a, figentra\/sta-3-b/,
  );

  sh(r.root, "remote", "set-url", "origin", join(r.root, "..", "gone.git"));
  assert.match(refused(resume({ cwd: r.root, key: "STA-3", run: never })), /fetch failed/);
});
