/**
 * Vellum file contract:
 * Purpose: hold `vellum clean` to its contract: a worktree goes only when it is clean, saved (on a remote, or landed
 *   by cherry-pick), finished (issue Done or Canceled, or idle 2 hours without a key, detached HEADs included) and free
 *   of ignored files outside the caches; tester trees, dirty, unsaved, open, recently used and `.env` trees stay with
 *   their reason; the space freed is counted; `--adopt` moves stray trees in and lists tester ones; `--fix-ignore`
 *   adds the line once; `--dry-run` changes nothing.
 * Boundary: temporary repositories with a local bare origin; Linear injected; no network.
 * Runtime: node
 * Governing contract: ADR 0022; Stackra ADR 0503; STA-1729.
 */
// @covers sta-1729:FR-3 sta-1729:FR-4 sta-1729:P-003 sta-1729:P-004
// @covers sta-1729:AC-004 sta-1729:AC-005 sta-1729:AC-006 sta-1729:AC-007 sta-1729:AC-018 sta-1729:AC-019
// @covers sta-1729:AC-020 sta-1729:AC-021 sta-1729:AC-022
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clean, ignoresWorktrees } from "../commands/clean.mjs";
import { commit, repo, sh } from "./__fixtures__/repo.mjs";

const HOUR = 3_600_000;

/** Linear stand-in: every key in `done` is Done, every other In Progress. */
const states = (/** @type {string[]} */ done = []) => ({
  async state(/** @type {string} */ key) {
    return done.includes(key) ? "Done" : "In Progress";
  },
});

/** A worktree of `root` at `.claude/worktrees/<name>` on a new branch (or detached), with one commit. */
function tree(
  /** @type {string} */ root,
  /** @type {string} */ name,
  { branch = `figentra/${name}`, detached = false } = {},
) {
  const path = join(root, ".claude", "worktrees", name);
  if (detached) sh(root, "worktree", "add", "-q", "--detach", path, "main");
  else sh(root, "worktree", "add", "-q", "-b", branch, path, "main");
  commit(path, `${name}.txt`);
  return path;
}

/** Sets a worktree's HEAD reflog to `hours` ago. */
function age(/** @type {string} */ path, /** @type {number} */ hours) {
  const dir = sh(path, "rev-parse", "--absolute-git-dir");
  const when = new Date(Date.now() - hours * HOUR);
  utimesSync(join(dir, "logs", "HEAD"), when, when);
}

test("clean: removes a pushed tree whose issue is Done, deletes its branch and counts the space", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const path = tree(r.root, "sta-1-done");
  sh(path, "push", "-q", "origin", "HEAD");
  const report = await clean({ cwd: r.root, issues: states(["STA-1"]) });
  assert.deepEqual(report.removed, [path]);
  assert.equal(existsSync(path), false);
  assert.equal(sh(r.root, "branch", "--list", "figentra/sta-1-done"), "");
  assert.ok(report.freedKb > 0);
});

test("clean: a tree landed by cherry-pick is saved although never pushed", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const path = tree(r.root, "sta-2-picked");
  const kept = await clean({ cwd: r.root, issues: states(["STA-2"]) });
  assert.match(kept.kept[0]?.reason ?? "", /unsaved/);
  sh(r.root, "cherry-pick", sh(path, "rev-parse", "HEAD"));
  sh(r.root, "push", "-q", "origin", "main");
  const removed = await clean({ cwd: r.root, issues: states(["STA-2"]) });
  assert.deepEqual(removed.removed, [path]);
});

test("clean: keeps a tester tree, a dirty one and one whose issue is open, each with its reason", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const tester = tree(r.root, "g-sta-3-gate", { detached: true });
  sh(tester, "push", "-q", "origin", "HEAD:refs/heads/x3");
  const dirty = tree(r.root, "sta-4-dirty");
  sh(dirty, "push", "-q", "origin", "HEAD");
  writeFileSync(join(dirty, "wip.txt"), "wip\n");
  const open = tree(r.root, "sta-5-open");
  sh(open, "push", "-q", "origin", "HEAD");
  const report = await clean({ cwd: r.root, issues: states(["STA-3", "STA-4"]) });
  assert.deepEqual(report.removed, []);
  const reasons = Object.fromEntries(report.kept.map((k) => [k.path, k.reason]));
  assert.equal(reasons[tester], "a tester worktree");
  assert.equal(reasons[dirty], "uncommitted changes");
  assert.equal(reasons[open], "STA-5 is In Progress");
});

