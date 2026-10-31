/**
 * Figentra Flow file contract:
 * Purpose: the snapshot behind `figentra-flow status` and the MCP server (FR-7, AC-012, AC-024, AC-026): for each
 *   repository of the workspace, its specs (status, tier, session, gate problems), its worktrees (branch, key, head,
 *   dirty, idle, in use, ahead and behind), its open PRs (gate on the head, the counted AI review, stacked) and its
 *   sessions (a spec's `**Session**`, with the worktree carrying the spec's key and that head's gate), plus a warning
 *   when more sessions build than the cap allows.
 * Boundary: reads git, the spec files and GitHub (through the credentials port; never with `offline`); stores nothing,
 *   writes nothing. A repository that is missing or unreadable, and a GitHub failure, are reported in place.
 * Runtime: node
 * Governing contract: STA-1729 phase 4 (the leader's plan stop of 2026-10-31).
 * Secrets: none; GitHub calls go through the repository's credentials, and no token or environment value is returned.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { schemeFor } from "../adapters/tracker/index.mjs";
import {
  checkStage,
  presetId,
  presetOf,
  RULES,
  SPECS_DIR,
  statusOf,
  tierOf,
} from "../commands/gate.mjs";
import { loadConfig } from "./config.mjs";
import { defaultBranch, git, idleHours, inUse, isClean, worktrees } from "./git.mjs";
import { STATUS_CONTEXT } from "./product.mjs";
import { aiReview } from "./review.mjs";

/** The snapshot's schema; a breaking change raises it. */
export const SNAPSHOT_VERSION = "figentra-flow.status/1";

/** Sessions that may build at once unless the owner raises `sessionCap` (AC-026). */
export const SESSION_CAP = 2;

/** Statuses at which a spec's session is building. */
const BUILDING = new Set(["tasked", "implementing"]);

