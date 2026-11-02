/**
 * Figentra Flow file contract:
 * Purpose: hold STA-1871 to its contract:
 *   - `sync` renders the worktree rule, and `clean` and `init` write the folder's README;
 *   - `clean` counts the linked worktrees against `clean.budget` and lists as candidates only trees idle 24 hours whose
 *     head is merged or pushed;
 *   - `clean --budget --dry-run` changes nothing;
 *   - `clean --budget` preserves uncommitted work and a detached HEAD on `keep/` branches, backs up ignored files
 *     outside the caches, deletes no branch, and keeps a tree whose preservation commit its hooks refuse;
 *   - `doctor` warns, without failing, over the budget and on a low disk;
 *   - both presets' `git-steward` runs the budget.
 * Boundary: temporary repositories with a local bare origin; the tracker, the busy list, the clock and the disk are
 *   injected; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1871.
 */
// @covers sta-1871:FR-1 sta-1871:FR-2 sta-1871:FR-3 sta-1871:FR-4 sta-1871:FR-5 sta-1871:FR-6 sta-1871:FR-7
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clean } from "../commands/clean.mjs";
import { checks } from "../commands/doctor.mjs";
import { sync } from "../commands/sync.mjs";
import { FLOW_ASSETS } from "../lib/flow-dir.mjs";
import { CONFIG_FILE } from "../lib/product.mjs";
import { CONFIG, commit, repo, sh } from "./__fixtures__/repo.mjs";

const HOUR = 3_600_000;
const GB = 1024 ** 3;
/** Every issue In Progress, so the main pass keeps keyed trees and only the budget may take them. */
const open = { state: async () => "In Progress" };

/** A repository whose budget is `budget`, ignoring `.env` and `node_modules/`. */
const budgeted = (/** @type {number} */ budget) =>
  repo({
    [CONFIG_FILE]: `${JSON.stringify({ ...CONFIG, clean: { ...CONFIG.clean, budget } })}\n`,
    ".gitignore": ".env\nnode_modules/\n",
  });

/** A worktree at `.claude/worktrees/<name>` with one commit, pushed unless `push` is false. */
function tree(
  /** @type {string} */ root,
  /** @type {string} */ name,
  { detached = false, push = true } = {},
) {
  const path = join(root, ".claude", "worktrees", name);
  if (detached) sh(root, "worktree", "add", "-q", "--detach", path, "main");
  else sh(root, "worktree", "add", "-q", "-b", `figentra/${name}`, path, "main");
  commit(path, `${name}.txt`);
  if (push) sh(path, "push", "-q", "origin", `HEAD:refs/heads/pushed/${name}`);
  return path;
}

/** Sets a worktree's HEAD reflog to `hours` ago. */
function age(/** @type {string} */ path, /** @type {number} */ hours) {
  const when = new Date(Date.now() - hours * HOUR);
  utimesSync(join(sh(path, "rev-parse", "--absolute-git-dir"), "logs", "HEAD"), when, when);
}

test("budget: counts every linked tree; only idle, pushed trees are candidates; README written", async (t) => {
  const r = budgeted(2);
  t.after(r.dispose);
  const idle = tree(r.root, "sta-11-idle");
  const recent = tree(r.root, "sta-12-recent");
  const unsaved = tree(r.root, "sta-13-unsaved", { push: false });
  age(idle, 30);
  age(recent, 1);
  age(unsaved, 30);
  const report = await clean({ cwd: r.root, issues: open, busy: [] });
  assert.deepEqual(
    { ...report.budget, kept: undefined },
    { limit: 2, count: 3, candidates: [idle], swept: [], preserved: [], kept: undefined },
  );
  assert.equal(existsSync(idle), true, "without --budget nothing goes");
  assert.match(
    readFileSync(join(r.root, ".claude/worktrees/README.md"), "utf8"),
    /One worktree per active task, only here\./,
  );
  // In use, the idle tree is no candidate.
  const busy = await clean({ cwd: r.root, issues: open, busy: [idle] });
  assert.deepEqual(busy.budget?.candidates, []);
});

