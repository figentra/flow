/**
 * Figentra Flow file contract:
 * Purpose: hold the guard's post-merge cleanup to its contract: with the package installed in the main checkout it
 *   starts `fflow clean --merged` there, detached, its output in the log; from a worktree it still runs in the main
 *   checkout; within ten minutes of the last run, or with no package installed, it starts nothing; and a session
 *   start runs it only when `clean.whenMerged` is set.
 * Boundary: temporary repositories; the spawner is a stub, so no process starts; no network.
 * Runtime: node
 * Governing contract: STA-1871; the owner's post-merge cleanup of 2026-11-09.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cleanMerged, LOG, QUIET_MS } from "../guard/clean-merged.mjs";
import { loadTables } from "../guard/tables.mjs";
import { CONFIG_FILE, NAME, PACKAGE } from "../lib/product.mjs";
import { CONFIG, repo, sh } from "./__fixtures__/repo.mjs";

/** A spawner that records its calls. */
function stub() {
  /** @type {{ file: string, args: string[], options: any }[]} */
  const calls = [];
  const run = (
    /** @type {string} */ file,
    /** @type {string[]} */ args,
    /** @type {any} */ options,
  ) => {
    calls.push({ file, args, options });
    return { unref() {} };
  };
  return { calls, run: /** @type {any} */ (run) };
}

/** Installs a stand-in for the package's binary in the main checkout. */
function install(/** @type {string} */ root) {
  const bin = join(root, "node_modules", ...PACKAGE.split("/"), "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, `${NAME}.mjs`), "");
  return join(bin, `${NAME}.mjs`);
}

test("cleanMerged: starts clean --merged in the main checkout, detached, also from a worktree", (t) => {
  const r = repo();
  t.after(r.dispose);
  const bin = install(r.root);
  const tree = join(r.root, ".claude", "worktrees", "sta-1-x");
  sh(r.root, "worktree", "add", "-q", "-b", "figentra/sta-1-x", tree, "main");
  const s = stub();
  assert.equal(cleanMerged(tree, { run: s.run }), true);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].file, process.execPath);
  assert.deepEqual(s.calls[0].args, [bin, "clean", "--merged"]);
  assert.equal(s.calls[0].options.cwd, r.root);
  assert.equal(s.calls[0].options.detached, true);
});

test("cleanMerged: nothing within ten minutes of the last run, or with no package installed", (t) => {
  const r = repo();
  t.after(r.dispose);
  const s = stub();
  assert.equal(cleanMerged(r.root, { run: s.run }), false);
  install(r.root);
  assert.equal(cleanMerged(r.root, { run: s.run }), true);
  assert.equal(cleanMerged(r.root, { run: s.run }), false);
  const old = new Date(Date.now() - QUIET_MS - 1000);
  utimesSync(join(r.root, LOG), old, old);
  assert.equal(cleanMerged(r.root, { run: s.run }), true);
  assert.equal(s.calls.length, 2);
});

test("guard tables: a session start cleans only when clean.whenMerged is set", async (t) => {
  const r = repo();
  t.after(r.dispose);
  assert.equal((await loadTables(r.root)).cleanWhenMerged, false);
  const config = { ...CONFIG, clean: { ...CONFIG.clean, whenMerged: true } };
  writeFileSync(join(r.root, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`);
  assert.equal((await loadTables(r.root)).cleanWhenMerged, true);
});
