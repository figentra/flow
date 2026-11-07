/**
 * Figentra Flow file contract:
 * Purpose: the guard engine's session context, ported from core's `session-context.mjs`: at a session's start,
 *   resume, compaction or clear, the preset's invariants with the branch and the first 15 lines of the dirty tree,
 *   then the output of the repository's own `session.contextCommands` (STA-2131; core's spend line and tracker
 *   digest are two of these): each runs with no shell in the repository, within a short timeout and a shared
 *   budget under the hook's own, its output capped; one that fails, times out or prints nothing adds nothing.
 * Boundary: reads git state and runs the configured commands; never blocks and writes nothing.
 * Runtime: node
 * Governing contract: STA-1945 (FR-7, P-012); STA-2131.
 * Secrets: none; a command's output is the repository's to keep secret-free.
 */
import { spawnSync } from "node:child_process";

import { git } from "../lib/git.mjs";

/**
 * A preset's session table.
 * @typedef {{ title: string, invariants: string[] }} SessionTable
 */

/** One command's timeout, and the budget all of them share (under the SessionStart hook's 12 seconds). */
export const COMMAND_MS = 4000;
export const BUDGET_MS = 8000;
/** The most lines and characters one command adds. */
export const MAX_LINES = 20;
export const MAX_CHARS = 2000;

/**
 * The lines the repository's commands print, each capped; a command that fails or prints nothing adds none.
 * @param {string} root
 * @param {string[][]} commands argv each
 * @returns {string[]}
 */
export function commandLines(root, commands) {
  const deadline = Date.now() + BUDGET_MS;
  /** @type {string[]} */
  const out = [];
  for (const command of commands) {
    // A malformed entry is skipped alone, so the rest of the context (the invariants included) still prints.
    if (!Array.isArray(command) || !command.length || !command.every((a) => typeof a === "string"))
      continue;
    const [file, ...args] = command;
    const left = deadline - Date.now();
    if (left <= 0) break;
    const r = spawnSync(file, args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: Math.min(COMMAND_MS, left),
      maxBuffer: 1 << 20,
    });
    const text = r.status === 0 && !r.error ? (r.stdout ?? "").trim() : "";
    if (text) out.push(...text.slice(0, MAX_CHARS).split("\n").slice(0, MAX_LINES));
  }
  return out;
}

/**
 * The context for a session event, or undefined when there is nothing to say: no session table and no command
 * output.
 * @param {string} root the repository
 * @param {string | undefined} source `startup`, `resume`, `compact` or `clear`
 * @param {SessionTable | undefined} table
 * @param {string[][]} [commands] the configuration's `session.contextCommands`
 * @returns {string | undefined}
 */
export function sessionContext(root, source, table, commands = []) {
  const extra = commandLines(root, commands);
  if (!table) return extra.length ? extra.join("\n") : undefined;
  const repo = git(root, ["rev-parse", "--is-inside-work-tree"]).ok;
  const branch = repo ? git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).out : "(no git)";
  const dirty = repo
    ? git(root, ["status", "--short"]).out.split("\n").slice(0, 15).join("\n")
    : "";
  const lines = [
    `[${table.title} — ${source ?? "start"}] branch: ${branch}`,
    "Invariants:",
    ...table.invariants,
  ];
  if (dirty) lines.push("Working tree:", dirty);
  return [...lines, ...extra].join("\n");
}
