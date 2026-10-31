/**
 * Vellum file contract:
 * Purpose: `vellum start <STA-n> [--slug s] [--install] [--dry-run]` — the only way a worktree is made: fetch, then
 *   branch `figentra/sta-n-<slug>` from `origin/<default>` into `<repo>/.claude/worktrees/sta-n-<slug>`, and move the
 *   Linear issue to In Progress with a comment naming the branch.
 * Boundary: writes one branch and one worktree, or nothing: an existing folder or branch (local or remote) is refused.
 *   Works from the main checkout or from inside any of its worktrees. Runs `pnpm install` only with `--install` (the
 *   Mac runs only oxfmt and oxlint). A Linear failure is a warning after the worktree exists (ADR 0065 rule 7).
 * Runtime: node
 * Governing contract: Stackra ADR 0503 (decision 6); ADR 0502; STA-1729.
 * Secrets: the Linear token only from the environment the calling wrapper sets; never read or printed.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { client, linear } from "../lib/linear.mjs";
import { defaultBranch, fetch, git, mainCheckout } from "../lib/git.mjs";

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
 * The issue tracker `start` uses: the title of a key and moving it to In Progress. The default is Linear through the
 * vendored client; tests pass their own.
 * @typedef {{ title: (key: string) => Promise<string | undefined>, inProgress: (key: string, branch: string) => Promise<void> }} Issues
 */

/** @returns {Issues} */
export function linearIssues(env = process.env) {
  const api = linear(client({ env }));
  return {
    async title(key) {
      return (await api.issue(key))?.title;
    },
    async inProgress(key, branch) {
      const issue = await api.issue(key);
      if (!issue) throw new Error(`${key} not found`);
      await api.setState(issue, "In Progress");
      await api.comment(issue, `Started: branch \`${branch}\` (vellum start).`);
    },
  };
}

/**
 * Starts work on `key`.
 * @param {{ cwd: string, key: string, slug?: string, install?: boolean, dry?: boolean, issues?: Issues,
 *           log?: (s: string) => void, warn?: (s: string) => void, fetchRemote?: boolean }} options
 * @returns {Promise<{ ok: boolean, path?: string, branch?: string, problem?: string }>}
 */
export async function start(options) {
  const { cwd, dry = false, install = false, log = console.log, warn = console.error } = options;
  const n = options.key.match(/^sta-(\d+)$/i)?.[1];
  if (!n) return { ok: false, problem: `${options.key} is not an issue key (STA-n)` };
  const key = `STA-${n}`;
  const root = mainCheckout(cwd);
  if (!root) return { ok: false, problem: `${cwd} is not in a git repository` };
  let slug = options.slug;
  if (slug === undefined) {
    let title;
    try {
      title = await (options.issues ?? linearIssues()).title(key);
    } catch (error) {
      return { ok: false, problem: `cannot read ${key}'s title (${error.message}); pass --slug` };
    }
    if (!title) return { ok: false, problem: `${key} has no title; pass --slug` };
    slug = slugOf(title);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    return { ok: false, problem: `--slug ${slug} is not kebab-case` };
  const name = `sta-${n}-${slug}`;
  const branch = `figentra/${name}`;
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
    log(`vellum start: would create ${branch} from origin/${base} at ${path}`);
    return { ok: true, path, branch };
  }
  const added = git(root, ["worktree", "add", "-q", "-b", branch, path, `origin/${base}`]);
  if (!added.ok) return { ok: false, problem: `git worktree add failed: ${added.err}` };
  log(`vellum start: ${branch} at ${path} (from origin/${base})`);
  try {
    await (options.issues ?? linearIssues()).inProgress(key, branch);
    log(`vellum start: ${key} → In Progress`);
  } catch (error) {
    warn(`vellum start: warning: Linear not updated (${error.message}); the worktree is ready`);
  }
  if (install) {
    const r = spawnSync("pnpm", ["install"], { cwd: path, stdio: "inherit" });
    if (r.status !== 0)
      return { ok: false, path, branch, problem: "pnpm install failed in the new worktree" };
  }
  return { ok: true, path, branch };
}

/** `vellum start <STA-n> [--slug s] [--install] [--dry-run]`. */
export async function run(args) {
  const key = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--slug");
  const at = args.indexOf("--slug");
  if (!key) {
    console.error("usage: vellum start <STA-n> [--slug <kebab-slug>] [--install] [--dry-run]");
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
    console.error(`vellum start: ${result.problem}`);
    return 1;
  }
  return 0;
}
