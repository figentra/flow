/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow doctor` to its rules: a freshly initialised repository passes every offline check; a
 *   hand-edited rendered file fails `install`, an unignored worktree folder fails `worktrees`, invalid configuration
 *   fails `config`; outside git only `node` and `git` are reported; the binary exits 1 with the JSON report.
 * Boundary: scratch git repositories and `--offline`; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 (FR-13, AC-055); STA-1846.
 */
// @covers sta-1729:FR-13 sta-1729:AC-055 sta-1729:P-013
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checks, meets } from "../commands/doctor.mjs";
import { init } from "../commands/init.mjs";
import { LOCK } from "../lib/flow-dir.mjs";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "../../bin/fflow.mjs");

function repo() {
  const root = mkdtempSync(join(tmpdir(), "flow-doctor-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  init(root);
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

const byId = (/** @type {import("../commands/doctor.mjs").Check[]} */ all) =>
  Object.fromEntries(all.map((c) => [c.id, c]));

test("doctor: Node against a >= range", () => {
  assert.equal(meets("24.0.0", ">=24.0.0"), true);
  assert.equal(meets("v26.1.0", ">=24"), true);
  assert.equal(meets("22.11.0", ">=24.0.0"), false);
  assert.equal(meets("24.0.1", ">=24.1.0"), false);
});

const GB = 1024 ** 3;

test("doctor: an initialised repository passes every offline check", (t) => {
  const r = repo();
  t.after(r.dispose);
  const all = checks(r.root, { offline: true, disk: () => ({ free: 100 * GB, total: 200 * GB }) });
  assert.deepEqual(
    all.map((c) => c.id),
    ["node", "git", "config", "install", "worktrees", "worktree-budget", "disk"],
  );
  assert.deepEqual(
    all.filter((c) => !c.ok),
    [],
  );
});

test("doctor: each broken part fails its own check with a fix", (t) => {
  const r = repo();
  t.after(r.dispose);
  const lock = JSON.parse(readFileSync(join(r.root, LOCK), "utf8"));
  const [rendered] = Object.keys(lock.files);
  appendFileSync(join(r.root, rendered), "\nhand edit\n");
  writeFileSync(join(r.root, ".gitignore"), "node_modules\n");
  writeFileSync(join(r.root, "flow.config.json"), '{ "version": 9 }');
  const c = byId(checks(r.root, { offline: true }));
  assert.equal(c.install.ok, false);
  assert.match(c.install.fix ?? "", /sync/);
  assert.equal(c.worktrees.ok, false);
  assert.match(c.worktrees.fix ?? "", /clean --fix-ignore/);
  assert.equal(c.config.ok, false);
  assert.match(c.config.detail, /flow\.config\.json/);
  assert.equal(c.node.ok, true);
  const old = byId(checks(r.root, { offline: true, node: "20.0.0" }));
  assert.equal(old.node.ok, false);
});

test("doctor: outside git only node and git are reported", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "flow-doctor-nogit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const c = checks(dir, { offline: true });
  assert.deepEqual(
    c.map((x) => [x.id, x.ok]),
    [
      ["node", true],
      ["git", false],
    ],
  );
});

test("doctor: the binary exits 1 with a JSON report when a check fails", (t) => {
  const r = repo();
  t.after(r.dispose);
  writeFileSync(join(r.root, ".gitignore"), "");
  const out = spawnSync(process.execPath, [BIN, "doctor", "--offline", "--json"], {
    cwd: r.root,
    encoding: "utf8",
  });
  assert.equal(out.status, 1);
  const report = JSON.parse(out.stdout);
  assert.equal(report.schema, "fflow.doctor/1");
  assert.equal(byId(report.checks).worktrees.ok, false);
});
