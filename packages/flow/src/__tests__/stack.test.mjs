/**
 * Figentra Flow file contract:
 * Purpose: hold `mergeUp` to P-022: after the parent squash-merges, a conflict where main holds the parent's own
 *   version is resolved (the child's side when it built on that version, main's when the child left the file), any
 *   other conflict aborts the merge and names the file, the result is a merge commit on the child's head (never a
 *   rewrite), and a tip pushed from elsewhere is taken before merging.
 * Boundary: temporary repositories with a local bare origin; no network.
 * Runtime: node
 * Governing contract: ADR 0022; STA-1945 FR-16, AC-14, P-022.
 */
// @covers sta-1945:FR-16 sta-1945:AC-14 sta-1945:P-022
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mergeUp, parentIdentical } from "../lib/stack.mjs";
import { commit, repo, sh } from "./__fixtures__/repo.mjs";

/** A parent branch `p` that changes shared.txt, and a child `c` on it, each in its own worktree. */
function setup() {
  const r = repo({ "shared.txt": "zero\n" });
  const parent = join(r.root, ".claude", "worktrees", "p");
  const child = join(r.root, ".claude", "worktrees", "c");
  sh(r.root, "worktree", "add", "-q", "-b", "p", parent, "main");
  commit(parent, "shared.txt", "one\n");
  sh(r.root, "worktree", "add", "-q", "-b", "c", child, "p");
  /** GitHub's squash of `p` onto main, pushed; the child's checkout then fetches it. */
  const squash = () => {
    sh(r.root, "merge", "-q", "--squash", "p");
    sh(r.root, "commit", "-q", "-m", "squash p");
    sh(r.root, "push", "-q", "origin", "main");
    sh(child, "fetch", "-q", "origin");
  };
  return { r, parent, child, squash };
}

const read = (/** @type {string} */ dir) => readFileSync(join(dir, "shared.txt"), "utf8");

test("merge up: the child's side wins where main holds the parent's version it built on, by a merge commit", (t) => {
  const { r, parent, child, squash } = setup();
  t.after(r.dispose);
  commit(child, "shared.txt", "two\n");
  squash();
  const before = sh(child, "rev-parse", "HEAD");
  const up = mergeUp({
    root: child,
    child: "c",
    base: "main",
    squashedParent: sh(parent, "rev-parse", "HEAD"),
  });
  assert.deepEqual(up, { merged: true, resolved: ["shared.txt"], conflicts: [] });
  assert.equal(read(child), "two\n");
  // Two parents, the first the child's old head: nothing rewritten.
  assert.deepEqual(sh(child, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").slice(1), [
    before,
    sh(child, "rev-parse", "origin/main"),
  ]);
});

test("merge up: main's side wins where the parent moved on and the child left the file as it took it", (t) => {
  const { r, parent, child, squash } = setup();
  t.after(r.dispose);
  commit(child, "c.txt");
  commit(parent, "shared.txt", "uno\n");
  squash();
  const up = mergeUp({
    root: child,
    child: "c",
    base: "main",
    squashedParent: sh(parent, "rev-parse", "HEAD"),
  });
  assert.deepEqual(up.resolved, ["shared.txt"]);
  assert.equal(read(child), "uno\n");
});

test("merge up: any other conflict aborts the merge and names the file; no parent named resolves nothing", (t) => {
  const { r, parent, child, squash } = setup();
  t.after(r.dispose);
  commit(child, "shared.txt", "two\n");
  squash();
  const head = sh(child, "rev-parse", "HEAD");
  const unnamed = mergeUp({ root: child, child: "c", base: "main" });
  assert.deepEqual(unnamed, { merged: false, resolved: [], conflicts: ["shared.txt"] });
  // Main moves past the parent's version: no longer the parent's own change.
  commit(r.root, "shared.txt", "hotfix\n");
  sh(r.root, "push", "-q", "origin", "main");
  sh(child, "fetch", "-q", "origin");
  const p = sh(parent, "rev-parse", "HEAD");
  assert.equal(parentIdentical(child, "shared.txt", "origin/main", p), false);
  const real = mergeUp({ root: child, child: "c", base: "main", squashedParent: p });
  assert.deepEqual(real.conflicts, ["shared.txt"]);
  assert.equal(real.merged, false);
  // The worktree is as it was: same head, no merge in progress.
  assert.equal(sh(child, "rev-parse", "HEAD"), head);
  assert.equal(sh(child, "status", "--porcelain"), "");
});

test("merge up: a tip pushed from elsewhere is taken first, and a merged child is left alone", (t) => {
  const { r, parent, child, squash } = setup();
  t.after(r.dispose);
  commit(child, "c.txt");
  sh(child, "push", "-q", "origin", "c");
  sh(child, "reset", "-q", "--hard", "HEAD~1");
  squash();
  const pushed = sh(child, "rev-parse", "origin/c");
  const p = sh(parent, "rev-parse", "HEAD");
  const up = mergeUp({ root: child, child: "c", base: "main", squashedParent: p });
  assert.equal(up.merged, true);
  assert.equal(sh(child, "rev-parse", "HEAD^1"), pushed);
  const again = mergeUp({ root: child, child: "c", base: "main", squashedParent: p });
  assert.deepEqual(again, { merged: true, resolved: [], conflicts: [] });
});
