/**
 * Figentra Flow file contract:
 * Purpose: `fflow start <key> [--slug s] [--role id] [--session name] [--install] [--dry-run]` — the only way a
 *   worktree is made: fetch, then
 *   branch `<branchPrefix>/<key>-<slug>` from `origin/<default>` into `<repo>/.claude/worktrees/<key>-<slug>`, and
 *   move the issue to In Progress through the tracker port, naming the branch. With a roster (AC-049), the role is
 *   `--role` or the spec's `**Role**` on the default branch; the issue gets its `role:<id>` label and the agent app as
 *   delegate, and a comment records the builder's role and session (`--session`, else the spec's `**Session**`).
 *   The stage ends with Flow's record (STA-1945 FR-14): `start` done (`worktree` when the spec there is Tasked or
 *   later, so `next` names the build), committed on the new branch and pushed. When the key has no spec folder, the
 *   new worktree gets `<specs dir>/<key>-<slug>/spec.md` from the preset's spec template, its issue key line and
 *   `**Feature Branch**` filled in, left uncommitted for the builder (STA-2126).
 * Boundary: writes one branch and one worktree, or nothing: an existing folder or branch (local or remote) is refused.
 *   The record's commit and push only warn when they fail.
 *   Works from the main checkout or from inside any of its worktrees. Runs `pnpm install` only with `--install` (the
 *   Mac runs only oxfmt and oxlint). A tracker failure is a warning after the worktree exists (ADR 0065 rule 7).
 * Runtime: node
 * Governing contract: Stackra ADR 0503 (decision 6); ADR 0502; STA-1729; STA-1945 (FR-13, FR-14, AC-18, P-019).
 * Secrets: the Linear token only from the environment the calling wrapper sets; never read or printed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { trackerFor } from "../adapters/tracker/index.mjs";
import { SPECS_DIR, specDir } from "./gate.mjs";
import { resolveTemplate } from "../lib/flow-dir.mjs";
import { defaultBranch, fetch, git, mainCheckout } from "../lib/git.mjs";
import { NAME } from "../lib/product.mjs";
import { endStage } from "../lib/record.mjs";
import { pathProblems, roleOf } from "../lib/roles.mjs";
import { parseTasks } from "../lib/spec-parse.mjs";
import { atLeast, statusOf } from "../lib/spec-status.mjs";
import { slugOf as repoSlug } from "./gate-run.mjs";
import { loadTeam } from "../lib/team.mjs";

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
 * @typedef {{ title: (key: string) => Promise<string | undefined>, inProgress: (key: string, branch: string) => Promise<void>,
 *             role?: (key: string, label: string) => Promise<void>, comment?: (key: string, body: string) => Promise<void> }} Issues
 */

