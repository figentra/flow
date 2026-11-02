/**
 * Figentra Flow file contract:
 * Purpose: `fflow doctor [--json] [--offline]`: whether this machine and repository can run Flow: Node, git,
 *   the configuration, the `.flow/` install, the ignored worktree folder, the roster and the GitHub credentials, each
 *   reported as passed or failed with its fix. Two warnings never fail the run (STA-1871): more linked worktrees than
 *   `clean.budget`, and under 10 GB or 10 % free on the disk that holds the repository.
 * Boundary: reads only, reusing the checks the other commands make (`loadConfig`, `installProblems`, `loadTeam`,
 *   `connect`); one GitHub call (`GET /repos/{repo}`) unless `--offline`. Exit 0 when every check passes, 1 otherwise.
 * Runtime: node
 * Governing contract: STA-1729 (FR-13, AC-055); STA-1846.
 * Secrets: none here; the token stays inside `gh` or the wrapper.
 */
import { statfsSync } from "node:fs";

import { BUDGET, ignoresWorktrees } from "./clean.mjs";
import { connect } from "./land.mjs";
import { say } from "../lib/cli.mjs";
import { loadConfig } from "../lib/config.mjs";
import { git, worktrees } from "../lib/git.mjs";
import { CONFIG_FILE, NAME, NODE_RANGE } from "../lib/product.mjs";
import { installProblems } from "../lib/render.mjs";
import { loadTeam } from "../lib/team.mjs";

/**
 * @typedef {{ id: string, ok: boolean, detail: string, fix?: string, warn?: boolean }} Check
 */

/** Below either, the disk is low: 10 GB free, or 10 % of it. */
export const LOW_DISK_BYTES = 10 * 1024 ** 3;
export const LOW_DISK_SHARE = 0.1;

/**
 * Free and total bytes of the file system that holds `path`.
 * @param {string} path
 */
export function diskOf(path) {
  const s = statfsSync(path);
  return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
}

/** Bytes as gigabytes, one decimal. */
const gb = (/** @type {number} */ n) => `${(n / 1024 ** 3).toFixed(1)} GB`;

/**
 * Whether `version` meets a `>=x.y.z` range (the only form Flow's `engines` uses).
 * @param {string} version
 * @param {string} range
 */
export function meets(version, range) {
  const min = /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(range.trim());
  if (!min) return true;
  const have = version.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const want = Number(min[i + 1] ?? 0);
    if ((have[i] ?? 0) !== want) return (have[i] ?? 0) > want;
  }
  return true;
}

/**
 * Every check for the repository at `root` (or `cwd` when it is none).
 * @param {string} cwd
 * @param {{ offline?: boolean, node?: string, disk?: (path: string) => { free: number, total: number } }} [options]
 * @returns {Check[]}
 */
export function checks(cwd, { offline = false, node = process.versions.node, disk = diskOf } = {}) {
  const range = NODE_RANGE;
  /** @type {Check[]} */
  const out = [
    meets(node, range)
      ? { id: "node", ok: true, detail: `Node ${node} (${range})` }
      : {
          id: "node",
          ok: false,
          detail: `Node ${node} does not meet ${range}`,
          fix: "install the Node the repository's mise.toml pins",
        },
  ];
  const root = git(cwd, ["rev-parse", "--show-toplevel"]).out;
  if (!root) {
    out.push({
      id: "git",
      ok: false,
      detail: `${cwd} is not inside a git work tree`,
      fix: "run doctor from the repository",
    });
    return out;
  }
  out.push({ id: "git", ok: true, detail: root });

  const loaded = loadConfig(root);
  out.push(
    loaded.errors.length
      ? {
          id: "config",
          ok: false,
          detail: loaded.errors.join("; "),
          fix: `correct ${CONFIG_FILE} against schema/${CONFIG_FILE.replace(".json", ".schema.json")}`,
        }
      : {
          id: "config",
          ok: true,
          detail: loaded.source ? CONFIG_FILE : `no ${CONFIG_FILE}: the defaults apply`,
        },
  );

  const install = installProblems(root);
  out.push(
    install.length
      ? { id: "install", ok: false, detail: install.join("; "), fix: `run \`${NAME} sync\`` }
      : { id: "install", ok: true, detail: ".flow/ matches the installed Flow" },
  );

  out.push(
    ignoresWorktrees(root)
      ? { id: "worktrees", ok: true, detail: ".claude/worktrees/ is ignored" }
      : {
          id: "worktrees",
          ok: false,
          detail: ".gitignore does not ignore .claude/worktrees/",
          fix: `run \`${NAME} clean --fix-ignore\``,
        },
  );

  // STA-1871: warnings, not failures.
  const count = worktrees(root).length;
  const limit = loaded.config.clean?.budget ?? BUDGET;
  out.push(
    count > limit
      ? {
          id: "worktree-budget",
          ok: false,
          warn: true,
          detail: `${count} linked worktrees, over the budget of ${limit}`,
          fix: `run \`${NAME} clean --budget --dry-run\`, then \`${NAME} clean --budget\``,
        }
      : { id: "worktree-budget", ok: true, detail: `${count} of ${limit} linked worktrees` },
  );
  const space = disk(root);
  const low = space.free < LOW_DISK_BYTES || space.free < space.total * LOW_DISK_SHARE;
  out.push({
    id: "disk",
    ok: !low,
    ...(low
      ? { warn: true, fix: `free space: \`${NAME} clean --budget\`, then old caches and builds` }
      : {}),
    detail: `${gb(space.free)} free of ${gb(space.total)}`,
  });

  if (!loaded.errors.length) {
    const team = loadTeam(root);
    if (team)
      out.push(
        team.problems.length
          ? {
              id: "team",
              ok: false,
              detail: team.problems.join("; "),
              fix: `correct the roster, then \`${NAME} team check\``,
            }
          : { id: "team", ok: true, detail: `${team.roles.size} roles` },
      );
  }

  if (offline || loaded.errors.length || loaded.config.credentials === undefined) {
    if (!offline && !loaded.errors.length)
      out.push({
        id: "credentials",
        ok: false,
        detail: `${CONFIG_FILE} names no credentials, so land, train, ship and release cannot read GitHub`,
        fix: `add a "credentials" block to ${CONFIG_FILE}`,
      });
    return out;
  }
  const { repo, api, problem } = connect(root);
  const r = api && repo ? api("GET", `/repos/${repo}`) : undefined;
  out.push(
    r?.ok
      ? {
          id: "credentials",
          ok: true,
          detail: `${repo} is readable with the configured credentials`,
        }
      : {
          id: "credentials",
          ok: false,
          detail: problem ?? `GET /repos/${repo} failed: ${r?.err}`,
          fix: `check the "credentials" block in ${CONFIG_FILE} and that its gh or wrapper works`,
        },
  );
  return out;
}

/** @param {string[]} args */
export function run(args = []) {
  const all = checks(process.cwd(), { offline: args.includes("--offline") });
  const failed = all.filter((c) => !c.ok && !c.warn);
  if (args.includes("--json"))
    console.log(JSON.stringify({ schema: `${NAME}.doctor/1`, checks: all }, null, 2));
  else {
    for (const c of all) {
      say(
        c.ok ? "approved" : c.warn ? "waiting" : "blocked",
        `${c.id}${c.warn ? " (warning)" : ""}: ${c.detail}`,
      );
      if (c.fix) console.error(`  fix: ${c.fix}`);
    }
    if (!failed.length) console.error(`  ${NAME} doctor: every check passed`);
  }
  return failed.length ? 1 : 0;
}
