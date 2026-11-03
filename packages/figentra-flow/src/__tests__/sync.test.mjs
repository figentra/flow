/**
 * Figentra Flow file contract:
 * Purpose: hold `sync` to STA-1945 FR-1 and FR-2: it renders only the locked preset. When the installed preset's
 *   digest or name differs from the lock's it refuses, naming `fflow update`, and writes nothing; a v1 lock (no digest)
 *   and an unreadable lock are rewritten as v2.
 * Boundary: temporary folders; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-1 sta-1945:FR-2 sta-1945:AC-2 sta-1945:P-002
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { report, sync, SyncRefusal } from "../commands/sync.mjs";
import { LOCK } from "../lib/flow-dir.mjs";
import { readLock, treeDigest } from "../lib/lock.mjs";
import { changePreset, governed, OWN_PRESET, snapshot } from "./__fixtures__/governed.mjs";

const quiet = { log: () => {} };

test("sync refuses a preset whose digest differs from the lock, naming fflow update, and writes nothing", (t) => {
  const root = governed(t, { own: true });
  sync(root, quiet);
  assert.equal(readLock(root)?.preset.digest, treeDigest(join(root, OWN_PRESET)));
  sync(root, quiet);
  changePreset(root);
  const before = snapshot(root);
  assert.throws(() => sync(root, quiet), SyncRefusal);
  assert.throws(
    () => sync(root, quiet),
    /differs from .* \.flow\/lock\.json records \(run `fflow update`/,
  );
  assert.deepEqual(snapshot(root), before);
  /** @type {string[]} */
  const lines = [];
  const r = report(root, [], { log: (l) => lines.push(l), quiet: true });
  assert.equal(r.code, 1);
  assert.match(r.line, /^refused: .*fflow update/);
  assert.match(lines.join("\n"), /fflow sync: the installed presets\/ours preset/);
});

test("sync refuses a different preset name; only update adopts it", (t) => {
  const root = governed(t);
  sync(root, quiet);
  writeFileSync(join(root, "flow.config.json"), JSON.stringify({ version: 1, preset: "stackra" }));
  assert.throws(
    () => sync(root, quiet),
    /installed stackra preset .* differs from the neutral preset/,
  );
  sync(root, { ...quiet, adopt: true });
  assert.equal(readLock(root)?.preset.name, "stackra");
});

test("sync rewrites a v1 lock and an unreadable lock as v2", (t) => {
  const root = governed(t, { own: true });
  mkdirSync(join(root, ".flow"));
  writeFileSync(
    join(root, LOCK),
    JSON.stringify({ version: "0.2.3", preset: OWN_PRESET, files: {} }),
  );
  changePreset(root);
  sync(root, quiet);
  assert.equal(readLock(root)?.lockVersion, 2);
  assert.equal(readLock(root)?.preset.digest, treeDigest(join(root, OWN_PRESET)));
  writeFileSync(join(root, LOCK), "{ broken");
  sync(root, quiet);
  assert.equal(JSON.parse(readFileSync(join(root, LOCK), "utf8")).lockVersion, 2);
});
