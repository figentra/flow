/**
 * Vellum file contract:
 * Purpose: `vellum start <key> [--slug s] [--install] [--dry-run]` — the only way a worktree is made: fetch, then
 *   branch `<branchPrefix>/<key>-<slug>` from `origin/<default>` into `<repo>/.claude/worktrees/<key>-<slug>`, and
 *   move the issue to In Progress through the tracker port, naming the branch.
 * Boundary: writes one branch and one worktree, or nothing: an existing folder or branch (local or remote) is refused.
 *   Works from the main checkout or from inside any of its worktrees. Runs `pnpm install` only with `--install` (the
 *   Mac runs only oxfmt and oxlint). A tracker failure is a warning after the worktree exists (ADR 0065 rule 7).
 * Runtime: node
 * Governing contract: Stackra ADR 0503 (decision 6); ADR 0502; STA-1729.
 * Secrets: the Linear token only from the environment the calling wrapper sets; never read or printed.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { trackerFor } from "../adapters/tracker/index.mjs";
import { defaultBranch, fetch, git, mainCheckout } from "../lib/git.mjs";
import { NAME } from "../lib/product.mjs";

/** The slug of an issue title: lower-case words, at most 5 words and 40 characters. */
export function slugOf(title) {
  const words = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 5);
  let slug = "";
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > 40) break;
    slug = next;
  }
  return slug;
}

/**
 * The issue tracker `start` uses: the title of a key and moving it to In Progress (the tracker port's methods; tests
 * pass their own).
 * @typedef {{ title: (key: string) => Promise<string | undefined>, inProgress: (key: string, branch: string) => Promise<void> }} Issues
 */

/**
 * Starts work on `key`.
 * @param {{ cwd: string, key: string, slug?: string, install?: boolean, dry?: boolean, issues?: Issues,
 *           log?: (s: string) => void, warn?: (s: string) => void, fetchRemote?: boolean }} options
 * @returns {Promise<{ ok: boolean, path?: string, branch?: string, problem?: string }>}
 */
export async function start(options) {
  const { cwd, dry = false, install = false, log = console.log, warn = console.error } = options;
  const root = mainCheckout(cwd);
  if (!root) return { ok: false, problem: `${cwd} is not in a git repository` };
  const { scheme, tracker, problem } = trackerFor(root, { warn });
  const key = scheme.parse(options.key);
  if (!key || (scheme.prefix && !key.startsWith(`${scheme.prefix}-`)))
    return {
      ok: false,
      problem: `${options.key} is not an issue key (${scheme.prefix ? scheme.display(`${scheme.prefix}-n`) : "<prefix>-n"})`,
    };
  const issues = options.issues ?? tracker;
  const shown = scheme.display(key);
  let slug = options.slug;
  if (slug === undefined) {
    if (!issues) return { ok: false, problem: `${problem}; or pass --slug` };
    let title;
    try {
      title = await issues.title(key);
    } catch (error) {
      return {
        ok: false,
        problem: `cannot read ${shown}'s title (${/** @type {Error} */ (error).message}); pass --slug`,
      };
    }
    if (!title) return { ok: false, problem: `${shown} has no title; pass --slug` };
    slug = slugOf(title);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    return { ok: false, problem: `--slug ${slug} is not kebab-case` };
  const name = scheme.folder(key, slug);
  const branch = scheme.branch(key, slug);
  const path = join(root, ".claude", "worktrees", name);
  if (options.fetchRemote !== false) {
    const fetched = fetch(root);
    if (!fetched.ok) return { ok: false, problem: `fetch failed: ${fetched.err}` };
  }
  const base = defaultBranch(root);
  if (existsSync(path)) return { ok: false, problem: `${path} already exists` };
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`])
    if (git(root, ["show-ref", "--verify", "--quiet", ref]).ok)
      return { ok: false, problem: `branch ${branch} already exists (${ref})` };
  if (dry) {
    log(`${NAME} start: would create ${branch} from origin/${base} at ${path}`);
    return { ok: true, path, branch };
  }
  const added = git(root, ["worktree", "add", "-q", "-b", branch, path, `origin/${base}`]);
  if (!added.ok) return { ok: false, problem: `git worktree add failed: ${added.err}` };
  log(`${NAME} start: ${branch} at ${path} (from origin/${base})`);
  try {
    if (!issues) throw new Error(problem);
    await issues.inProgress(key, branch);
    log(`${NAME} start: ${shown} → In Progress`);
  } catch (error) {
    warn(
      `${NAME} start: warning: the tracker was not updated (${/** @type {Error} */ (error).message}); the worktree is ready`,
    );
  }
  if (install) {
    const r = spawnSync("pnpm", ["install"], { cwd: path, stdio: "inherit" });
    if (r.status !== 0)
      return { ok: false, path, branch, problem: "pnpm install failed in the new worktree" };
  }
  return { ok: true, path, branch };
}

/** `vellum start <issue-key> [--slug s] [--install] [--dry-run]`. */
export async function run(args) {
  const key = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--slug");
  const at = args.indexOf("--slug");
  if (!key) {
    console.error(`usage: ${NAME} start <issue-key> [--slug <kebab-slug>] [--install] [--dry-run]`);
    return 2;
  }
  const result = await start({
    cwd: process.cwd(),
    key,
    ...(at >= 0 ? { slug: args[at + 1] } : {}),
    install: args.includes("--install"),
    dry: args.includes("--dry-run"),
  });
  if (!result.ok) {
    console.error(`${NAME} start: ${result.problem}`);
    return 1;
  }
  return 0;
}