/**
 * Starts work on `key`.
 * @param {{ cwd: string, key: string, slug?: string, role?: string, session?: string, install?: boolean, dry?: boolean,
 *           issues?: Issues,
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
  const team = loadTeam(root);
  if (options.role !== undefined && !team?.roles.has(options.role))
    return {
      ok: false,
      problem: team
        ? `--role ${options.role} is not a role of the roster (${[...team.roles.keys()].join(", ")})`
        : `--role needs a roster ("team" in the configuration)`,
    };
  const shown = scheme.display(key);
  let slug = options.slug;
  if (slug === undefined) {
    if (!issues) return { ok: false, problem: `${problem}; or pass --slug` };
    let title;
    try {
      title = await issues.title(shown);
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
  /** The spec folder to create under `top`: the key's folder when it has none yet (STA-2126). */
  const newSpec = (/** @type {string} */ top) => {
    const { dir } = specDir({ root: top, key, slug, keys: scheme });
    return dir && !existsSync(join(top, dir)) ? dir : undefined;
  };
  if (dry) {
    const spec = newSpec(root);
    log(
      `${NAME} start: would create ${branch} from origin/${base} at ${path}${spec ? ` and ${spec}/spec.md` : ""}`,
    );
    return { ok: true, path, branch };
  }
  const added = git(root, ["worktree", "add", "-q", "-b", branch, path, `origin/${base}`]);
  if (!added.ok) return { ok: false, problem: `git worktree add failed: ${added.err}` };
  log(`${NAME} start: ${branch} at ${path} (from origin/${base})`);
  const specFile = join(path, SPECS_DIR, name, "spec.md");
  const tasked =
    existsSync(specFile) && atLeast(statusOf(readFileSync(specFile, "utf8")), "tasked");
  const unrecorded = endStage(path, key, tasked ? "worktree" : "start");
  if (unrecorded) warn(`${NAME} start: warning: the record was not saved (${unrecorded})`);
  try {
    if (!issues) throw new Error(problem);
    await issues.inProgress(shown, branch);
    log(`${NAME} start: ${shown} → In Progress`);
  } catch (error) {
    warn(
      `${NAME} start: warning: the tracker was not updated (${/** @type {Error} */ (error).message}); the worktree is ready`,
    );
  }
  if (team) {
    const spec = join(path, SPECS_DIR, name, "spec.md");
    const text = existsSync(spec) ? readFileSync(spec, "utf8") : "";
    const role = options.role ?? roleOf(text);
    const session =
      options.session ?? (text.match(/^\*\*Session\*\*:[ \t]*(.+)$/m)?.[1]?.trim() || undefined);
    if (!role)
      warn(
        `${NAME} start: warning: no role (pass --role, or set the spec's **Role**); the lead assigns one`,
      );
    else if (!team.roles.has(role))
      warn(`${NAME} start: warning: the spec's role \`${role}\` is not a role of the roster`);
    else
      try {
        if (!issues?.role || !issues.comment)
          throw new Error(problem ?? "the tracker sets no role");
        await issues.role(shown, `role:${role}`);
        await issues.comment(
          shown,
          `Builder: role \`${role}\`${session ? `, session ${session}` : ""}.`,
        );
        log(`${NAME} start: ${shown} → role:${role}`);
      } catch (error) {
        warn(
          `${NAME} start: warning: the role was not set (${/** @type {Error} */ (error).message})`,
        );
      }
    if (role && team.roles.has(role)) {
      // AC-052: the spec's planned files (its tasks' paths) against what the role may change here.
      const tasks = join(path, SPECS_DIR, name, "tasks.md");
      const planned = existsSync(tasks)
        ? parseTasks(readFileSync(tasks, "utf8"))
            .flatMap((t) => t.paths)
            .filter((f) => /^[\w.@-]+(\/[\w.@*-]+)+$/.test(f))
        : [];
      const slug = repoSlug(git(root, ["remote", "get-url", "origin"]).out);
      for (const p of pathProblems(team, role, slug, [...new Set(planned)]))
        warn(`${NAME} start: warning: ${p}`);
    }
  }
  const spec = newSpec(path);
  const template = spec ? resolveTemplate(path, "spec-template") : undefined;
  if (spec && template) {
    mkdirSync(join(path, spec), { recursive: true });
    const text = readFileSync(template, "utf8")
      .replace(/^(\*\*(?:Linear|Issue)\*\*:[ \t]*)\S+/m, `$1${shown}`)
      .replace(/^(\*\*Feature Branch\*\*:[ \t]*)\S+/m, `$1\`${branch}\``);
    writeFileSync(join(path, spec, "spec.md"), text);
    log(`${NAME} start: ${spec}/spec.md from the spec template`);
  } else if (spec) warn(`${NAME} start: warning: no spec-template, so no ${spec}/spec.md`);
  if (install) {
    const r = spawnSync("pnpm", ["install"], { cwd: path, stdio: "inherit" });
    if (r.status !== 0)
      return { ok: false, path, branch, problem: "pnpm install failed in the new worktree" };
  }
  return { ok: true, path, branch };
}

/** `fflow start <issue-key> [--slug s] [--install] [--dry-run]`. */
export async function run(args) {
  const valued = ["--slug", "--role", "--session"];
  const key = args.find((a, i) => !a.startsWith("--") && !valued.includes(args[i - 1]));
  const at = args.indexOf("--slug");
  const opt = (/** @type {string} */ name) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  if (!key) {
    console.error(
      `usage: ${NAME} start <issue-key> [--slug <kebab-slug>] [--role <id>] [--session <name>] [--install] [--dry-run]`,
    );
    return 2;
  }
  const result = await start({
    cwd: process.cwd(),
    key,
    ...(at >= 0 ? { slug: args[at + 1] } : {}),
    role: opt("--role"),
    session: opt("--session"),
    install: args.includes("--install"),
    dry: args.includes("--dry-run"),
  });
  if (!result.ok) {
    console.error(`${NAME} start: ${result.problem}`);
    return 1;
  }
  return 0;
}
