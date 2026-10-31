/**
 * Vellum file contract:
 * Purpose: the git facts the worktree commands need: the repository's main checkout, its default branch, its
 *   worktrees, whether a worktree is clean, saved (its head on a remote ref, or every commit landed by patch), how long
 *   it has been idle, which ignored files it holds outside the usual caches, its size, and which folders running
 *   processes work in.
 * Boundary: runs `git` (and `du`, `lsof` or `/proc`) synchronously in the folder it is given; never writes. Network git goes through
 *   `fetch`, which uses the repository's own `bot:git` wrapper when it has one.
 * Runtime: node
 * Governing contract: Stackra ADR 0503 (worktrees live inside their repository); STA-1729.
 * Secrets: none.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

/** Ignored paths a worktree may hold and still be removed: dependency, build and tool caches. */
export const CACHES = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)build(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /(^|\/)\.turbo(\/|$)/,
  /(^|\/)\.cache(\/|$)/,
  /(^|\/)\.stackra(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)\.expo(\/|$)/,
  /\.tsbuildinfo$/,
  /(^|\/)\.DS_Store$/,
];

/** Tester worktree names: never cleaned, never adopted. */
export const TESTER = /^(?:g-.*|.*-gate|land-.*|tpl-core|c6-lock.*|template-wt-lean)$/;

/** The issue key a branch or folder carries (`sta-12`), lower-cased, or undefined. */
export const issueKey = (name = "") => name.match(/\bsta-(\d+)\b/i)?.[0]?.toLowerCase();

/**
 * Runs `git args` in `cwd`.
 * @param {string} cwd
 * @param {string[]} args
 * @returns {{ ok: boolean, out: string, err: string }}
 */
export function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 << 20 });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

/**
 * The main checkout of the repository `cwd` belongs to, also from inside one of its worktrees.
 * @param {string} cwd
 * @returns {string | undefined}
 */
export function mainCheckout(cwd) {
  const common = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.ok) return undefined;
  return basename(common.out) === ".git" ? dirname(common.out) : common.out;
}

/**
 * The default branch (`main`), read from `origin/HEAD`.
 * @param {string} root
 */