const readIf = (/** @type {string} */ p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

/** A spec's `**Session**:` value, or undefined. */
export const sessionOf = (/** @type {string} */ text) =>
  text.match(/^\*\*Session\*\*:\s*([\w.-]+)/m)?.[1];

/**
 * The specs under one checkout's `.agents/specs`.
 * @param {string} checkout
 * @param {{ keys: any, rules: any }} context
 */
function specsIn(checkout, { keys, rules }) {
  const base = join(checkout, SPECS_DIR);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((folder) => existsSync(join(base, folder, "spec.md")))
    .map((folder) => {
      const dir = join(base, folder);
      const text = readIf(join(dir, "spec.md"));
      return {
        key: keys.folderKey(folder) ?? null,
        folder,
        status: statusOf(text) || null,
        tier: tierOf(text) ?? null,
        session: sessionOf(text) ?? null,
        problems: checkStage(folder, text, {
          files: readdirSync(dir),
          tasks: readIf(join(dir, "tasks.md")),
          plan: readIf(join(dir, "plan.md")),
          keys,
          rules,
        }),
      };
    });
}

/**
 * Ahead and behind counts of `path`'s HEAD against `origin/<branch>`, or nulls when there is no such ref.
 * @param {string} path
 * @param {string | undefined} branch
 */
function aheadBehind(path, branch) {
  if (!branch) return { ahead: null, behind: null };
  const r = git(path, ["rev-list", "--left-right", "--count", `origin/${branch}...HEAD`]);
  if (!r.ok) return { ahead: null, behind: null };
  const [behind, ahead] = r.out.split(/\s+/).map(Number);
  return { ahead, behind };
}

/**
 * The open PRs of `slug` with their head's gate and counted review.
 * @param {import("./github.mjs").Api} api
 * @param {string} slug
 * @param {string} base the default branch
 * @param {{ reviewer?: string, owner?: string, gateApp?: string }} apps
 */
function openPrs(api, slug, base, apps) {
  const listed = api("GET", `/repos/${slug}/pulls?state=open&per_page=100`);
  if (!listed.ok) throw new Error(listed.err || "listing pull requests failed");
  return (listed.json ?? []).map((/** @type {any} */ pr) => {
    const head = pr.head?.sha ?? "";
    const statuses = api("GET", `/repos/${slug}/commits/${head}/statuses?per_page=100`).json ?? [];
    // GitHub lists a commit's statuses newest first.
    const status = statuses.find((/** @type {any} */ s) => s.context === STATUS_CONTEXT);
    const comments =
      api("GET", `/repos/${slug}/issues/${pr.number}/comments?per_page=100`).json ?? [];
    const reviews = api("GET", `/repos/${slug}/pulls/${pr.number}/reviews?per_page=100`).json ?? [];
    const review = aiReview(
      { sha: head, base: pr.base?.ref },
      comments,
      reviews,
      [pr.user?.login],
      {
        reviewer: apps.reviewer,
        owner: apps.owner,
      },
    );
    return {
      number: pr.number,
      title: pr.title,
      branch: pr.head?.ref,
      head,
      base: pr.base?.ref,
      draft: Boolean(pr.draft),
      mergeable: pr.mergeable_state ?? null,
      gate: status
        ? {
            state: status.state,
            creator: status.creator?.login ?? null,
            trusted: apps.gateApp ? status.creator?.login === apps.gateApp : null,
          }
        : null,
      review: review.verdict,
      stacked: pr.base?.ref !== base,
    };
  });
}

/**
 * The snapshot of one repository.
 * @param {{ path: string, github?: string }} repo
 * @param {{ api?: (root: string) => import("./github.mjs").Api, offline?: boolean, now?: number, busy?: string[] }} options
 */
export function repoSnapshot(repo, { api, offline = false, now = Date.now(), busy } = {}) {
  const root = repo.path;
  if (!existsSync(root)) return { path: root, error: "missing" };
  const top = git(root, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return { path: root, error: "not a git repository" };
  /** @type {any} */
  let keys;
  /** @type {any} */
  let rules;
  /** @type {any} */
  let config;
  try {
    config = loadConfig(root);
    keys = schemeFor(root);
    rules = RULES[presetId(presetOf(root), root) ?? "neutral"] ?? RULES.neutral;
  } catch (error) {
    return { path: root, error: /** @type {Error} */ (error).message };
  }
  const base = defaultBranch(root);
  const trees = worktrees(root).map((t) => ({
    path: t.path,
    branch: t.branch ?? null,
    key: t.branch ? (keys.parse(t.branch) ?? null) : null,
    head: t.head,
    dirty: !isClean(t.path),
    idleHours: Math.round(idleHours(t.path, now) * 10) / 10,
    inUse: busy ? inUse(t.path, busy) : null,
    ...aheadBehind(t.path, t.branch),
  }));
  // The default branch's specs, then each worktree's copy of its own key.
  const specs = new Map(specsIn(root, { keys, rules }).map((s) => [s.folder, s]));
  for (const tree of trees)
    for (const s of specsIn(tree.path, { keys, rules }))
      if (tree.key && s.key === tree.key) specs.set(s.folder, { ...s, from: tree.path });
  const slug = repo.github || undefined;
  /** @type {any[]} */
  let prs = [];
  /** @type {string | null} */
  let prsProblem = null;
  if (offline) prsProblem = "offline";
  else if (!slug) prsProblem = "no GitHub repository";
  else if (!api) prsProblem = "no GitHub access";
  else
    try {
      const apps = config.config.apps ?? {};
      prs = openPrs(api(root), slug, base, {
        reviewer: apps.review?.slug,
        owner: apps.owner,
        gateApp: apps.gate?.login,
      });
    } catch (error) {
      prsProblem = `unknown (${/** @type {Error} */ (error).message})`;
    }
  const sessions = sessionsOf([...specs.values()], trees, prs);
  return {
    path: root,
    github: slug ?? null,
    base,
    specs: [...specs.values()],
    worktrees: trees,
    prs,
    prsProblem,
    sessions,
  };
}

/**
 * The sessions named in specs (AC-023, AC-024): each with its specs, the worktrees carrying their keys and those heads'
 * gates, and whether it is building.
 * @param {any[]} specs
 * @param {any[]} trees
 * @param {any[]} prs
 */
export function sessionsOf(specs, trees, prs) {
  /** @type {Map<string, any>} */
  const by = new Map();
  for (const spec of specs.filter((s) => s.session)) {
    const session = by.get(spec.session) ?? {
      name: spec.session,
      specs: [],
      worktrees: [],
      gates: [],
      building: false,
    };
    session.specs.push(spec.key ?? spec.folder);
    for (const tree of trees.filter((t) => spec.key && t.key === spec.key)) {
      session.worktrees.push(tree.path);
      const pr = prs.find((p) => p.head === tree.head);
      session.gates.push(pr?.gate?.state ?? null);
    }
    if (BUILDING.has(spec.status)) session.building = true;
    by.set(spec.session, session);
  }
  return [...by.values()];
}

/**
 * The snapshot of every repository, with the session cap's warning.
 * @param {{ repos: { path: string, github?: string }[], cap?: number, api?: (root: string) => import("./github.mjs").Api,
 *           offline?: boolean, now?: number, busy?: string[] }} options
 */
export function snapshot({ repos, cap = SESSION_CAP, now = Date.now(), ...options }) {
  const entries = repos.map((repo) => repoSnapshot(repo, { now, ...options }));
  const building = entries.flatMap((e) =>
    (e.sessions ?? []).filter((s) => s.building).map((s) => s.name),
  );
  const names = [...new Set(building)];
  const warnings =
    names.length > cap
      ? [
          `${names.length} sessions are building (${names.join(", ")}); the cap is ${cap}: ${names.length - cap} over`,
        ]
      : [];
  return {
    version: SNAPSHOT_VERSION,
    takenAt: new Date(now).toISOString(),
    cap,
    repos: entries,
    warnings,
  };
}
