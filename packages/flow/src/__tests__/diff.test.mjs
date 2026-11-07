/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow diff` to STA-1945 FR-1: it writes nothing and lists every file `sync` or `update` would add,
 *   change or delete, the lock among them, each change with its `-` and `+` lines; a synced repository has nothing to
 *   change, rendered as it was synced.
 * Boundary: temporary folders; no process, no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-1 sta-1945:AC-1 sta-1945:P-001
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { diff, linePatch, report } from "../commands/diff.mjs";
import { sync } from "../commands/sync.mjs";
import { changePreset, governed, snapshot } from "./__fixtures__/governed.mjs";

const quiet = { log: () => {} };

/**
 * `diff` of `root`, after proving it wrote nothing.
 * @param {string} root
 */
const changes = (root) => {
  const before = snapshot(root);
  const found = diff(root);
  assert.deepEqual(snapshot(root), before, "diff writes nothing");
  return found;
};

test("linePatch: the removed and added lines, in order", () => {
  assert.equal(linePatch("a\nb\nc\n", "a\nx\nc\n"), "-b\n+x");
  assert.equal(linePatch("", "a\nb\n"), "+a\n+b");
  assert.equal(linePatch("same\n", "same\n"), "");
});

test("diff: before sync, every rendered file and the lock are adds; after sync, nothing", (t) => {
  const root = governed(t);
  const before = changes(root);
  assert.ok(before.every((c) => c.kind === "add"));
  assert.ok(before.some((c) => c.path === ".flow/lock.json"));
  assert.ok(before.some((c) => c.path === ".agents/skills/flow-plan/SKILL.md"));
  sync(root, quiet);
  assert.deepEqual(changes(root), []);
  /** @type {string[]} */
  const lines = [];
  assert.deepEqual(report(root, [], { log: (l) => lines.push(l), quiet: false }), {
    code: 0,
    line: "nothing to change",
  });
});

test("diff: a hand edit is a change with its lines; a spec-kit file is a delete; a direct sync stays direct", (t) => {
  const root = governed(t);
  sync(root, { ...quiet, direct: true });
  assert.deepEqual(changes(root), [], "renders as the last sync did");
  const file = join(root, ".claude/skills/flow-plan/SKILL.md");
  const text = readFileSync(file, "utf8");
  writeFileSync(file, text.replace("name: flow-plan", "name: ours"));
  mkdirSync(join(root, ".claude/skills/speckit-plan"), { recursive: true });
  const found = changes(root);
  assert.deepEqual(
    found.map((c) => [c.kind, c.path]),
    [
      ["change", ".claude/skills/flow-plan/SKILL.md"],
      ["delete", ".claude/skills/speckit-plan"],
    ],
  );
  assert.equal(found[0].patch, "-name: ours\n+name: flow-plan");
});

test("diff: a changed preset shows what update would write, the lock included, and says so", (t) => {
  const root = governed(t, { own: true });
  sync(root, quiet);
  changePreset(root);
  assert.deepEqual(
    changes(root).map((c) => [c.kind, c.path]),
    [
      ["change", ".agents/skills/flow-plan/SKILL.md"],
      ["change", ".flow/lock.json"],
    ],
  );
  /** @type {string[]} */
  const lines = [];
  report(root, [], { log: (l) => lines.push(l), quiet: false });
  assert.match(lines[0], /this is what `fflow update` would change$/);
  assert.match(lines.join("\n"), /^\+A newer step\.$/m);
});