test("clean: a detached or keyless tree goes once idle for 2 hours by its HEAD reflog", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const detached = tree(r.root, "agent-a1b2", { detached: true });
  sh(detached, "push", "-q", "origin", "HEAD:refs/heads/agent-a1b2");
  const recent = tree(r.root, "wf_x9", { branch: "wf_x9" });
  sh(recent, "push", "-q", "origin", "HEAD");
  age(detached, 3);
  age(recent, 1);
  const report = await clean({ cwd: r.root, issues: states() });
  assert.deepEqual(report.removed, [detached]);
  assert.match(report.kept.find((k) => k.path === recent)?.reason ?? "", /idle 1\.0 h/);
});

test("clean: keeps a tree holding ignored files outside the caches, and removes one with only caches", async (t) => {
  const r = repo({ ".gitignore": ".env\nnode_modules/\nios/\n" });
  t.after(r.dispose);
  const secret = tree(r.root, "sta-6-env");
  sh(secret, "push", "-q", "origin", "HEAD");
  writeFileSync(join(secret, ".env"), "X=1\n");
  mkdirSync(join(secret, "ios"));
  writeFileSync(join(secret, "ios", "Podfile"), "x\n");
  const cached = tree(r.root, "sta-7-cache");
  sh(cached, "push", "-q", "origin", "HEAD");
  mkdirSync(join(cached, "node_modules", "x"), { recursive: true });
  writeFileSync(join(cached, "node_modules", "x", "index.js"), "x\n");
  const report = await clean({ cwd: r.root, issues: states(["STA-6", "STA-7"]) });
  assert.deepEqual(report.removed, [cached]);
  assert.match(report.kept.find((k) => k.path === secret)?.reason ?? "", /\.env.*ios|ios.*\.env/);
});

test("clean --dry-run changes nothing", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const path = tree(r.root, "sta-8-dry");
  sh(path, "push", "-q", "origin", "HEAD");
  const report = await clean({ cwd: r.root, dry: true, issues: states(["STA-8"]) });
  assert.deepEqual(report.removed, [path]);
  assert.equal(existsSync(path), true);
});

test("clean --adopt moves a stray tree inside and lists a tester's for stackra-f4", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "vellum-stray-")));
  const stray = join(outside, "sta-9-stray");
  sh(r.root, "worktree", "add", "-q", "-b", "figentra/sta-9-stray", stray, "main");
  const gate = join(outside, "pro-gate");
  sh(r.root, "worktree", "add", "-q", "--detach", gate, "main");
  const report = await clean({ cwd: r.root, adopt: true, issues: states() });
  assert.deepEqual(report.adopted, [
    `${stray} → ${join(r.root, ".claude", "worktrees", "sta-9-stray")}`,
  ]);
  assert.equal(existsSync(join(r.root, ".claude", "worktrees", "sta-9-stray")), true);
  assert.deepEqual(report.forTester, [gate]);
  assert.equal(existsSync(gate), true);
});

test("clean --fix-ignore adds .claude/worktrees/ once", async (t) => {
  const r = repo({ ".gitignore": "node_modules/" });
  t.after(r.dispose);
  assert.equal(ignoresWorktrees(r.root), false);
  assert.equal((await clean({ cwd: r.root, fixIgnore: true, issues: states() })).ignoreFixed, true);
  assert.equal(
    (await clean({ cwd: r.root, fixIgnore: true, issues: states() })).ignoreFixed,
    false,
  );
  assert.equal(
    readFileSync(join(r.root, ".gitignore"), "utf8"),
    "node_modules/\n.claude/worktrees/\n",
  );
});
