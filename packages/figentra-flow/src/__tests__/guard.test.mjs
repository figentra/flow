/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow guard` to its contract: a `git worktree add` whose path is outside the repository's
 *   `.claude/worktrees/` is denied, through `cd … &&`, `git -C`, relative paths and quotes; one inside, other git
 *   commands and commands outside a repository pass; the settings entry runs the guard before Bash.
 * Boundary: a temporary repository; no network.
 * Runtime: node
 * Governing contract: ADR 0022; Stackra ADR 0503; STA-1729.
 */
// @covers sta-1729:FR-2 sta-1729:AC-003 sta-1729:P-002
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decide, SETTINGS, words } from "../commands/guard.mjs";
import { repo } from "./__fixtures__/repo.mjs";

// @covers sta-1945:FR-31
test("guard: dispatches before the console engine loads, so the hook path never imports @stackra/*", () => {
  const bin = new URL("../../bin/fflow.mjs", import.meta.url).pathname;
  const hooks = `import { registerHooks } from "node:module";
registerHooks({ resolve(s, c, next) { if (s.startsWith("@stackra/")) throw new Error("engine loaded: " + s); return next(s, c); } });`;
  const refuse = ["--import", `data:text/javascript,${encodeURIComponent(hooks)}`, bin];
  const guard = spawnSync(process.execPath, [...refuse, "guard", "--print-settings"], {
    encoding: "utf8",
  });
  assert.equal(guard.status, 0, guard.stderr);
  assert.deepEqual(JSON.parse(guard.stdout), SETTINGS);
  // The same hook does stop the engine, so the pass above is real.
  const doctor = spawnSync(process.execPath, [...refuse, "doctor", "--help"], { encoding: "utf8" });
  assert.match(doctor.stderr, /engine loaded: @stackra\/console/);
});

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
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "flow-guard-")));
  assert.equal(
    decide("git worktree add -b figentra/sta-1-a .claude/worktrees/sta-1-a origin/main", r.root),
    undefined,
  );
  assert.equal(
    decide(`git -C ${r.root} worktree add ${r.root}/.claude/worktrees/x`, outside),
    undefined,
  );
  assert.match(decide("git worktree add ../sibling", r.root) ?? "", /fflow start/);
  assert.match(decide(`git -C ${r.root} worktree add -b b ${outside}/x`, outside) ?? "", /outside/);
  assert.match(decide(`cd ${r.root} && git worktree add "${outside}/y"`, outside) ?? "", /outside/);
  assert.match(decide("git worktree add --detach /tmp/z HEAD", r.root) ?? "", /outside/);
});

test("guard: other git commands and commands outside a repository pass", (t) => {
  const r = repo();
  t.after(r.dispose);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "flow-guard-")));
  assert.equal(decide("git worktree list", r.root), undefined);
  assert.equal(decide("git worktree remove ../sibling", r.root), undefined);
  assert.equal(decide("echo git worktree add ../x", r.root), undefined);
  assert.equal(decide("git worktree add ../x", outside), undefined);
});

test("guard: the settings entry runs before every Bash call", () => {
  assert.deepEqual(SETTINGS.hooks.PreToolUse[0], {
    matcher: "Bash",
    hooks: [{ type: "command", command: "pnpm exec fflow guard" }],
  });
});
