/**
 * Figentra Flow file contract:
 * Purpose: `fflow session stop [--session <name>] [--kind <kind>]` (FR-19, AC-18): the agent's Stop hook. On a task's
 *   branch it writes the session's end into Flow's record, commits the whole worktree as `wip(<session name>): …`
 *   and pushes the branch as the bot, so nothing is left only on one machine. A push that still fails after one
 *   merge is recorded as `pushed: false` (committed locally) and the fix printed.
 * Boundary: reads the hook's JSON on stdin (its `cwd` and `session_id`); writes the record and one or two commits on
 *   the task's branch and pushes it. Does nothing on the default branch, a detached HEAD or a branch with no issue
 *   key. Always exits 0: a Stop hook that fails must not trap the session.
 * Runtime: node
 * Governing contract: STA-1945 (FR-19, FR-14, AC-18, P-019).
 * Secrets: none; the push goes through the configured credentials.
 */
import { schemeFor } from "../adapters/tracker/index.mjs";
import { say } from "../lib/cli.mjs";
import { defaultBranch, git } from "../lib/git.mjs";
import { ENV_PREFIX, NAME } from "../lib/product.mjs";
import { commitRecord, RecordError, updateRecord } from "../lib/record.mjs";

/**
 * Records a session's stop and pushes its work.
 * @param {{ cwd: string, name: string, kind?: string, now?: string }} options
 * @returns {{ skipped: string } | { key: string, sha: string, pushed: boolean, problem?: string }}
 */
export function stopSession({ cwd, name, kind = "claude-code", now = new Date().toISOString() }) {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return { skipped: `${cwd} is not in a git repository` };
  const root = top.out;
  const branch = git(root, ["branch", "--show-current"]).out;
  if (!branch) return { skipped: "HEAD is detached" };
  if (branch === defaultBranch(root)) return { skipped: `${branch} is the default branch` };
  const key = schemeFor(root).keys(branch)[0];
  if (!key) return { skipped: `branch ${branch} names no issue key` };
  const shown = key.toUpperCase();
  /** @param {(s: { name: string, kind: string, start: string, end?: string, pushed?: boolean }) => object} change */
  const touch = (change) =>
    updateRecord(root, key, (r) => {
      const sessions = [...r.sessions];
      const at = sessions.findLastIndex((s) => s.name === name);
      if (at < 0) sessions.push({ name, kind, start: now, end: now });
      else sessions[at] = { ...sessions[at], ...change(sessions[at]) };
      return { ...r, sessions };
    });
  let recordProblem;
  try {
    touch(() => ({ end: now }));
  } catch (error) {
    // A broken record still lets the work be saved; the problem is reported with it.
    if (!(error instanceof RecordError)) throw error;
    recordProblem = error.message;
  }
  const saved = commitRecord(root, key, {
    message: `wip(${name}): session stopped\n\nRefs: ${shown}`,
    wip: true,
  });
  if (!saved.pushed && !recordProblem) {
    touch(() => ({ pushed: false }));
    commitRecord(root, key, {
      message: `wip(${name}): the stop was not pushed\n\nRefs: ${shown}`,
      push: false,
    });
  }
  const problem = [saved.problem, recordProblem].filter(Boolean).join("; ") || undefined;
  return {
    key,
    sha: git(root, ["rev-parse", "HEAD"]).out,
    pushed: saved.pushed,
    ...(problem ? { problem } : {}),
  };
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
  const name =
    opt("--session") ?? process.env[`${ENV_PREFIX}SESSION`] ?? event.session_id ?? "session";
  try {
    const result = stopSession({
      cwd: typeof event.cwd === "string" ? event.cwd : process.cwd(),
      name,
      kind: opt("--kind"),
    });
    if ("skipped" in result) return 0;
    if (result.pushed)
      say(
        "approved",
        `${NAME} session stop: ${name} saved and pushed (${result.sha.slice(0, 12)})`,
      );
    else
      say(
        "blocked",
        `${NAME} session stop: ${name} is committed (${result.sha.slice(0, 12)}) but not pushed: ${result.problem}; fix it and run \`${NAME} session stop\` again`,
      );
  } catch (error) {
    say("blocked", `${NAME} session stop: ${/** @type {Error} */ (error).message}`);
  }
  return 0;
}
