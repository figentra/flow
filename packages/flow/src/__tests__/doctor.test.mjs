/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow doctor` to its rules: a freshly initialised repository passes every offline check; a
 *   hand-edited rendered file fails `install`, an unignored worktree folder fails `worktrees`, invalid configuration
 *   fails `config`; outside git only `node` and `git` are reported; the binary exits 1 with the JSON report; the
 *   checks are grouped checklist rows, and a fresh local repository's missing credentials are information (FR-31);
 *   each machine-only skill is listed with its source in the Machine group (STA-1945 FR-8).
 * Boundary: scratch git repositories and `--offline`; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1729 (FR-13, AC-055); STA-1846; STA-1945 (FR-8, FR-31).
 */
// @covers sta-1729:FR-13 sta-1729:AC-055 sta-1729:P-013
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_GROUPS, checks, meets, rowsOf } from "../commands/doctor.mjs";
import { init } from "../commands/init.mjs";
import { LOCK } from "../lib/flow-dir.mjs";
import { CONFIG_FILE } from "../lib/product.mjs";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "../../bin/fflow.mjs");

function repo() {
  const root = mkdtempSync(join(tmpdir(), "flow-doctor-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  init(root);
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * Checks or checklist rows by id.
 * @template {{ id: string }} T
 * @param {T[]} all
 * @returns {Record<string, T>}
 */
const byId = (all) => Object.fromEntries(all.map((c) => [c.id, c]));

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
    ["node", "git", "config", "preset", "install", "worktrees", "worktree-budget", "disk"],
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
  const report = /** @type {{ ok: boolean, data: ReturnType<typeof rowsOf> }} */ (
    JSON.parse(out.stdout)
  );
  assert.equal(report.ok, false);
  assert.equal(byId(report.data).worktrees.ok, false);
  assert.equal(byId(report.data).worktrees.status, "fail");
});

// @covers sta-1945:FR-31 sta-1945:AC-37 sta-1945:P-035
test("doctor: the checks are grouped rows; a fresh local repository's missing credentials are information", (t) => {
  const r = repo();
  t.after(r.dispose);
  const disk = () => ({ free: 100 * GB, total: 200 * GB });
  const rows = rowsOf(checks(r.root, { disk }));
  assert.deepEqual(
    rows.map((row) => [row.group, row.name, row.status]),
    [
      ["Machine", "node", "ok"],
      ["Repo", "git", "ok"],
      ["Flow", "config", "ok"],
      ["Flow", "preset", "ok"],
      ["Flow", "install", "ok"],
      ["Repo", "worktrees", "ok"],
      ["Repo", "worktree-budget", "ok"],
      ["Machine", "disk", "ok"],
      ["GitHub", "credentials", "info"],
    ],
  );
  assert.deepEqual(CHECK_GROUPS, ["Machine", "Repo", "Flow", "GitHub"]);
  // With a remote there is something to read, so the missing block fails.
  spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/app.git"], { cwd: r.root });
  const credentials = rowsOf(checks(r.root, { disk })).find((row) => row.name === "credentials");
  assert.equal(credentials?.status, "fail");
  assert.match(credentials?.fix ?? "", /credentials/);
});

// @covers sta-1945:FR-8 sta-1945:AC-10 sta-1945:P-013
test("doctor: names each machine-only skill's source; a third-party.yml it cannot read fails", (t) => {
  const r = repo();
  t.after(r.dispose);
  const disk = () => ({ free: 100 * GB, total: 200 * GB });
  writeFileSync(join(r.root, CONFIG_FILE), JSON.stringify({ version: 1, preset: "stackra" }));
  const rows = checks(r.root, { offline: true, disk }).filter((c) =>
    c.id.startsWith("machine-only:"),
  );
  // D1's HeroUI Pro, Remotion and owner's skills, then O9's upstream skills core used to vendor.
  assert.equal(rows.length, 2 + 6 + 13 + 20);
  assert.ok(rows.every((c) => c.ok));
  assert.ok(rowsOf(rows).every((row) => row.group === "Machine" && row.status === "ok"));
  assert.match(
    byId(rows)["machine-only:remotion-docs"].detail,
    /^install it on this machine into ~\/\.claude\/skills\/remotion-docs\/ from github:remotion-dev\/skills \(.*\); fflow sync never installs it/,
  );
  // An invalid config is the config row's failure; no rows are read from the preset it names.
  writeFileSync(
    join(r.root, CONFIG_FILE),
    JSON.stringify({ version: 1, preset: "stackra", bogus: true }),
  );
  const invalid = checks(r.root, { offline: true, disk });
  assert.equal(byId(invalid).config.ok, false);
  assert.deepEqual(
    invalid.filter((c) => c.id.startsWith("machine-only:")),
    [],
  );
  mkdirSync(join(r.root, "ours"));
  writeFileSync(join(r.root, "ours", "third-party.yml"), "skills: nope\n");
  writeFileSync(join(r.root, CONFIG_FILE), JSON.stringify({ version: 1, preset: "ours" }));
  const c = byId(checks(r.root, { offline: true, disk }));
  assert.equal(c["third-party"]?.ok, false);
  assert.match(c["third-party"]?.detail ?? "", /third-party\.yml: `skills` is not a list/);
});
