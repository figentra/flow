/**
 * Figentra Flow file contract:
 * Purpose: the live agent sessions of a repository (FR-20, AC-19, P-025): each running Claude Code or OpenCode process
 *   working in the repository or one of its worktrees, by its title (Claude Code's session file for that process),
 *   state (the title's form), worktree and stage (the worktree's record); `nameProblem` checks a title against Flow ADR
 *   0001's three forms, and a title that disagrees with the record's state is flagged too.
 * Boundary: reads the process list, the agent's session files (`<config>/sessions/<pid>.json`, never the `.key` files
 *   beside them) and the records; writes nothing. With no process listing, the sessions come from the records only,
 *   with a note.
 * Runtime: node
 * Governing contract: STA-1945 (FR-20, AC-19, P-025); Flow ADR 0001 (session names).
 * Secrets: none; a session file's title is read, nothing else of it is returned.
 */
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { schemeFor } from "../adapters/tracker/index.mjs";
import { git, inUse, processes, worktrees } from "./git.mjs";
import { readRecord } from "./record.mjs";

/** ADR 0001's closed list of tracks. */
export const TRACKS = [
  "LEADER",
  "FLOW",
  "TESTBED",
  "GEN",
  "BRAND",
  "RUNWAY",
  "DOCS",
  "UI",
  "OS",
  "ENGINE",
  "CLOUDFLARE",
  "LANDING",
];

const SEP = " · ";

/**
 * @typedef {{ name: string, state: "active" | "hold" | "done", worktree: string, stage?: string, pid?: number,
 *             kind?: string, problem?: string, note?: string }} LiveSession
 * @typedef {{ processes: () => import("./git.mjs").Process[] | undefined,
 *             sessionFiles: () => { path: string, name: string, pid?: number }[] }} SessionDeps
 */

/** A title's state: `hold · …`, `done · …`, else active. */
const stateOf = (/** @type {string} */ name) =>
  name.startsWith(`hold${SEP}`) ? "hold" : name.startsWith(`done${SEP}`) ? "done" : "active";

/**
 * Why `name` breaks ADR 0001's pattern (`TRACK · job (key)`, `hold · Track · job`, `done · Track · job`), or undefined.
 * @param {string} name
 * @returns {string | undefined}
 */
export function nameProblem(name) {
  if (!name.trim()) return "untitled: name it `TRACK · job (key)` (ADR 0001)";
  const parts = name.split(SEP);
  const held = stateOf(name) !== "active";
  const [track = "", ...job] = held ? parts.slice(1) : parts;
  if (!track.trim() || !job.join(SEP).trim())
    return `not \`${held ? `${parts[0]} · Track · job` : "TRACK · job (key)"}\` (ADR 0001)`;
  if (!TRACKS.includes(track.toUpperCase()))
    return `${track} is not a track (ADR 0001: ${TRACKS.join(", ")})`;
  if (!held && track !== track.toUpperCase())
    return `an active session's track is in capitals: ${track.toUpperCase()}`;
  return undefined;
}

/**
 * The track a title names (`FLOW` for `FLOW · …` and `hold · Flow · …`), or undefined when it names none.
 * @param {string} name
 */
export function trackOf(name) {
  const parts = name.split(SEP);
  const track = (stateOf(name) === "active" ? parts[0] : (parts[1] ?? "")).toUpperCase();
  return parts.length > 1 && TRACKS.includes(track) ? track : undefined;
}

/** The agent a process runs, by its program's name, or undefined; a pre-started spare is not a session. */
const agentOf = (/** @type {string[]} */ args) => {
  const line = args.join(" ");
  if (line.includes("--bg-spare")) return undefined;
  const program = line.match(/(?:^|\/)(claude|opencode)(?=\s|$)/)?.[1];
  return program === "claude" ? "claude-code" : program;
};

/**
 * The live sessions working in `root` or one of its worktrees.
 * @param {string} root the repository's main checkout
 * @param {SessionDeps} deps
 * @returns {LiveSession[]}
 */
export function liveSessions(root, deps) {
  const keys = schemeFor(root);
  const checkouts = [
    { path: root, branch: git(root, ["branch", "--show-current"]).out || undefined },
    ...worktrees(root),
  ];
  /** @param {{ path: string, branch?: string }} tree */
  const recordOf = (tree) => {
    const key = tree.branch ? keys.parse(tree.branch) : undefined;
    try {
      return { record: key ? readRecord(tree.path, key) : undefined };
    } catch (error) {
      return { problem: /** @type {Error} */ (error).message };
    }
  };
  /**
   * @param {string} name
   * @param {{ path: string, branch?: string }} tree
   * @param {ReturnType<typeof recordOf>} read
   * @param {Partial<LiveSession>} extra
   * @returns {LiveSession}
   */
  const describe = (name, tree, { record, problem }, extra) => {
    const state = stateOf(name);
    const disagrees =
      record && state === "done" && record.state === "active"
        ? `the title says done but the record is active at ${record.stage}`
        : record && state !== "done" && record.stage === "ship" && record.state === "done"
          ? "the record is shipped: the title is `done · Track · job`"
          : undefined;
    const why = problem ?? nameProblem(name) ?? disagrees;
    return {
      name,
      state,
      worktree: tree.path,
      ...(record ? { stage: record.stage } : {}),
      ...extra,
      ...(why ? { problem: why } : {}),
    };
  };
  const running = deps.processes();
  if (running === undefined)
    return checkouts.flatMap((tree) => {
      const read = recordOf(tree);
      const last = read.record?.sessions.at(-1);
      // An unreadable record is listed as its problem, never dropped.
      return last || read.problem
        ? [
            describe(last?.name ?? "", tree, read, {
              ...(last ? { kind: last.kind } : {}),
              note: "no process listing: the record's last session",
            }),
          ]
        : [];
    });
  const titles = new Map(deps.sessionFiles().map((f) => [f.pid, f.name]));
  return running.flatMap((p) => {
    const kind = agentOf(p.args);
    // The deepest checkout holding the process's folder: a worktree, not the main checkout around it.
    const tree = kind
      ? checkouts
          .filter((t) => inUse(t.path, [p.cwd]))
          .sort((a, b) => b.path.length - a.path.length)[0]
      : undefined;
    return tree
      ? [describe(titles.get(p.pid) ?? "", tree, recordOf(tree), { pid: p.pid, kind })]
      : [];
  });
}

/**
 * The sessions of this machine: its processes, and Claude Code's session files (`$CLAUDE_CONFIG_DIR` or `~/.claude`,
 * `sessions/<pid>.json`, each holding the session's title as `name`).
 * @param {string} [dir]
 * @returns {SessionDeps}
 */
export function systemSessions(dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")) {
  const folder = join(dir, "sessions");
  return {
    processes,
    sessionFiles: () => {
      let names;
      try {
        names = readdirSync(folder);
      } catch {
        return [];
      }
      // Only `<pid>.json`: the `.key` files beside them are never read.
      return names
        .filter((n) => /^\d+\.json$/.test(n))
        .flatMap((n) => {
          const path = join(folder, n);
          try {
            const file = JSON.parse(readFileSync(path, "utf8"));
            const name = typeof file.name === "string" ? file.name.trim() : "";
            return [{ path, name, pid: Number.parseInt(n, 10) }];
          } catch {
            return []; // a file being written, or one we may not read
          }
        });
    },
  };
}