export function defaultBranch(root) {
  const head = git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  return head.ok ? head.out.replace(/^origin\//, "") : "main";
}

/**
 * Runs a network git command in `root`, through the repository's own `bot:git` wrapper when it has one (Figentra
 * repositories refuse raw network git).
 * @param {string} root
 * @param {string[]} args
 * @returns {{ ok: boolean, out: string, err: string }}
 */
export function remote(root, args) {
  let wrapped = false;
  try {
    wrapped = Boolean(
      JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts?.["bot:git"],
    );
  } catch {
    wrapped = false;
  }
  if (!wrapped) return git(root, args);
  const r = spawnSync("pnpm", ["bot:git", "--", ...args], { cwd: root, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

/** Fetches `origin` in `root`. */
export const fetch = (root) => remote(root, ["fetch", "-q", "origin"]);

/**
 * The commit `origin`'s branch points at now, or undefined when it has none.
 * @param {string} root
 * @param {string} branch
 */
export function remoteTip(root, branch) {
  const ref = `refs/heads/${branch}`;
  for (const line of remote(root, ["ls-remote", "origin", ref]).out.split("\n")) {
    const [sha, name] = line.split("\t");
    if (name === ref && /^[0-9a-f]{40}$/.test(sha)) return sha;
  }
  return undefined;
}

/**
 * @typedef {{ path: string, head: string, branch: string | undefined, detached: boolean, locked: boolean }} Worktree
 */

/**
 * The linked worktrees of the repository at `root` (the main checkout left out).
 * @param {string} root
 * @returns {Worktree[]}
 */
export function worktrees(root) {
  const out = git(root, ["worktree", "list", "--porcelain"]).out;
  /** @type {Worktree[]} */
  const list = [];
  for (const block of out.split(/\n\n+/).filter(Boolean)) {
    /** @type {Record<string, string>} */
    const f = {};
    for (const line of block.split("\n")) {
      const at = line.indexOf(" ");
      f[at < 0 ? line : line.slice(0, at)] = at < 0 ? "" : line.slice(at + 1);
    }
    if (f.worktree === undefined || "bare" in f) continue;
    list.push({
      path: f.worktree,
      head: f.HEAD ?? "",
      branch: f.branch?.replace(/^refs\/heads\//, ""),
      detached: "detached" in f,
      locked: "locked" in f,
    });
  }
  return list.filter((t) => resolve(t.path) !== resolve(root));
}

/** Whether the worktree at `path` has no change, untracked files included. */
export const isClean = (path) => {
  const s = git(path, ["status", "--porcelain"]);
  return s.ok && s.out === "";
};

/**
 * Whether the worktree's work is saved: its head is on a remote ref, or every commit is landed by patch
 * (`git cherry origin/<base> HEAD` lists no `+`), since core lands by cherry-pick from unpushed branches.
 * @param {string} path
 * @param {string} base  the default branch
 */
export function isSaved(path, base) {
  if (git(path, ["branch", "-r", "--contains", "HEAD"]).out !== "") return true;
  if (git(path, ["merge-base", "--is-ancestor", "HEAD", `origin/${base}`]).ok) return true;
  const cherry = git(path, ["cherry", `origin/${base}`, "HEAD"]);
  return cherry.ok && !cherry.out.split("\n").some((l) => l.startsWith("+"));
}

/**
 * Hours since the worktree last moved its HEAD: the modification time of its HEAD reflog (not the index, which
 * `git status` touches), else of its HEAD file.
 * @param {string} path
 * @param {number} [now]
 */
export function idleHours(path, now = Date.now()) {
  const dir = git(path, ["rev-parse", "--absolute-git-dir"]).out;
  const file = [join(dir, "logs", "HEAD"), join(dir, "HEAD")].find((f) => existsSync(f));
  if (file === undefined) return 0;
  return (now - statSync(file).mtimeMs) / 3_600_000;
}

/**
 * The ignored files the worktree holds outside the usual caches (`.env`, `ios/`, `android/`, …).
 * @param {string} path
 * @returns {string[]}
 */
export function preciousIgnored(path) {
  return git(path, ["status", "--ignored", "--porcelain"])
    .out.split("\n")
    .filter((l) => l.startsWith("!! "))
    .map((l) => l.slice(3).replace(/\/$/, ""))
    .filter((p) => !CACHES.some((re) => re.test(p)));
}

/** The folder's size in kilobytes (`du -sk`), 0 when it cannot be read. */
export function sizeKb(path) {
  const r = spawnSync("du", ["-sk", path], { encoding: "utf8" });
  return Number.parseInt(r.stdout ?? "", 10) || 0;
}

/**
 * The working folders of every running process: `lsof -a -d cwd -Fn`, else Linux's `/proc/<pid>/cwd`; undefined when
 * neither can be read, so a caller keeps every worktree rather than guess.
 * @returns {string[] | undefined}
 */
export function busyFolders() {
  const r = spawnSync("lsof", ["-a", "-d", "cwd", "-Fn"], { encoding: "utf8" });
  if (r.status === 0 || (r.stdout ?? "").includes("\nn"))
    return r.stdout
      .split("\n")
      .filter((l) => l.startsWith("n"))
      .map((l) => l.slice(1));
  if (!existsSync("/proc")) return undefined;
  /** @type {string[]} */
  const cwds = [];
  for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      cwds.push(readlinkSync(`/proc/${pid}/cwd`));
    } catch {
      // a process that ended, or one we may not read
    }
  }
  return cwds;
}

/**
 * Whether a running process works inside `path` (a session's working folder, a dev server, a shell).
 * @param {string} path
 * @param {string[]} cwds
 */
export function inUse(path, cwds) {
  const roots = [resolve(path)];
  try {
    roots.push(realpathSync(path));
  } catch {
    // a missing folder has no real path
  }
  return cwds.some((cwd) => roots.some((root) => cwd === root || cwd.startsWith(root + sep)));
}
