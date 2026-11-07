/**
 * Figentra Flow file contract:
 * Purpose: bring a stacked PR's branch onto the default branch after the PR below it squash-merged: catch up with the
 *   branch's remote tip, merge the default branch in, and resolve each conflict in a file whose default-branch version
 *   is the squashed parent's own version: the child's side when the child built on that version, the default
 *   branch's when the child left the file as it took it.
 * Boundary: runs `git` in the child's worktree only; a merge commit, never a rebase, a reset or a push. Any other
 *   conflict aborts the merge and names the files, leaving the worktree as it was.
 * Runtime: node
 * Governing contract: STA-1945 FR-16, AC-14, P-022 (plan C11).
 * Secrets: none.
 */
import { git } from "./git.mjs";

/** Whether `a` is an ancestor of (or equal to) `b` in `cwd`. */
const isAncestor = (/** @type {string} */ cwd, /** @type {string} */ a, /** @type {string} */ b) =>
  git(cwd, ["merge-base", "--is-ancestor", a, b]).ok;

/**
 * Which side of a conflict in `path` is the answer, when the default branch's blob is the parent's head blob: the
 * child's (`ours`) when the child last took the file from that very version (the blob at the child's merge base with
 * the parent), the default branch's (`theirs`) when the child has not changed the file since it took it. Otherwise,
 * or when the parent is not here, none. An absent file counts as a blob of its own.
 * @param {string} root  the child's worktree, mid-merge
 * @param {string} path
 * @param {string} base  the default branch's ref (`origin/main`)
 * @param {string} parent  the squashed parent's head commit
 * @returns {"ours" | "theirs" | undefined}
 */
function sideOf(root, path, base, parent) {
  if (!git(root, ["cat-file", "-e", `${parent}^{commit}`]).ok) return undefined;
  const fork = git(root, ["merge-base", "HEAD", parent]);
  if (!fork.ok) return undefined;
  const blob = (/** @type {string} */ ref) => {
    const r = git(root, ["rev-parse", "-q", "--verify", `${ref}:${path}`]);
    return r.ok ? r.out : null;
  };
  const theirs = blob(parent);
  if (blob(base) !== theirs) return undefined;
  const took = blob(fork.out);
  if (took === theirs) return "ours";
  return blob("HEAD") === took ? "theirs" : undefined;
}

/**
 * Whether a conflict in `path` is only the squashed parent's own change, so Flow resolves it (`sideOf` says how).
 * @param {string} root  the child's worktree, mid-merge
 * @param {string} path
 * @param {string} base  the default branch's ref (`origin/main`)
 * @param {string} parent  the squashed parent's head commit
 * @returns {boolean}
 */
export const parentIdentical = (root, path, base, parent) =>
  sideOf(root, path, base, parent) !== undefined;

/**
 * Merges `origin/<base>` into the child's worktree. `merged` means HEAD now holds the default branch; `resolved` names
 * the parent-identical conflicts Flow resolved; `conflicts` names the others, after which the merge is aborted.
 * @param {{ root: string, child: string, base: string, squashedParent?: string }} options  `root` is the child's
 *   worktree, `child` its branch
 * @returns {{ merged: boolean, resolved: string[], conflicts: string[], error?: string }}
 */
export function mergeUp({ root, child, base, squashedParent }) {
  /** @type {string[]} */
  const none = [];
  const fail = (/** @type {string} */ error) => {
    git(root, ["merge", "--abort"]);
    return { merged: false, resolved: none, conflicts: none, error };
  };
  // A resolution pushed from elsewhere (a re-run after a stop) is taken first, never overwritten.
  const tip = `origin/${child}`;
  if (
    git(root, ["rev-parse", "-q", "--verify", `${tip}^{commit}`]).ok &&
    !isAncestor(root, tip, "HEAD")
  ) {
    const ff = git(root, ["merge", "--ff-only", "-q", tip]);
    if (!ff.ok)
      return {
        merged: false,
        resolved: none,
        conflicts: none,
        error: `${child} has diverged from ${tip}: ${ff.err}`,
      };
  }
  const target = `origin/${base}`;
  if (isAncestor(root, target, "HEAD")) return { merged: true, resolved: none, conflicts: none };
  const merge = git(root, ["merge", "--no-edit", "-q", target]);
  if (merge.ok) return { merged: true, resolved: none, conflicts: none };
  const unmerged = git(root, ["diff", "--name-only", "--diff-filter=U"])
    .out.split("\n")
    .filter(Boolean);
  // No unmerged path means git stopped for another reason (no identity, a hook): report it as git said it.
  if (!unmerged.length) return fail(merge.err || "git merge exited non-zero");
  const sides = unmerged.map((path) => ({
    path,
    side: squashedParent ? sideOf(root, path, target, squashedParent) : undefined,
  }));
  const conflicts = sides.filter((s) => !s.side).map((s) => s.path);
  if (conflicts.length) {
    git(root, ["merge", "--abort"]);
    return { merged: false, resolved: none, conflicts };
  }
  for (const { path, side } of sides) {
    const from = side === "ours" ? "HEAD" : target;
    const kept = git(root, ["cat-file", "-e", `${from}:${path}`]).ok
      ? git(root, ["checkout", `--${side}`, "--", path]).ok && git(root, ["add", "--", path]).ok
      : git(root, ["rm", "-q", "--", path]).ok;
    if (!kept) return fail(`could not keep the ${side} side of ${path}`);
  }
  const done = git(root, ["commit", "--no-edit", "-q"]);
  if (!done.ok) return fail(done.err || "git commit exited non-zero");
  return { merged: true, resolved: unmerged, conflicts: none };
}
