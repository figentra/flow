/**
 * Vellum file contract:
 * Purpose: hold `vellum start` to its contract: one branch and one worktree under `.claude/worktrees/`, named from the
 *   issue title, Linear moved to In Progress; a refusal for an existing folder or branch, a bad key or a missing title;
 *   the main checkout found from inside a worktree; a Linear failure only warns.
 * Boundary: temporary repositories with a local bare origin; Linear injected; no network.
 * Runtime: node
 * Governing contract: ADR 0022; Stackra ADR 0503; STA-1729.
 */
// @covers sta-1729:FR-1 sta-1729:AC-001 sta-1729:AC-002 sta-1729:P-001
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { slugOf, start } from "../commands/start.mjs";
import { sh, repo } from "./__fixtures__/repo.mjs";

/** An injected tracker recording the In Progress moves. */
function tracker(title = "Add the Pay connector: Stripe & co", { fail = false } = {}) {
  /** @type {[string, string][]} */
  const moved = [];
  return {
    moved,
    issues: {
      async title() {
        return title;
      },
      async inProgress(/** @type {string} */ key, /** @type {string} */ branch) {
        if (fail) throw new Error("Linear down");
        moved.push([key, branch]);
      },
    },
  };
}
const quiet = { log: () => {}, warn: () => {} };

test("slug: lower-case words, at most 5 and 40 characters", () => {
  assert.equal(slugOf("Add the Pay connector: Stripe & co"), "add-the-pay-connector-stripe");
  assert.equal(slugOf("Ünïcode   Names!"), "unicode-names");
  assert.equal(slugOf("a".repeat(30) + " " + "b".repeat(20)), "a".repeat(30));
});

test("start: one branch and one worktree in .claude/worktrees, and the issue In Progress", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const { moved, issues } = tracker();
  const result = await start({ cwd: r.root, key: "STA-12", issues, ...quiet });
  const path = join(r.root, ".claude", "worktrees", "sta-12-add-the-pay-connector-stripe");
  assert.deepEqual(result, {
    ok: true,
    path,
    branch: "figentra/sta-12-add-the-pay-connector-stripe",
  });
  assert.equal(existsSync(path), true);
  assert.equal(
    sh(path, "branch", "--show-current"),
    "figentra/sta-12-add-the-pay-connector-stripe",
  );
  assert.equal(sh(path, "rev-parse", "HEAD"), sh(r.root, "rev-parse", "origin/main"));
  assert.deepEqual(moved, [["STA-12", "figentra/sta-12-add-the-pay-connector-stripe"]]);
});

test("start: from inside a worktree, the worktree goes under the main checkout", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const first = await start({
    cwd: r.root,
    key: "sta-1",
    slug: "one",
    issues: tracker().issues,
    ...quiet,
  });
  const second = await start({
    cwd: first.path ?? "",
    key: "STA-2",
    slug: "two",
    issues: tracker().issues,
    ...quiet,
  });
  assert.equal(second.path, join(r.root, ".claude", "worktrees", "sta-2-two"));
});

test("start: refuses an existing folder, a local or remote branch, a bad key or no title, changing nothing", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const { issues } = tracker();
  mkdirSync(join(r.root, ".claude", "worktrees", "sta-3-taken"), { recursive: true });
  assert.match(
    (await start({ cwd: r.root, key: "STA-3", slug: "taken", issues, ...quiet })).problem ?? "",
    /already exists/,
  );
  sh(r.root, "branch", "figentra/sta-4-local");
  assert.match(
    (await start({ cwd: r.root, key: "STA-4", slug: "local", issues, ...quiet })).problem ?? "",
    /branch .* already exists/,
  );
  sh(r.root, "push", "-q", "origin", "main:refs/heads/figentra/sta-5-remote");
  assert.match(
    (await start({ cwd: r.root, key: "STA-5", slug: "remote", issues, ...quiet })).problem ?? "",
    /refs\/remotes\/origin/,
  );
  assert.match(
    (await start({ cwd: r.root, key: "OS-6", issues, ...quiet })).problem ?? "",
    /not an issue key/,
  );
  assert.match(
    (await start({ cwd: r.root, key: "STA-7", issues: tracker("").issues, ...quiet })).problem ??
      "",
    /pass --slug/,
  );
  assert.equal(existsSync(join(r.root, ".claude", "worktrees", "sta-5-remote")), false);
});

test("start: a Linear failure warns after the worktree exists", async (t) => {
  const r = repo();
  t.after(r.dispose);
  /** @type {string[]} */
  const warnings = [];
  const result = await start({
    cwd: r.root,
    key: "STA-8",
    slug: "offline",
    issues: tracker("x", { fail: true }).issues,
    log: () => {},
    warn: (s) => warnings.push(s),
  });
  assert.equal(result.ok, true);
  assert.match(warnings.join(), /the tracker was not updated/);
});
