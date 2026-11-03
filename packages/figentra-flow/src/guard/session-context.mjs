/**
 * Figentra Flow file contract:
 * Purpose: the guard engine's session context, ported from core's `session-context.mjs`: at a session's start,
 *   resume, compaction or clear, the preset's invariants with the branch and the first 15 lines of the dirty tree.
 * Boundary: reads git state; never blocks and writes nothing.
 * Runtime: node
 * Governing contract: STA-1945 (FR-7, P-012).
 * Secrets: none.
 */
import { git } from "../lib/git.mjs";

/**
 * A preset's session table.
 * @typedef {{ title: string, invariants: string[] }} SessionTable
 */

/**
 * The context for a session event, or undefined when the preset has no session table.
 * shortcut: core's best-effort spend and tracker digest lines are not carried; add them as preset commands when a
 *   repository asks for them.
 * @param {string} root the repository
 * @param {string | undefined} source `startup`, `resume`, `compact` or `clear`
 * @param {SessionTable | undefined} table
 * @returns {string | undefined}
 */
export function sessionContext(root, source, table) {
  if (!table) return undefined;
  const repo = git(root, ["rev-parse", "--is-inside-work-tree"]).ok;
  const branch = repo ? git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).out : "(no git)";
  const dirty = repo ? git(root, ["status", "--short"]).out.split("\n").slice(0, 15).join("\n") : "";
  const lines = [
    `[${table.title} — ${source ?? "start"}] branch: ${branch}`,
    "Invariants:",
    ...table.invariants,
  ];
  if (dirty) lines.push("Working tree:", dirty);
  return lines.join("\n");
}
