/**
 * Figentra Flow file contract:
 * Purpose: `fflow session stop [--session <name>] [--kind <kind>]` (FR-19, AC-18): the agent's Stop hook. On a task's
 *   branch it writes the session's end into Flow's record, commits the tracked changes and the record as
 *   `wip(<session name>): …` and pushes the branch as the bot, so nothing is left only on one machine. Untracked files
 *   and files named like secrets are never committed, only listed. The hooks always run (FR-18): when they refuse the
 *   commit, that is reported and the work stays uncommitted. A push that still fails after one merge is recorded as
 *   `pushed: false` (committed locally) and the fix printed; a later pushed stop clears it.
 * Boundary: reads the hook's JSON on stdin (its `cwd`, `transcript_path` and `session_id`); the session's name is
 *   `--session`, else the title its transcript last records (ADR 0001, set with `/rename`), else its id; its entry in
 *   the record is found by `session_id`, so a rename keeps one entry. Writes the record and one or two commits on the
 *   task's branch and pushes it. Does nothing on the default branch, a detached HEAD or a branch with no issue key. Always exits 0: a Stop hook that fails must not trap the session.
 * Runtime: node
 * Governing contract: STA-1945 (FR-19, FR-14, AC-18, P-019).
 * Secrets: none; the push goes through the configured credentials.
 */
import { readFileSync } from "node:fs";

import { schemeFor } from "../adapters/tracker/index.mjs";
import { say } from "../lib/cli.mjs";
import { defaultBranch, git } from "../lib/git.mjs";
import { ENV_PREFIX, NAME } from "../lib/product.mjs";
import { commitRecord, RecordError, updateRecord } from "../lib/record.mjs";

/**
 * Records a session's stop and pushes its work. With `id` (the hook's `session_id`) the session's entry is found by
 * it, so a renamed session (ADR 0001 names change with its state) keeps one entry under its latest name; without
 * one, by name.
 * @param {{ cwd: string, name: string, id?: string, kind?: string, now?: string }} options
 * @returns {{ skipped: string } | { key: string, sha: string, pushed: boolean, problem?: string, hooks?: string,
 *             secrets?: string[], untracked?: string[] }}
 */
export function stopSession({
  cwd,
  name,
  id,
  kind = "claude-code",
  now = new Date().toISOString(),
}) {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return { skipped: `${cwd} is not in a git repository` };
  const root = top.out;
  const branch = git(root, ["branch", "--show-current"]).out;
  if (!branch) return { skipped: "HEAD is detached" };
  if (branch === defaultBranch(root)) return { skipped: `${branch} is the default branch` };
  const key = schemeFor(root).keys(branch)[0];
  if (!key) return { skipped: `branch ${branch} names no issue key` };
  const shown = key.toUpperCase();
  /** @param {(s: Session) => Session} change */
  const touch = (change) =>
    updateRecord(root, key, (r) => {
      const sessions = [...r.sessions];
      const at = sessions.findLastIndex((s) => (id ? s.id === id : s.name === name));
      // First seen at its stop: when it started is unknown, never the stop's time.
      const was = at < 0 ? { name, ...(id ? { id } : {}), kind, start: null } : sessions[at];
      sessions.splice(at < 0 ? sessions.length : at, 1, change({ ...was, name }));
      return { ...r, sessions };
    });
  let recordProblem;
  try {
    // The stop is pushed with this commit, so an earlier stop's `pushed: false` no longer holds.
    touch((s) => {
      const ended = { ...s, end: now };
      delete ended.pushed;
      return ended;
    });
  } catch (error) {
    // A broken record still lets the work be saved; the problem is reported with it.
    if (!(error instanceof RecordError)) throw error;
    recordProblem = error.message;
  }
  const saved = commitRecord(root, key, {
    message: `wip(${name}): session stopped\n\nRefs: ${shown}`,
    wip: true,
  });
  // When the hooks refused the commit nothing was committed, and a second commit would be refused too.
  if (!saved.pushed && saved.hooks === undefined && !recordProblem) {
    touch((s) => ({ ...s, pushed: false }));
    commitRecord(root, key, {
      message: `wip(${name}): the stop was not pushed\n\nRefs: ${shown}`,
      push: false,
    });
  }
  const problem = [saved.problem, recordProblem].filter(Boolean).join("; ") || undefined;
  return {
    ...saved,
    key,
    sha: git(root, ["rev-parse", "HEAD"]).out,
    ...(problem ? { problem } : {}),
  };
}

