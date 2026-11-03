/**
 * Figentra Flow file contract:
 * Purpose: the guard engine's path decision for the file tools, ported from core's `guard-paths.mjs`: every path a
 *   Read, Grep, Glob, Write, Edit, MultiEdit or NotebookEdit call names (a Grep's or Glob's pattern under its folder)
 *   against a preset's path table; a rule marked `writes` applies to the write tools only.
 * Boundary: decides only; reads nothing.
 * Runtime: node
 * Governing contract: STA-1945 (FR-7, P-012).
 * Secrets: none.
 */
import { ALLOW } from "./bash.mjs";

/**
 * A path rule of a preset's table.
 * @typedef {{ id: string, match: (path: string, cwd: string) => boolean, reason: string, writes?: boolean }} PathRule
 */

/** The tools that write a file. */
export const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
/** The tools whose paths the guard reads. */
export const PATH_TOOLS = new Set([...WRITE_TOOLS, "Read", "Grep", "Glob"]);

/** `v` when it is a non-empty string. */
const str = (/** @type {unknown} */ v) => (typeof v === "string" && v ? v : undefined);
/** A glob relative to `dir`, unless it is absolute or under home. */
const under = (/** @type {string} */ dir, /** @type {string} */ glob) =>
  glob.startsWith("/") || glob.startsWith("~") ? glob : `${dir}/${glob}`;

/**
 * The decision for one file tool call: the first rule a named path hits denies it. A rule that throws makes the call
 * an ask.
 * @param {string} tool
 * @param {Record<string, any>} input the tool's input
 * @param {string} cwd
 * @param {PathRule[]} rules
 * @returns {import("./bash.mjs").Decision}
 */
export function decidePaths(tool, input, cwd, rules) {
  const base = str(input.path) ?? cwd;
  // Grep searches its path recursively; its `glob` filter and Glob's `pattern` are relative to it.
  const paths = [
    input.file_path,
    input.notebook_path,
    tool === "Grep" ? input.path : undefined,
    tool === "Grep" && str(input.glob) ? under(base, input.glob) : undefined,
    tool === "Glob" ? input.path : undefined,
    tool === "Glob" && str(input.pattern) ? under(base, input.pattern) : undefined,
  ].filter(str);
  const write = WRITE_TOOLS.has(tool);
  /** @type {string | undefined} */
  let asked;
  for (const path of paths)
    for (const rule of rules) {
      if (rule.writes && !write) continue;
      try {
        if (rule.match(path, cwd))
          return { decision: "deny", reason: `${rule.reason}\nBlocked path: ${path}` };
      } catch (error) {
        asked ??= `The guard rule ${rule.id} failed on ${path} (${/** @type {Error} */ (error)?.message}); confirm it by hand.`;
      }
    }
  return asked === undefined ? ALLOW : { decision: "ask", reason: asked };
}
