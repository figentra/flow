/**
 * Figentra Flow file contract:
 * Purpose: hold `--workspace <dir>` to STA-1945 FR-1 and AC-3: it runs in every repository under the folder that has
 *   `flow.config.json` and in no other, prints one line per repository, the same result as the command run there
 *   alone; a repository that throws prints its error and the run goes on; the exit code is the worst; a missing folder
 *   is a usage error.
 * Boundary: temporary folders with `git init`; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-1 sta-1945:AC-3 sta-1945:P-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { report as checkReport } from "../commands/check.mjs";
import { report as syncReport } from "../commands/sync.mjs";
import { eachRepo, runIn } from "../lib/workspace-run.mjs";
import { changePreset, governed } from "./__fixtures__/governed.mjs";
import { sh } from "./__fixtures__/repo.mjs";

const quiet = { log: () => {}, quiet: true };

/** A workspace: `a` and `b` governed repositories, `c` a repository without a config, `d` a config outside git. */
const workspace = (/** @type {{ after: (fn: () => void) => void }} */ t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "flow-workspace-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ["a", "b", "c"]) {
    mkdirSync(join(dir, name));
    sh(join(dir, name), "init", "-q");
  }
  governed(t, { at: join(dir, "a") });
  governed(t, { at: join(dir, "b"), own: true });
  governed(t, { at: join(dir, "d") });
  return dir;
};

test("eachRepo: one line per governed repository, the same as the command alone; the worst code", async (t) => {
  const dir = workspace(t);
  /** @type {string[]} */
  const lines = [];
  assert.equal(
    await eachRepo(
      dir,
      (root) => syncReport(root, [], quiet),
      (l) => lines.push(l),
    ),
    0,
  );
  assert.deepEqual(lines, ["a: synced", "b: synced"]);
  changePreset(join(dir, "b"));
  lines.length = 0;
  assert.equal(
    await eachRepo(
      dir,
      (root) => checkReport(root, [], quiet),
      (l) => lines.push(l),
    ),
    1,
  );
  assert.deepEqual(lines, [
    `a: ${checkReport(join(dir, "a"), [], quiet).line}`,
    `b: ${checkReport(join(dir, "b"), [], quiet).line}`,
  ]);
  assert.equal(lines[0], "a: ok");
  assert.match(lines[1], /^b: 1 problem\(s\): .*fflow update/);
});

test("eachRepo: a repository that throws prints its error and the run goes on", async (t) => {
  const dir = workspace(t);
  /** @type {string[]} */
  const lines = [];
  const code = await eachRepo(
    dir,
    (root) => {
      if (root.endsWith("a")) throw new Error("boom");
      return { code: 0, line: "fine" };
    },
    (l) => lines.push(l),
  );
  assert.equal(code, 1);
  assert.deepEqual(lines, ["a: error: boom", "b: fine"]);
});

test("runIn: --workspace without a folder is a usage error", async () => {
  assert.equal(await runIn(["--workspace"], () => ({ code: 0, line: "" })), 2);
});