test("budget: --dry-run changes nothing; --budget preserves dirty work and a detached HEAD, backs up, keeps branches", async (t) => {
  const r = budgeted(1);
  t.after(r.dispose);
  const backupDir = mkdtempSync(join(tmpdir(), "flow-backup-"));
  t.after(() => rmSync(backupDir, { recursive: true, force: true }));
  const dirty = tree(r.root, "sta-21-dirty");
  writeFileSync(join(dirty, "sta-21-dirty.txt"), "changed\n");
  writeFileSync(join(dirty, "new.txt"), "new\n");
  writeFileSync(join(dirty, ".env"), "X=1\n");
  mkdirSync(join(dirty, "node_modules/x"), { recursive: true });
  writeFileSync(join(dirty, "node_modules/x/i.js"), "cache\n");
  const detached = tree(r.root, "detached-1", { detached: true });
  writeFileSync(join(detached, "loose.txt"), "loose\n");
  age(dirty, 30);
  age(detached, 30);

  const dry = await clean({
    cwd: r.root,
    issues: open,
    busy: [],
    budget: true,
    dry: true,
    backupDir,
  });
  assert.deepEqual(dry.budget?.candidates, [detached, dirty], "in path order");
  assert.deepEqual(dry.budget?.swept, []);
  assert.equal(existsSync(dirty), true);
  assert.equal(sh(r.root, "branch", "--list", "keep/*"), "");

  const swept = await clean({ cwd: r.root, issues: open, busy: [], budget: true, backupDir });
  assert.deepEqual(swept.budget?.swept, [detached, dirty], JSON.stringify(swept.budget));
  assert.equal(existsSync(dirty) || existsSync(detached), false);
  // The work lives on: committed on keep/ branches; the original branch is still there.
  assert.equal(sh(r.root, "show", "keep/main-sta-21-dirty:sta-21-dirty.txt"), "changed");
  assert.equal(sh(r.root, "show", "keep/main-sta-21-dirty:new.txt"), "new");
  assert.equal(sh(r.root, "show", "keep/main-detached-1:loose.txt"), "loose");
  assert.match(sh(r.root, "branch", "--list", "figentra/sta-21-dirty"), /figentra\/sta-21-dirty/);
  // The ignored .env went into the backup; the cache did not.
  const [archive] = readdirSync(backupDir);
  assert.match(archive, /^main__sta-21-dirty-\d{14}\.tgz$/);
  const listed = spawnSync("tar", ["-tzf", join(backupDir, archive)], { encoding: "utf8" }).stdout;
  assert.match(listed, /^\.env$/m);
  assert.doesNotMatch(listed, /node_modules/);
});

test("budget: a preservation commit the hooks refuse keeps the tree, with the reason", async (t) => {
  const r = budgeted(1);
  t.after(r.dispose);
  const dirty = tree(r.root, "sta-31-hooked");
  // The hook goes in after the tree's own commit, so only the preservation commit meets it.
  const hook = join(r.root, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\nexit 1\n");
  chmodSync(hook, 0o755);
  writeFileSync(join(dirty, "x.txt"), "x\n");
  age(dirty, 30);
  const report = await clean({ cwd: r.root, issues: open, busy: [], budget: true });
  assert.deepEqual(report.budget?.swept, []);
  assert.match(
    report.budget?.kept[0]?.reason ?? "",
    /preservation commit on keep\/main-sta-31-hooked failed/,
  );
  assert.equal(existsSync(dirty), true);
  assert.equal(
    sh(dirty, "branch", "--show-current"),
    "figentra/sta-31-hooked",
    "put back on its branch",
  );
  assert.equal(sh(r.root, "branch", "--list", "keep/*"), "", "no empty keep/ branch left behind");
  assert.equal(sh(dirty, "status", "--porcelain"), "?? x.txt", "the work is untouched");
});

test("doctor: over the budget and a low disk are warnings, never failures", (t) => {
  const r = budgeted(1);
  t.after(r.dispose);
  tree(r.root, "sta-41-a");
  tree(r.root, "sta-42-b");
  const all = checks(r.root, { offline: true, disk: () => ({ free: 5 * GB, total: 500 * GB }) });
  const byId = Object.fromEntries(all.map((c) => [c.id, c]));
  assert.equal(byId["worktree-budget"].warn, true);
  assert.match(byId["worktree-budget"].detail, /2 linked worktrees, over the budget of 1/);
  assert.equal(byId.disk.warn, true);
  assert.match(byId.disk.detail, /5\.0 GB free of 500\.0 GB/);
  const roomy = checks(r.root, {
    offline: true,
    disk: () => ({ free: 100 * GB, total: 500 * GB }),
  });
  assert.equal(roomy.find((c) => c.id === "disk")?.ok, true);
});

test("sync renders the worktree rule; both git-stewards run the budget", (t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-rule-"));
  t.after(() => rmSync(root, { recursive: true }));
  sync(root, { direct: true, log: () => {} });
  assert.match(
    readFileSync(join(root, ".claude/rules/worktrees.md"), "utf8"),
    /One worktree per active task, only under `\.claude\/worktrees\/<name>\/`/,
  );
  sync(root, { log: () => {} });
  assert.ok(existsSync(join(root, ".agents/rules/worktrees.md")));
  for (const preset of ["neutral", "stackra"])
    assert.match(
      readFileSync(join(FLOW_ASSETS, "presets", preset, "agents/git-steward.md"), "utf8"),
      /clean --budget/,
    );
});