/** @typedef {import("../lib/record.mjs").FlowRecord["sessions"][number]} Session */

/**
 * What `session stop` tells the owner, one `[state, line]` each.
 * @param {string} name
 * @param {ReturnType<typeof stopSession>} result
 * @returns {[Parameters<typeof say>[0], string][]}
 */
export function stopReport(name, result) {
  if ("skipped" in result) return [];
  const at = `${NAME} session stop:`;
  /** @type {[Parameters<typeof say>[0], string][]} */
  const lines = [
    result.hooks !== undefined
      ? [
          "blocked",
          `${at} the hooks refused the WIP commit: ${result.hooks}; the work stays in the worktree, uncommitted`,
        ]
      : result.pushed
        ? [
            result.problem ? "blocked" : "approved",
            `${at} ${name} saved and pushed (${result.sha.slice(0, 12)})${result.problem ? `; ${result.problem}` : ""}`,
          ]
        : [
            "blocked",
            `${at} ${name} is committed (${result.sha.slice(0, 12)}) but not pushed: ${result.problem}; fix it and run \`${NAME} session stop\` again`,
          ],
  ];
  if (result.secrets)
    lines.push([
      "blocked",
      `${at} not committed, as their names look like secrets: ${result.secrets.join(", ")}`,
    ]);
  if (result.untracked)
    lines.push([
      "waiting",
      `${at} untracked, so not committed (\`git add\` what belongs to the task): ${result.untracked.join(", ")}`,
    ]);
  return lines;
}

/**
 * The session's title as its Claude Code transcript last records it (`/rename` appends a `custom-title` line), so the
 * record and the WIP commit carry the name the owner sees (ADR 0001) rather than the session's id.
 * @param {unknown} path the hook's `transcript_path`
 * @returns {string | undefined}
 */
export function sessionTitle(path) {
  if (typeof path !== "string" || !path) return undefined;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  let title;
  for (const line of text.split("\n")) {
    if (!line.includes('"custom-title"')) continue;
    try {
      const entry = JSON.parse(line);
      if (
        entry?.type === "custom-title" &&
        typeof entry.customTitle === "string" &&
        entry.customTitle.trim()
      )
        title = entry.customTitle.trim();
    } catch {
      // a line still being written
    }
  }
  return title;
}

/**
 * The session's name: `--session`, else `<ENV_PREFIX>SESSION`, else its transcript's title, else its id.
 * @param {string[]} args
 * @param {Record<string, string | undefined>} env
 * @param {{ transcript_path?: unknown, session_id?: unknown }} event the hook's JSON
 * @returns {string}
 */
export function sessionName(args, env, event) {
  const at = args.indexOf("--session");
  return (
    (at < 0 ? undefined : args[at + 1]) ??
    env[`${ENV_PREFIX}SESSION`] ??
    sessionTitle(event.transcript_path) ??
    (typeof event.session_id === "string" && event.session_id ? event.session_id : "session")
  );
}

/** Reads all of stdin unless it is a terminal. */
async function stdin() {
  if (process.stdin.isTTY) return "";
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

/** @param {string[]} args */
export async function run(args = []) {
  if (args[0] !== "stop") {
    console.error(`usage: ${NAME} session stop [--session <name>] [--kind <kind>]`);
    return 2;
  }
  const opt = (/** @type {string} */ flag) =>
    args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  /** @type {any} */
  let event = {};
  try {
    event = JSON.parse((await stdin()) || "{}");
  } catch {
    // not a hook's JSON: run from the shell
  }
  const name = sessionName(args, process.env, event);
  try {
    const result = stopSession({
      cwd: typeof event.cwd === "string" ? event.cwd : process.cwd(),
      name,
      id: typeof event.session_id === "string" && event.session_id ? event.session_id : undefined,
      kind: opt("--kind"),
    });
    for (const [state, line] of stopReport(name, result)) say(state, line);
  } catch (error) {
    say("blocked", `${NAME} session stop: ${/** @type {Error} */ (error).message}`);
  }
  return 0;
}
