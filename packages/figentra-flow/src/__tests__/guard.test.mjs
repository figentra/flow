/**
 * Figentra Flow file contract:
 * Purpose: hold `fflow guard` to its contract: a `git worktree add` whose path is outside the repository's
 *   `.claude/worktrees/` is denied, through `cd … &&`, `git -C`, relative paths and quotes; one inside, other git
 *   commands and commands outside a repository pass; the settings entry runs the guard before Bash. The lifecycle's
 *   other side doors (a push to the default branch, `gh pr merge`, `LEFTHOOK=0`) are denied, directly or through a
 *   wrapper, each naming the Flow command to use instead.
 * Boundary: a temporary repository; no network.
 * Runtime: node
 * Governing contract: ADR 0022; Stackra ADR 0503; STA-1729; STA-1945.
 */
// @covers sta-1729:FR-2 sta-1729:AC-003 sta-1729:P-002 sta-1945:FR-13 sta-1945:AC-38 sta-1945:P-018
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decide, SETTINGS, words } from "../commands/guard.mjs";
import { repo, sh } from "./__fixtures__/repo.mjs";

test("guard: a push to the default branch is denied, naming fflow land (P-018)", (t) => {
  const r = repo();
  t.after(r.dispose);
  for (const command of [
    "git push origin main",
    "git push origin HEAD:main",
    "git push --force origin +topic:refs/heads/main",
    "git push",
    "git push --all origin",
    `cd ${r.root} && pnpm bot:git -- -C ${r.root} push origin main`,
    "GIT_TRACE=1 git push origin main",
  ])
    assert.match(decide(command, r.root) ?? "", /Pushing to main .*fflow land/, command);
  sh(r.root, "switch", "-q", "-c", "figentra/sta-1-a");
  for (const command of [
    "git push -u origin HEAD",
    "git push",
    "git push origin figentra/sta-1-a",
    "pnpm bot:git -- push origin HEAD:refs/heads/figentra/sta-1-a",
    "echo git push origin main",
  ])
    assert.equal(decide(command, r.root), undefined, command);
});

test("guard: gh pr merge and LEFTHOOK=0 are denied, naming the Flow command (P-018)", (t) => {
  const r = repo();
  t.after(r.dispose);
  for (const command of ["gh pr merge 12 --squash", "pnpm bot:gh -- pr merge 12 --auto"])
    assert.match(decide(command, r.root) ?? "", /fflow land <pr>/, command);
  for (const command of ["LEFTHOOK=0 git commit -m x", "export LEFTHOOK=0 && git commit -m x"])
    assert.match(decide(command, r.root) ?? "", /fflow hooks run/, command);
  for (const command of ["gh pr view 12", `git commit -m "LEFTHOOK=0 is refused"`])
    assert.equal(decide(command, r.root), undefined, command);
  assert.match(decide("X=1 git worktree add ../y", r.root) ?? "", /fflow start/);
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
