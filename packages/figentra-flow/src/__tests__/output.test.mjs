/**
 * Figentra Flow file contract:
 * Purpose: hold the output layer to P-035 (AC-37): `doctor` and `status` give the same data as a table or checklist,
 *   as plain text under NO_COLOR or in a pipe without it (no escape byte), and as one `--json` document whose data is
 *   that data; without the engine (an optional peer, NFR-1) the plain dispatcher prints the same checklist, tables and
 *   document; and `status` refuses a wrong combination of options with exit 2 and the reason (AC-35).
 * Boundary: the engine's in-process test harness and the plain dispatcher over scratch repositories; `--offline`, no
 *   network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945 FR-31; STA-1966 FR-030.
 */
// @covers sta-1945:FR-31 sta-1945:AC-37 sta-1945:P-035
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCommandForTest } from "@stackra/console/testing";

import { checks, rowsOf } from "../commands/doctor.mjs";
import { init } from "../commands/init.mjs";
import { CONSOLE } from "../lib/console.mjs";
import { runPlain } from "../lib/plain.mjs";
import { repo } from "./__fixtures__/repo.mjs";

const ESC = "\u001B";

/** The disk's free bytes move between two calls; every other field of a doctor row is the same data. */
const stable = (/** @type {ReturnType<typeof rowsOf>} */ rows) =>
  rows.map((r) => (r.id === "disk" ? { ...r, detail: "" } : r));

/** A stream that keeps what is written to it. */
const sink = () => {
  const s = { text: "", write: (/** @type {string} */ x) => void (s.text += x) };
  return s;
};

/** A git repository with `.flow/` installed, removed after the test. */
const initialised = (/** @type {import("node:test").TestContext} */ t) => {
  const root = mkdtempSync(join(tmpdir(), "flow-output-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  spawnSync("git", ["init", "-q"], { cwd: root });
  init(root);
  return root;
};

test("output: doctor's checklist is plain text in a pipe and the same rows under --json", async (t) => {
  const root = initialised(t);
  const plain = await runCommandForTest(CONSOLE, ["doctor", "--offline"], { cwd: root });
  assert.equal(plain.exitCode, 0, plain.stdout + plain.stderr);
  assert.ok(!plain.stdout.includes(ESC), "no escape byte without a terminal");
  for (const group of ["Machine", "Repo", "Flow"]) assert.match(plain.stdout, new RegExp(group));
  assert.match(plain.stdout, /passed/);
  const json = await runCommandForTest(CONSOLE, ["doctor", "--offline", "--json"], { cwd: root });
  assert.equal(json.exitCode, 0);
  const data = /** @type {{ ok: boolean, data: ReturnType<typeof rowsOf> }} */ (json.json);
  assert.equal(data.ok, true);
  assert.deepEqual(stable(data.data), stable(rowsOf(checks(root, { offline: true }))));
});

test("output: status is tables in a pipe and the snapshot under --json", async (t) => {
  const r = repo();
  t.after(r.dispose);
  const plain = await runCommandForTest(CONSOLE, ["status", "--repo", r.root, "--offline"]);
  assert.ok(!plain.stdout.includes(ESC));
  for (const table of ["Specs", "Worktrees", "PRs", "Sessions"])
    assert.match(plain.stdout, new RegExp(table));
  const json = await runCommandForTest(CONSOLE, [
    "status",
    "--repo",
    r.root,
    "--offline",
    "--json",
  ]);
  const doc = /** @type {{ data: { version: string, repos: { path: string }[] } }} */ (json.json);
  assert.equal(doc.data.version, "fflow.status/1");
  assert.equal(doc.data.repos[0].path, r.root);
  assert.equal(json.exitCode, plain.exitCode, "the same verdict both ways");
});

test("output: a pipe without NO_COLOR is plain text too", async (t) => {
  const root = initialised(t);
  const r = await runCommandForTest(CONSOLE, ["doctor", "--offline"], {
    cwd: root,
    env: { NO_COLOR: undefined },
  });
  assert.equal(r.exitCode, 0, r.stdout + r.stderr);
  assert.ok(!r.stdout.includes(ESC), "no escape byte in a pipe");
  assert.ok(!r.stderr.includes(ESC));
  assert.match(r.stdout, /Machine/);
});

// @covers sta-1945:AC-35
test("output: status refuses a wrong combination of options with exit 2 and the reason", async () => {
  /** @type {[string[], RegExp][]} */
  const cases = [
    [["--metrics", "--offline"], /--metrics reads GitHub; it cannot run --offline/],
    [["--metrics", "--since", "soon"], /--since takes a number of days/],
    [["--metrics", "--since", "0d"], /--since takes a number of days/],
    [["--role", "reviewer"], /--role goes with --by role/],
    // The engine refuses these two from the declared choices and range, before `refusal` would.
    [["--by", "team"], /role/],
    [["--web", "--port", "70000"], /port/],
  ];
  for (const [argv, reason] of cases) {
    const r = await runCommandForTest(CONSOLE, ["status", ...argv]);
    assert.equal(r.exitCode, 2, `${argv.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, reason, argv.join(" "));
  }
});

// @covers sta-1945:FR-31 sta-1945:P-035
test("output: without the engine, doctor and status print the same checklist, tables and document", async (t) => {
  const root = initialised(t);
  const out = sink();
  const err = sink();
  assert.equal(await runPlain(["doctor", "--offline"], { cwd: root, stdout: out, stderr: err }), 0);
  for (const group of ["Machine", "Repo", "Flow"])
    assert.match(out.text, new RegExp(`^${group}$`, "m"));
  // The disk may be low on the machine that runs this: a warning, never a failure.
  assert.match(out.text, /\d+ passed, \d+ warning\(s\), 0 failed/);
  assert.ok(!out.text.includes(ESC));
  const json = sink();
  const human = sink();
  assert.equal(
    await runPlain(["doctor", "--offline", "--json"], { cwd: root, stdout: json, stderr: human }),
    0,
  );
  const doc = JSON.parse(json.text);
  assert.equal(doc.ok, true);
  assert.deepEqual(stable(doc.data), stable(rowsOf(checks(root, { offline: true }))));
  assert.match(human.text, /passed/, "under --json the checklist's text goes to stderr");

  const r = repo();
  t.after(r.dispose);
  const tables = sink();
  const code = await runPlain(["status", "--repo", r.root, "--offline"], {
    stdout: tables,
    stderr: sink(),
  });
  for (const table of ["Specs", "Worktrees", "PRs", "Sessions"])
    assert.match(tables.text, new RegExp(table));
  const snap = sink();
  assert.equal(
    await runPlain(["status", "--repo", r.root, "--offline", "--json"], {
      stdout: snap,
      stderr: sink(),
    }),
    code,
  );
  assert.equal(JSON.parse(snap.text).data.version, "fflow.status/1");
  const refused = sink();
  assert.equal(
    await runPlain(["status", "--metrics", "--offline"], { stdout: sink(), stderr: refused }),
    2,
  );
  assert.match(refused.text, /--metrics reads GitHub/);
  assert.equal(await runPlain(["stauts"], { stdout: sink(), stderr: sink() }), 2);
});
