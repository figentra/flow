/**
 * Figentra Flow file contract:
 * Purpose: the SessionStart hook with the stackra tables re-states core's invariants with the event's source, the
 *   branch and the dirty tree (`(no git)` outside a checkout); the neutral preset adds nothing, and the hook never
 *   blocks.
 * Boundary: test only; runs the hook entry as a child process on temporary repositories.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945.
 */
// @covers sta-1945:FR-7 sta-1945:AC-9 sta-1945:P-012
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CONFIG_FILE } from "../lib/product.mjs";
import { presetRoot, runHook } from "./__fixtures__/guard.mjs";
import { CONFIG, repo } from "./__fixtures__/repo.mjs";

/** The context the hook adds for a SessionStart of `source` in `dir`, or "" when it adds none. */
const contextFor = (/** @type {string} */ dir, /** @type {string | undefined} */ source) => {
  const r = runHook(
    "SessionStart",
    { source, cwd: dir },
    { ...process.env, CLAUDE_PROJECT_DIR: dir },
  );
  assert.equal(r.status, 0);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : "";
};

test("session: the stackra invariants with the source, the branch and the dirty tree", (t) => {
  const r = repo();
  t.after(r.dispose);
  writeFileSync(join(r.root, CONFIG_FILE), JSON.stringify({ ...CONFIG, preset: "stackra" }));
  const ctx = contextFor(r.root, "compact");
  assert.match(ctx, /^\[STACKRA SESSION — compact\] branch: main\nInvariants:\n0\. Layout: /);
  assert.match(ctx, /\n7\. Worktrees: WIP commits, never stash/);
  // The status is trimmed, as core's is, so the first line loses its leading space.
  assert.match(ctx, /\nWorking tree:\nM flow\.config\.json$/);
  assert.match(contextFor(r.root, undefined), /^\[STACKRA SESSION — start\]/);
});

test("session: outside a checkout the branch is (no git); the neutral preset adds nothing", (t) => {
  const stackra = presetRoot();
  const neutral = presetRoot("neutral");
  t.after(() => [stackra, neutral].forEach((d) => rmSync(d, { recursive: true, force: true })));
  const ctx = contextFor(stackra, "startup");
  assert.match(ctx, /^\[STACKRA SESSION — startup\] branch: \(no git\)\n/);
  assert.doesNotMatch(ctx, /Working tree:/);
  assert.equal(contextFor(neutral, "startup"), "");
});
