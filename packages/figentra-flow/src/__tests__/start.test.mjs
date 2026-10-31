/**
 * Figentra Flow file contract:
 * Purpose: hold `figentra-flow start` to its contract: one branch and one worktree under `.claude/worktrees/`, named from the
 *   issue title, Linear moved to In Progress; a refusal for an existing folder or branch, a bad key or a missing title;
 *   the main checkout found from inside a worktree; a Linear failure only warns.
 * Boundary: temporary repositories with a local bare origin; Linear injected; no network.
 * Runtime: node
 * Governing contract: ADR 0022; Stackra ADR 0503; STA-1729.
 */
// @covers sta-1729:FR-1 sta-1729:AC-001 sta-1729:AC-002 sta-1729:P-001
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { slugOf, start } from "../commands/start.mjs";
import { CONFIG_FILE } from "../lib/product.mjs";
import { CONFIG, sh, repo } from "./__fixtures__/repo.mjs";

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

/** A repository with a one-role roster. */
const rostered = () =>
  repo({
    [CONFIG_FILE]: JSON.stringify({ ...CONFIG, team: "roster.yaml" }),
    "roster.yaml":
      "version: 1\nowner:\n  keeps: [money]\nroles:\n  - id: backend\n    label: role:backend\n    file: backend.yaml\n",
    "backend.yaml":
      "id: backend\nlabel: role:backend\npurpose: Builds.\nchanges: []\napproves: []\nreviewed_by: []\n",
  });

// @covers sta-1729:FR-12 sta-1729:AC-049
test("start with a roster: the role from --role or the spec sets the label and records the builder", async (t) => {
  const r = rostered();
  t.after(r.dispose);
  const dir = join(r.root, ".agents", "specs", "sta-9-roled");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.md"), "# X\n\n**Role**: backend\n**Session**: Backend A\n");
  sh(r.root, "add", "-A");
  sh(r.root, "commit", "-q", "-m", "spec");
  sh(r.root, "push", "-q", "origin", "main");
  /** @type {string[]} */
  const seen = [];
  const issues = {
    ...tracker().issues,
    async role(/** @type {string} */ key, /** @type {string} */ label) {
      seen.push(`${key} ${label}`);
    },
    async comment(/** @type {string} */ key, /** @type {string} */ body) {
      seen.push(`${key} ${body}`);
    },
  };
  assert.equal(
    (await start({ cwd: r.root, key: "STA-9", slug: "roled", issues, ...quiet })).ok,
    true,
  );
  assert.deepEqual(seen, [
    "STA-9 role:backend",
    "STA-9 Builder: role `backend`, session Backend A.",
  ]);
  seen.length = 0;
  await start({
    cwd: r.root,
    key: "STA-10",
    slug: "flag",
    role: "backend",
    session: "S",
    issues,
    ...quiet,
  });
  assert.deepEqual(seen, ["STA-10 role:backend", "STA-10 Builder: role `backend`, session S."]);
});

test("start with a roster: an unknown --role is refused first; no role only warns", async (t) => {
  const r = rostered();
  t.after(r.dispose);
  const issues = tracker().issues;
  const refused = await start({
    cwd: r.root,
    key: "STA-11",
    slug: "x",
    role: "chef",
    issues,
    ...quiet,
  });
  assert.match(refused.problem ?? "", /--role chef is not a role of the roster \(backend\)/);
  assert.equal(existsSync(join(r.root, ".claude", "worktrees", "sta-11-x")), false);
  /** @type {string[]} */
  const warnings = [];
  const ok = await start({
    cwd: r.root,
    key: "STA-12",
    slug: "y",
    issues,
    log: () => {},
    warn: (s) => warnings.push(s),
  });
  assert.equal(ok.ok, true);
  assert.match(
    warnings.join(),
    /no role \(pass --role, or set the spec's \*\*Role\*\*\); the lead assigns one/,
  );
});
