/**
 * Vellum file contract:
 * Purpose: hold `vellum guard` to its contract: a `git worktree add` whose path is outside the repository's
 *   `.claude/worktrees/` is denied, through `cd … &&`, `git -C`, relative paths and quotes; one inside, other git
 *   commands and commands outside a repository pass; the settings entry runs the guard before Bash.
 * Boundary: a temporary repository; no network.
 * Runtime: node
 * Governing contract: ADR 0022; Stackra ADR 0503; STA-1729.
 */
// @covers sta-1729:FR-2 sta-1729:AC-003 sta-1729:P-002
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decide, SETTINGS, words } from "../commands/guard.mjs";
import { repo } from "./__fixtures__/repo.mjs";

test("words: splits simple commands and honours quotes", () => {
  assert.deepEqual(words(`cd "a b" && git worktree add 'x y'; ls | wc`), [
    ["cd", "a b"],
    ["git", "worktree", "add", "x y"],
    ["ls"],
    ["wc"],
  ]);
});

test("guard: allows a worktree inside .claude/worktrees and denies one outside, however it is written", (t) => {
  const r = repo();
  t.after(r.dispose);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "vellum-guard-")));
  assert.equal(
    decide("git worktree add -b figentra/sta-1-a .claude/worktrees/sta-1-a origin/main", r.root),
    undefined,
  );
  assert.equal(
    decide(`git -C ${r.root} worktree add ${r.root}/.claude/worktrees/x`, outside),
    undefined,
  );
  assert.match(decide("git worktree add ../sibling", r.root) ?? "", /vellum start/);
  assert.match(decide(`git -C ${r.root} worktree add -b b ${outside}/x`, outside) ?? "", /outside/);
  assert.match(decide(`cd ${r.root} && git worktree add "${outside}/y"`, outside) ?? "", /outside/);
  assert.match(decide("git worktree add --detach /tmp/z HEAD", r.root) ?? "", /outside/);
});

test("guard: other git commands and commands outside a repository pass", (t) => {
  const r = repo();
  t.after(r.dispose);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "vellum-guard-")));
  assert.equal(decide("git worktree list", r.root), undefined);
  assert.equal(decide("git worktree remove ../sibling", r.root), undefined);
  assert.equal(decide("echo git worktree add ../x", r.root), undefined);
  assert.equal(decide("git worktree add ../x", outside), undefined);
});

test("guard: the settings entry runs before every Bash call", () => {
  assert.deepEqual(SETTINGS.hooks.PreToolUse[0], {
    matcher: "Bash",
    hooks: [{ type: "command", command: "pnpm exec vellum guard" }],
  });
});
