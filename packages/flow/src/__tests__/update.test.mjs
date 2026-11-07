/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow update` to STA-1945 FR-1 and FR-2: it prints the diff, adopts the installed preset into the
 *   lock and syncs, after which `sync` and `check` pass again; `--preset <version>` refuses any version but the
 *   installed one and writes nothing; a v1 lock comes out v2.
 * Boundary: temporary folders; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-1 sta-1945:FR-2 sta-1945:AC-2 sta-1945:P-002
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { check } from "../commands/check.mjs";
import { sync } from "../commands/sync.mjs";
import { report, update } from "../commands/update.mjs";
import { LOCK } from "../lib/flow-dir.mjs";
import { readLock, treeDigest } from "../lib/lock.mjs";
import { VERSION } from "../lib/product.mjs";
import { changePreset, governed, OWN_PRESET, snapshot } from "./__fixtures__/governed.mjs";

const quiet = { log: () => {} };

test("update prints the diff, adopts the installed preset and syncs; sync and check pass after", (t) => {
  const root = governed(t, { own: true });
  sync(root, quiet);
  changePreset(root);
  assert.throws(() => sync(root, quiet), /fflow update/);
  /** @type {string[]} */
  const lines = [];
  assert.equal(update(root, { log: (l) => lines.push(l) }), 0);
  const out = lines.join("\n");
  assert.match(out, /^change \.agents\/skills\/flow-plan\/SKILL\.md$/m);
  assert.match(out, /^change \.flow\/lock\.json$/m);
  assert.match(out, /^\+A newer step\.$/m);
  assert.ok(
    out.indexOf("change .flow/lock.json") < out.indexOf("fflow sync: rendered"),
    "the diff comes first",
  );
  assert.equal(readLock(root)?.preset.digest, treeDigest(join(root, OWN_PRESET)));
  assert.deepEqual(check(root).problems, []);
  sync(root, quiet);
});

test("update --preset refuses any version but the installed one, and writes nothing", (t) => {
  const root = governed(t);
  sync(root, quiet);
  const before = snapshot(root);
  /** @type {string[]} */
  const lines = [];
  const r = report(root, ["--preset", "9.9.9"], { log: (l) => lines.push(l), quiet: true });
  assert.equal(r.code, 1);
  assert.match(lines.join(), /the installed preset is .*, not 9\.9\.9/);
  assert.deepEqual(snapshot(root), before);
  assert.equal(report(root, ["--preset", VERSION], { log: () => {}, quiet: true }).code, 0);
});

test("update rewrites a v1 lock as v2, keeping a direct render direct", (t) => {
  const root = governed(t);
  mkdirSync(join(root, ".flow"));
  writeFileSync(
    join(root, LOCK),
    JSON.stringify({
      version: "0.2.3",
      preset: "neutral",
      files: { ".claude/skills/flow-plan/SKILL.md": "0" },
    }),
  );
  assert.equal(update(root, quiet), 0);
  const lock = readLock(root);
  assert.equal(lock?.lockVersion, 2);
  assert.equal(lock?.flow, VERSION);
  assert.ok(lock && ".claude/skills/flow-plan/SKILL.md" in lock.files);
});
