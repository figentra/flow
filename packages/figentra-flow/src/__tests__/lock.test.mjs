/**
 * Figentra Flow file contract:
 * Purpose: hold lock v2 to STA-1945 FR-2: the digests are the same for the same content whatever the file order or
 *   line endings, and change with any byte; a missing lock reads as none, an invalid one is a LockError, a v1 lock
 *   reads as v2; a written lock reads back unchanged; `driftOf` names each changed or missing file.
 * Boundary: temporary folders; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-2 sta-1945:AC-2 sta-1945:P-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  digestOf,
  driftOf,
  LockError,
  overridesDigest,
  readLock,
  treeDigest,
  upgradeLock,
  writeLock,
} from "../lib/lock.mjs";

const temp = (/** @type {{ after: (fn: () => void) => void }} */ t) => {
  const dir = mkdtempSync(join(tmpdir(), "flow-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/**
 * Writes `files` into `dir` in the given order.
 * @param {string} dir
 * @param {[string, string][]} files
 */
const fill = (dir, files) => {
  for (const [p, text] of files) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
};

test("treeDigest: the same content gives the same digest whatever the order or line endings", (t) => {
  const a = temp(t);
  const b = temp(t);
  fill(a, [
    ["preset.yml", "id: x\nname: y\n"],
    ["commands/flow-plan.md", "# Plan\n"],
  ]);
  fill(b, [
    ["commands/flow-plan.md", "# Plan\r\n"],
    ["preset.yml", "id: x\r\nname: y\r\n"],
  ]);
  assert.match(treeDigest(a), /^sha256:[0-9a-f]{64}$/);
  assert.equal(treeDigest(a), treeDigest(b));
  fill(b, [["commands/flow-plan.md", "# Plan.\n"]]);
  assert.notEqual(treeDigest(a), treeDigest(b), "one byte changes it");
  fill(b, [["commands/flow-plan.md", "# Plan\n"]]);
  fill(b, [["commands/x.md", ""]]);
  assert.notEqual(treeDigest(a), treeDigest(b), "a new empty file changes it");
});

test("overridesDigest: empty without .flow/overrides/, the folder's digest with it", (t) => {
  const root = temp(t);
  assert.equal(overridesDigest(root), "");
  fill(root, [[".flow/overrides/commands/flow-plan.md", "Ours.\n"]]);
  assert.equal(overridesDigest(root), treeDigest(join(root, ".flow/overrides")));
});

test("readLock: none without a lock, a LockError on bad JSON, v1 upgraded, v2 read back as written", (t) => {
  const root = temp(t);
  assert.equal(readLock(root), undefined);
  fill(root, [[".flow/lock.json", "{ not json"]]);
  assert.throws(() => readLock(root), LockError);
  const hex = "a".repeat(64);
  fill(root, [
    [
      ".flow/lock.json",
      JSON.stringify({ version: "0.2.3", preset: "stackra", files: { "x.md": hex } }),
    ],
  ]);
  const v2 = {
    lockVersion: /** @type {2} */ (2),
    flow: "0.2.3",
    preset: { name: "stackra", version: "0.2.3", digest: "" },
    profile: "*",
    overrides: "",
    files: { "x.md": `sha256:${hex}` },
    skills: {},
  };
  assert.deepEqual(readLock(root), v2);
  assert.deepEqual(upgradeLock({}), {
    ...v2,
    flow: "",
    preset: { name: "neutral", version: "", digest: "" },
    files: {},
  });
  const written = { ...v2, preset: { ...v2.preset, digest: digestOf("p") } };
  writeLock(root, written);
  assert.deepEqual(readLock(root), written);
});

test("driftOf: each owned file that changed by a byte or is missing", (t) => {
  const root = temp(t);
  fill(root, [
    ["a.md", "A\n"],
    ["b.json", "{}\n"],
    ["c.yml", "c: 1\n"],
  ]);
  const lock = upgradeLock({});
  lock.files = { "a.md": digestOf("A\n"), "b.json": digestOf("{}\n"), "c.yml": digestOf("c: 1\n") };
  assert.deepEqual(driftOf(root, lock), []);
  fill(root, [["b.json", "{} \n"]]);
  rmSync(join(root, "c.yml"));
  assert.deepEqual(driftOf(root, lock), [
    { path: "b.json", kind: "changed" },
    { path: "c.yml", kind: "missing" },
  ]);
});
